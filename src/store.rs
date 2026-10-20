//! The database: SQLite, PostgreSQL or MySQL, behind one way of running SQL.
//!
//! SQL is written once, in SQLite's dialect with `?1`-style parameters, and
//! adapted here for the others: `LIKE` matches without regard to case
//! everywhere (PostgreSQL's `ILIKE`), `group_concat`, "insert or ignore" and
//! upserts take each database's form, and new rows' ids come back however
//! the database gives them.
//!
//! For PostgreSQL and MySQL, parameters are written into the SQL as quoted
//! literals rather than bound: a quoted literal takes the type of what it's
//! compared with or stored in, as SQLite's loose typing does, so the same
//! SQL works everywhere. Quoting is strict (strings are single-quoted with
//! quotes doubled; MySQL's backslash escapes are switched off for the
//! session), and only ever applied to parameters.
//!
//! PostgreSQL's client runs its own async runtime, which can't be started
//! inside the service's; it gets a thread of its own, and calls wait on it.

use std::cell::{Cell, RefCell};
use std::sync::mpsc;

use regex::Regex;
use rusqlite::ErrorCode;
pub use rusqlite::types::Value as Sql;
use serde_json::Value;

use crate::error::{Constraint, Error, Result};

/// Which database, for SQL that has to differ.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    Sqlite,
    Postgres,
    Mysql,
}

/// A value as a parameter: `args![a, b]` makes `&[Sql]` from anything here.
pub trait ToArg {
    fn to_arg(&self) -> Sql;
}

impl ToArg for Sql {
    fn to_arg(&self) -> Sql {
        self.clone()
    }
}
impl ToArg for i64 {
    fn to_arg(&self) -> Sql {
        Sql::Integer(*self)
    }
}
impl ToArg for i32 {
    fn to_arg(&self) -> Sql {
        Sql::Integer(*self as i64)
    }
}
impl ToArg for usize {
    fn to_arg(&self) -> Sql {
        Sql::Integer(*self as i64)
    }
}
impl ToArg for bool {
    fn to_arg(&self) -> Sql {
        Sql::Integer(*self as i64)
    }
}
impl ToArg for f64 {
    fn to_arg(&self) -> Sql {
        Sql::Real(*self)
    }
}
impl ToArg for str {
    fn to_arg(&self) -> Sql {
        Sql::Text(self.to_string())
    }
}
impl ToArg for String {
    fn to_arg(&self) -> Sql {
        Sql::Text(self.clone())
    }
}
impl ToArg for [u8] {
    fn to_arg(&self) -> Sql {
        Sql::Blob(self.to_vec())
    }
}
impl ToArg for Vec<u8> {
    fn to_arg(&self) -> Sql {
        Sql::Blob(self.clone())
    }
}
impl ToArg for Value {
    fn to_arg(&self) -> Sql {
        crate::db::to_sql(self)
    }
}
impl<T: ToArg + ?Sized> ToArg for &T {
    fn to_arg(&self) -> Sql {
        (**self).to_arg()
    }
}
impl<T: ToArg> ToArg for Option<T> {
    fn to_arg(&self) -> Sql {
        self.as_ref().map_or(Sql::Null, ToArg::to_arg)
    }
}

/// Parameters for a query: `args![name, id]`.
#[macro_export]
macro_rules! args {
    ($($x:expr),* $(,)?) => {
        &[$($crate::store::ToArg::to_arg(&$x)),*][..]
    };
}

/// A row: its columns' names and values, in order.
pub type Row = Vec<(String, Sql)>;

pub(crate) enum Conn {
    Sqlite(rusqlite::Connection),
    Postgres(Pg),
    Mysql(RefCell<mysql::Conn>),
}

/// A connection, and how deep in transactions it is.
pub(crate) struct Store {
    pub(crate) conn: Conn,
    depth: Cell<u32>,
    /// The account statements run for, if any: each is scoped to its rows
    /// (see [`crate::scope`]). None: every row, as one person's hunt has.
    owner: Cell<Option<i64>>,
}

impl Store {
    pub(crate) fn new(conn: Conn) -> Store {
        Store {
            conn,
            depth: Cell::new(0),
            owner: Cell::new(None),
        }
    }

    /// Run statements for `owner` (None: for everyone), until changed.
    pub(crate) fn set_owner(&self, owner: Option<i64>) {
        self.owner.set(owner);
    }

    pub(crate) fn owner(&self) -> Option<i64> {
        self.owner.get()
    }

    /// `sql` as the owner may run it.
    fn scoped<'a>(&self, sql: &'a str) -> std::borrow::Cow<'a, str> {
        match self.owner.get() {
            Some(o) => std::borrow::Cow::Owned(crate::scope::scope(sql, o)),
            None => crate::scope::unscoped(sql),
        }
    }

    pub fn dialect(&self) -> Dialect {
        match self.conn {
            Conn::Sqlite(_) => Dialect::Sqlite,
            Conn::Postgres(_) => Dialect::Postgres,
            Conn::Mysql(_) => Dialect::Mysql,
        }
    }

    /// The SQLite connection, for what only SQLite does (its upgrades).
    pub(crate) fn sqlite(&self) -> Option<&rusqlite::Connection> {
        match &self.conn {
            Conn::Sqlite(c) => Some(c),
            _ => None,
        }
    }

    pub fn rows(&self, sql: &str, params: &[Sql]) -> Result<Vec<Row>> {
        let sql = &*self.scoped(sql);
        match &self.conn {
            Conn::Sqlite(c) => {
                let mut stmt = c.prepare(sql)?;
                let names: Vec<String> =
                    stmt.column_names().iter().map(|s| s.to_string()).collect();
                let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
                    let mut out = Vec::with_capacity(names.len());
                    for (i, name) in names.iter().enumerate() {
                        out.push((name.clone(), row.get::<_, Sql>(i)?));
                    }
                    Ok(out)
                })?;
                Ok(rows.collect::<rusqlite::Result<_>>()?)
            }
            Conn::Postgres(pg) => {
                let sql = adapt(sql, Dialect::Postgres, params);
                pg.run(move |c| {
                    c.query(sql.as_str(), &[])
                        .map(|rows| rows.iter().map(pg_row).collect())
                })
                .map_err(pg_error)
            }
            Conn::Mysql(c) => {
                let sql = adapt(sql, Dialect::Mysql, params);
                let mut c = c.borrow_mut();
                let mut result =
                    mysql::prelude::Queryable::query_iter(&mut *c, sql).map_err(my_error)?;
                let mut out = Vec::new();
                if let Some(set) = result.iter() {
                    for row in set {
                        out.push(my_row(&row.map_err(my_error)?));
                    }
                }
                Ok(out)
            }
        }
    }

    /// Run a statement; how many rows it changed.
    pub fn exec(&self, sql: &str, params: &[Sql]) -> Result<usize> {
        let sql = &*self.scoped(sql);
        match &self.conn {
            Conn::Sqlite(c) => Ok(c.execute(sql, rusqlite::params_from_iter(params.iter()))?),
            Conn::Postgres(pg) => {
                let sql = adapt(sql, Dialect::Postgres, params);
                pg.run(move |c| c.execute(sql.as_str(), &[]))
                    .map(|n| n as usize)
                    .map_err(pg_error)
            }
            Conn::Mysql(c) => {
                let sql = adapt(sql, Dialect::Mysql, params);
                let mut c = c.borrow_mut();
                let result =
                    mysql::prelude::Queryable::query_iter(&mut *c, sql).map_err(my_error)?;
                Ok(result.affected_rows() as usize)
            }
        }
    }

    /// Insert a row; its new id.
    pub fn insert(&self, sql: &str, params: &[Sql]) -> Result<i64> {
        let sql = &*self.scoped(sql);
        match &self.conn {
            Conn::Sqlite(c) => {
                c.execute(sql, rusqlite::params_from_iter(params.iter()))?;
                Ok(c.last_insert_rowid())
            }
            Conn::Postgres(pg) => {
                let sql = format!("{} RETURNING id", adapt(sql, Dialect::Postgres, params));
                pg.run(move |c| c.query(sql.as_str(), &[]))
                    .map_err(pg_error)
                    .map(|rows| {
                        rows.first()
                            .and_then(|r| r.try_get::<_, i64>(0).ok())
                            .unwrap_or(0)
                    })
            }
            Conn::Mysql(c) => {
                let sql = adapt(sql, Dialect::Mysql, params);
                let mut c = c.borrow_mut();
                let result =
                    mysql::prelude::Queryable::query_iter(&mut *c, sql).map_err(my_error)?;
                Ok(result.last_insert_id().unwrap_or(0) as i64)
            }
        }
    }

    /// Statements without parameters, one after another (schemas).
    pub fn batch(&self, sql: &str) -> Result<()> {
        match &self.conn {
            Conn::Sqlite(c) => Ok(c.execute_batch(sql)?),
            Conn::Postgres(pg) => {
                let sql = sql.to_string();
                pg.run(move |c| c.batch_execute(&sql)).map_err(pg_error)
            }
            Conn::Mysql(c) => {
                let mut c = c.borrow_mut();
                for stmt in split_statements(sql) {
                    mysql::prelude::Queryable::query_drop(&mut *c, stmt).map_err(my_error)?;
                }
                Ok(())
            }
        }
    }

    /// Run `f` all or nothing. Nests: inner calls are savepoints.
    pub fn atomic<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T> {
        let depth = self.depth.get();
        let (begin, commit, rollback) = if depth == 0 {
            let begin = if self.dialect() == Dialect::Mysql {
                "START TRANSACTION"
            } else {
                "BEGIN"
            };
            (
                begin.to_string(),
                "COMMIT".to_string(),
                "ROLLBACK".to_string(),
            )
        } else {
            (
                format!("SAVEPOINT sp{depth}"),
                format!("RELEASE SAVEPOINT sp{depth}"),
                format!("ROLLBACK TO SAVEPOINT sp{depth}"),
            )
        };
        self.batch(&begin)?;
        self.depth.set(depth + 1);
        let result = f();
        self.depth.set(depth);
        match result {
            Ok(v) => {
                self.batch(&commit)?;
                Ok(v)
            }
            Err(e) => {
                let _ = self.batch(&rollback);
                if depth > 0 {
                    let _ = self.batch(&commit);
                }
                Err(e)
            }
        }
    }
}

/// Statements of a script, split at semicolons that end lines (comments
/// dropped): enough for our schema files.
fn split_statements(sql: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for line in sql.lines() {
        let line = match line.find("--") {
            Some(i) => &line[..i],
            None => line,
        };
        cur.push_str(line);
        cur.push('\n');
        if line.trim_end().ends_with(';') {
            let s = cur.trim().trim_end_matches(';').trim().to_string();
            if !s.is_empty() {
                out.push(s);
            }
            cur.clear();
        }
    }
    let s = cur.trim().trim_end_matches(';').trim().to_string();
    if !s.is_empty() {
        out.push(s);
    }
    out
}

// --- adapting SQL ------------------------------------------------------------------

fn rx(re: &str) -> Regex {
    Regex::new(re).expect("a good pattern")
}

/// SQLite's SQL, for another database, with its parameters in place.
pub(crate) fn adapt(sql: &str, dialect: Dialect, params: &[Sql]) -> String {
    use std::sync::LazyLock;
    static GROUP_CONCAT: LazyLock<Regex> =
        LazyLock::new(|| rx(r"(?i)group_concat\(([^()]*(?:\([^()]*\)[^()]*)*),\s*('[^']*')\)"));
    static OR_IGNORE: LazyLock<Regex> =
        LazyLock::new(|| rx(r"(?i)\bINSERT\s+OR\s+IGNORE\s+INTO\b"));
    static UPSERT: LazyLock<Regex> =
        LazyLock::new(|| rx(r"(?i)\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b"));
    static LIKE: LazyLock<Regex> = LazyLock::new(|| rx(r"(?i)\bLIKE\b"));
    static NOCASE: LazyLock<Regex> = LazyLock::new(|| rx(r"(?i)\s+COLLATE\s+NOCASE\b"));

    let mut sql = sql.to_string();
    // No column is NOCASE outside SQLite: case-insensitive comparisons are
    // written with lower(); MySQL's collations ignore case anyway.
    sql = NOCASE.replace_all(&sql, "").into_owned();
    match dialect {
        Dialect::Sqlite => {}
        Dialect::Postgres => {
            sql = GROUP_CONCAT
                .replace_all(&sql, "string_agg($1, $2)")
                .into_owned();
            sql = LIKE.replace_all(&sql, "ILIKE").into_owned();
            if OR_IGNORE.is_match(&sql) {
                sql = format!(
                    "{} ON CONFLICT DO NOTHING",
                    OR_IGNORE.replace(&sql, "INSERT INTO")
                );
            }
        }
        Dialect::Mysql => {
            sql = GROUP_CONCAT
                .replace_all(&sql, "group_concat($1 SEPARATOR $2)")
                .into_owned();
            sql = OR_IGNORE
                .replace_all(&sql, "INSERT IGNORE INTO")
                .into_owned();
            sql = UPSERT
                .replace_all(&sql, "ON DUPLICATE KEY UPDATE")
                .into_owned();
        }
    }
    with_literals(&sql, dialect, params)
}

/// Put parameters in as literals. `?N` is the Nth; a bare `?` is the one
/// after the highest so far, as in SQLite. Quoted text is left alone.
fn with_literals(sql: &str, dialect: Dialect, params: &[Sql]) -> String {
    let mut out = String::with_capacity(sql.len() + 16);
    let mut chars = sql.chars().peekable();
    let mut highest = 0usize;
    let mut quote: Option<char> = None;
    while let Some(c) = chars.next() {
        if let Some(q) = quote {
            out.push(c);
            if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            '\'' | '"' | '`' => {
                quote = Some(c);
                out.push(c);
            }
            '?' => {
                let mut digits = String::new();
                while let Some(d) = chars.peek().filter(|d| d.is_ascii_digit()) {
                    digits.push(*d);
                    chars.next();
                }
                let n = match digits.parse::<usize>() {
                    Ok(n) => n,
                    Err(_) => highest + 1,
                };
                highest = highest.max(n);
                out.push_str(&literal(params.get(n - 1).unwrap_or(&Sql::Null), dialect));
            }
            _ => out.push(c),
        }
    }
    out
}

fn literal(v: &Sql, dialect: Dialect) -> String {
    match v {
        Sql::Null => "NULL".into(),
        Sql::Integer(i) => i.to_string(),
        Sql::Real(f) if f.is_finite() => format!("{f:?}"),
        Sql::Real(_) => "NULL".into(),
        Sql::Text(s) => format!("'{}'", s.replace('\0', "").replace('\'', "''")),
        Sql::Blob(b) => {
            let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
            match dialect {
                Dialect::Postgres => format!("'\\x{hex}'::bytea"),
                _ => format!("X'{hex}'"),
            }
        }
    }
}

// --- reading rows ------------------------------------------------------------------

fn pg_row(row: &postgres::Row) -> Row {
    use postgres::types::Type;
    row.columns()
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let t = col.type_();
            let v = if *t == Type::INT8 {
                row.try_get::<_, Option<i64>>(i)
                    .ok()
                    .flatten()
                    .map(Sql::Integer)
            } else if *t == Type::INT4 {
                row.try_get::<_, Option<i32>>(i)
                    .ok()
                    .flatten()
                    .map(|n| Sql::Integer(n as i64))
            } else if *t == Type::INT2 {
                row.try_get::<_, Option<i16>>(i)
                    .ok()
                    .flatten()
                    .map(|n| Sql::Integer(n as i64))
            } else if *t == Type::BOOL {
                row.try_get::<_, Option<bool>>(i)
                    .ok()
                    .flatten()
                    .map(|b| Sql::Integer(b as i64))
            } else if *t == Type::FLOAT8 {
                row.try_get::<_, Option<f64>>(i)
                    .ok()
                    .flatten()
                    .map(Sql::Real)
            } else if *t == Type::FLOAT4 {
                row.try_get::<_, Option<f32>>(i)
                    .ok()
                    .flatten()
                    .map(|f| Sql::Real(f as f64))
            } else if *t == Type::BYTEA {
                row.try_get::<_, Option<Vec<u8>>>(i)
                    .ok()
                    .flatten()
                    .map(Sql::Blob)
            } else {
                row.try_get::<_, Option<String>>(i)
                    .ok()
                    .flatten()
                    .map(Sql::Text)
            };
            (col.name().to_string(), v.unwrap_or(Sql::Null))
        })
        .collect()
}

fn my_row(row: &mysql::Row) -> Row {
    use mysql::consts::ColumnType as T;
    row.columns_ref()
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let v = match row.as_ref(i) {
                None | Some(mysql::Value::NULL) => Sql::Null,
                Some(mysql::Value::Int(n)) => Sql::Integer(*n),
                Some(mysql::Value::UInt(n)) => Sql::Integer(*n as i64),
                Some(mysql::Value::Float(f)) => Sql::Real(*f as f64),
                Some(mysql::Value::Double(f)) => Sql::Real(*f),
                Some(mysql::Value::Bytes(b)) => {
                    let text = || String::from_utf8_lossy(b).into_owned();
                    match col.column_type() {
                        T::MYSQL_TYPE_TINY
                        | T::MYSQL_TYPE_SHORT
                        | T::MYSQL_TYPE_LONG
                        | T::MYSQL_TYPE_INT24
                        | T::MYSQL_TYPE_LONGLONG => {
                            text().parse().map(Sql::Integer).unwrap_or(Sql::Null)
                        }
                        T::MYSQL_TYPE_FLOAT | T::MYSQL_TYPE_DOUBLE => {
                            text().parse().map(Sql::Real).unwrap_or(Sql::Null)
                        }
                        T::MYSQL_TYPE_DECIMAL | T::MYSQL_TYPE_NEWDECIMAL => {
                            let t = text();
                            match t.parse::<i64>() {
                                Ok(n) if !t.contains('.') => Sql::Integer(n),
                                _ => t.parse().map(Sql::Real).unwrap_or(Sql::Null),
                            }
                        }
                        // Binary (charset 63): file contents.
                        _ if col.character_set() == 63 => Sql::Blob(b.clone()),
                        _ => Sql::Text(text()),
                    }
                }
                Some(other) => Sql::Text(other.as_sql(true)),
            };
            (col.name_str().into_owned(), v)
        })
        .collect()
}

// --- errors ------------------------------------------------------------------------

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Error {
        if e.sqlite_error_code() != Some(ErrorCode::ConstraintViolation) {
            return Error::Db(e.to_string());
        }
        let msg = e.to_string();
        let column = |prefix: &str| {
            msg.strip_prefix(prefix).map(|c| {
                c.split(',')
                    .next()
                    .unwrap_or(c)
                    .split('.')
                    .next_back()
                    .unwrap_or(c)
                    .trim()
                    .to_string()
            })
        };
        let (kind, column) = if let Some(col) = column("UNIQUE constraint failed: ") {
            (Constraint::Unique, Some(col))
        } else if msg.contains("FOREIGN KEY") {
            (Constraint::ForeignKey, None)
        } else {
            (Constraint::Other, column("NOT NULL constraint failed: "))
        };
        Error::Constraint {
            kind,
            column,
            message: msg,
        }
    }
}

fn pg_error(e: postgres::Error) -> Error {
    use postgres::error::SqlState;
    let Some(db) = e.as_db_error() else {
        return Error::Db(format!("PostgreSQL: {e}"));
    };
    let message = db.message().to_string();
    let code = db.code();
    let kind = if *code == SqlState::UNIQUE_VIOLATION {
        Constraint::Unique
    } else if *code == SqlState::FOREIGN_KEY_VIOLATION {
        Constraint::ForeignKey
    } else if code.code().starts_with("23") {
        Constraint::Other
    } else {
        return Error::Db(format!("PostgreSQL: {message}"));
    };
    // "Key (lower(name))=(Acme) already exists."
    let column = db.detail().and_then(|d| {
        let inner = d.strip_prefix("Key (")?.split(")=").next()?;
        let inner = inner.trim_start_matches("lower(").trim_end_matches(')');
        Some(inner.split(',').next()?.trim().to_string())
    });
    let column = column.or_else(|| db.column().map(String::from));
    Error::Constraint {
        kind,
        column,
        message,
    }
}

fn my_error(e: mysql::Error) -> Error {
    let mysql::Error::MySqlError(db) = &e else {
        return Error::Db(format!("MySQL: {e}"));
    };
    let kind = match db.code {
        1062 | 1169 => Constraint::Unique,
        1216 | 1217 | 1451 | 1452 => Constraint::ForeignKey,
        1048 | 3819 => Constraint::Other,
        _ => return Error::Db(format!("MySQL: {}", db.message)),
    };
    // "Duplicate entry 'Acme' for key 'company.name'"
    let column = db.message.rsplit_once("for key '").map(|(_, k)| {
        k.trim_end_matches('\'')
            .rsplit('.')
            .next()
            .unwrap_or(k)
            .to_string()
    });
    Error::Constraint {
        kind,
        column,
        message: db.message.clone(),
    }
}

// --- connecting --------------------------------------------------------------------

/// Work for PostgreSQL's thread.
type PgJob = Box<dyn FnOnce(&mut postgres::Client) + Send>;

/// PostgreSQL's client, on a thread of its own.
pub(crate) struct Pg {
    jobs: mpsc::Sender<PgJob>,
}

impl Pg {
    pub(crate) fn connect(url: &str) -> Result<Pg> {
        let url = url.to_string();
        let (jobs, inbox) = mpsc::channel::<PgJob>();
        let (ready, started) = mpsc::channel();
        std::thread::Builder::new()
            .name("postgres".into())
            .spawn(
                move || match postgres::Client::connect(&url, postgres::NoTls) {
                    Ok(mut client) => {
                        let _ = ready.send(Ok(()));
                        for job in inbox {
                            job(&mut client);
                        }
                    }
                    Err(e) => {
                        let _ = ready.send(Err(e.to_string()));
                    }
                },
            )?;
        started
            .recv()
            .map_err(|_| Error::Db("PostgreSQL: the connection thread stopped".into()))?
            .map_err(|e| Error::Db(format!("couldn't connect to PostgreSQL: {e}")))?;
        Ok(Pg { jobs })
    }

    fn run<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut postgres::Client) -> T + Send + 'static,
    ) -> T {
        let (reply, answer) = mpsc::channel();
        self.jobs
            .send(Box::new(move |c| {
                let _ = reply.send(f(c));
            }))
            .expect("the PostgreSQL thread runs as long as the database is open");
        answer.recv().expect("the PostgreSQL thread answers")
    }
}

pub(crate) fn connect_mysql(url: &str) -> Result<RefCell<mysql::Conn>> {
    let opts =
        mysql::Opts::from_url(url).map_err(|e| Error::Db(format!("not a MySQL address: {e}")))?;
    let mut conn =
        mysql::Conn::new(opts).map_err(|e| Error::Db(format!("couldn't connect to MySQL: {e}")))?;
    // Strings are only quoted, never backslash-escaped; `||` joins text.
    mysql::prelude::Queryable::query_drop(
        &mut conn,
        "SET SESSION sql_mode = CONCAT(@@sql_mode, ',NO_BACKSLASH_ESCAPES,PIPES_AS_CONCAT'), \
         NAMES utf8mb4, time_zone = '+00:00'",
    )
    .map_err(my_error)?;
    Ok(RefCell::new(conn))
}

/// Make an empty database on a PostgreSQL or MySQL server (as reached by
/// `server`), named `name`; the address to open it by. For tests.
pub fn create_database(server: &str, name: &str) -> Result<String> {
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(crate::error::invalid(
            "a database name is letters, digits and _",
        ));
    }
    let base = match server.split_once("://") {
        Some((scheme, rest)) => {
            let host = rest.split('/').next().unwrap_or(rest);
            format!("{scheme}://{host}")
        }
        None => {
            return Err(crate::error::invalid(
                "give a postgres:// or mysql:// address",
            ));
        }
    };
    if server.starts_with("mysql://") {
        let c = connect_mysql(&format!("{base}/"))?;
        mysql::prelude::Queryable::query_drop(
            &mut *c.borrow_mut(),
            format!("CREATE DATABASE {name}"),
        )
        .map_err(my_error)?;
    } else {
        let pg = Pg::connect(server)?;
        let sql = format!("CREATE DATABASE {name}");
        pg.run(move |c| c.batch_execute(&sql)).map_err(pg_error)?;
    }
    Ok(format!("{base}/{name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sql_for_each_database() {
        let p = [Sql::Text("O'Brien".into()), Sql::Integer(7)];
        let sql = "SELECT group_concat(g.name, '|') AS tags FROM t WHERE a LIKE ?1 AND b = ?2 AND c = ?1 COLLATE NOCASE AND d = '?'";
        assert_eq!(
            adapt(sql, Dialect::Postgres, &p),
            "SELECT string_agg(g.name, '|') AS tags FROM t WHERE a ILIKE 'O''Brien' AND b = 7 AND c = 'O''Brien' AND d = '?'"
        );
        assert_eq!(
            adapt(sql, Dialect::Mysql, &p),
            "SELECT group_concat(g.name SEPARATOR '|') AS tags FROM t WHERE a LIKE 'O''Brien' AND b = 7 AND c = 'O''Brien' AND d = '?'"
        );
        assert_eq!(
            adapt(
                "INSERT OR IGNORE INTO tag (name) VALUES (?)",
                Dialect::Postgres,
                &p
            ),
            "INSERT INTO tag (name) VALUES ('O''Brien') ON CONFLICT DO NOTHING"
        );
        assert_eq!(
            adapt(
                "INSERT INTO s (k, v) VALUES (?1, ?2) ON CONFLICT (k) DO UPDATE SET v = ?2",
                Dialect::Mysql,
                &p
            ),
            "INSERT INTO s (k, v) VALUES ('O''Brien', 7) ON DUPLICATE KEY UPDATE v = 7"
        );
        assert_eq!(
            adapt(
                "SELECT ?, ?, ?",
                Dialect::Postgres,
                &[Sql::Null, Sql::Real(0.5), Sql::Blob(vec![1, 255])]
            ),
            "SELECT NULL, 0.5, '\\x01ff'::bytea"
        );
        assert_eq!(
            adapt("SELECT ?", Dialect::Mysql, &[Sql::Blob(vec![1, 255])]),
            "SELECT X'01ff'"
        );
        assert_eq!(
            split_statements("CREATE TABLE a (x INT); -- one\nCREATE INDEX b ON a (x);\n"),
            ["CREATE TABLE a (x INT)", "CREATE INDEX b ON a (x)"]
        );
    }
}
