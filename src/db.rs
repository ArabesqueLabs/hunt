//! The database, and the generic create/read/update/delete over the
//! resources in [`crate::resource`]. Every write is logged in `activity`.
//! Board-specific operations live in [`crate::service`]; running SQL on
//! SQLite, PostgreSQL or MySQL lives in [`crate::store`].

use jiff::civil::DateTime;
use serde_json::{Map, Value, json};

use crate::args;
use crate::error::{Constraint, Error, Result, invalid};
use crate::resource::{Field, FieldKind, Resource, option_label, resource};
pub(crate) use crate::store::Sql;
use crate::store::{Conn, Dialect, Row, Store};
use crate::time;

/// A record as the API sees it: its columns, plus `label`, a one-line name.
pub type Record = Map<String, Value>;

const SCHEMA: &str = include_str!("schema.sql");
const SCHEMA_POSTGRES: &str = include_str!("schema_postgres.sql");
const SCHEMA_MYSQL: &str = include_str!("schema_mysql.sql");
/// "hunt" in ASCII: marks a database as ours.
const APP_ID: i64 = 0x6875_6e74;
pub const SCHEMA_VERSION: i64 = 24;
/// The version schema*.sql describe: a new database is made at it, then
/// brought up to [`SCHEMA_VERSION`] by the migrations after it.
const SCHEMA_BASE: i64 = 14;
/// The SQL that takes a SQLite database from version `n` to `n + 1`, at
/// index `n - 1`. PostgreSQL and MySQL databases start at the current
/// version.
const MIGRATIONS: &[&str] = &[
    include_str!("migrate_v2.sql"),
    include_str!("migrate_v3.sql"),
    include_str!("migrate_v4.sql"),
    include_str!("migrate_v5.sql"),
    include_str!("migrate_v6.sql"),
    include_str!("migrate_v7.sql"),
    include_str!("migrate_v8.sql"),
    include_str!("migrate_v9.sql"),
    include_str!("migrate_v10.sql"),
    include_str!("migrate_v11.sql"),
    include_str!("migrate_v12.sql"),
    include_str!("migrate_v13.sql"),
    include_str!("migrate_v14.sql"),
    include_str!("migrate_v15.sql"),
    include_str!("migrate_v16.sql"),
    include_str!("migrate_v17.sql"),
    include_str!("migrate_v18.sql"),
    include_str!("migrate_v19.sql"),
    include_str!("migrate_v20.sql"),
    include_str!("migrate_v21.sql"),
    include_str!("migrate_v22.sql"),
    include_str!("migrate_v23.sql"),
    include_str!("migrate_v24.sql"),
];
/// Upgrades PostgreSQL and MySQL databases can take: (version reached, its
/// SQL for PostgreSQL, for MySQL). They start at version 8.
const SERVER_MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        9,
        include_str!("migrate_v9.sql"),
        include_str!("migrate_v9.sql"),
    ),
    (
        10,
        include_str!("migrate_v10.sql"),
        include_str!("migrate_v10.sql"),
    ),
    (
        11,
        include_str!("migrate_v11_postgres.sql"),
        include_str!("migrate_v11_mysql.sql"),
    ),
    (
        12,
        include_str!("migrate_v12_postgres.sql"),
        include_str!("migrate_v12_mysql.sql"),
    ),
    (
        13,
        include_str!("migrate_v13_postgres.sql"),
        include_str!("migrate_v13_mysql.sql"),
    ),
    (
        14,
        include_str!("migrate_v14_postgres.sql"),
        include_str!("migrate_v14_mysql.sql"),
    ),
    (
        15,
        include_str!("migrate_v15_postgres.sql"),
        include_str!("migrate_v15_mysql.sql"),
    ),
    (
        16,
        include_str!("migrate_v16_postgres.sql"),
        include_str!("migrate_v16_mysql.sql"),
    ),
    (
        17,
        include_str!("migrate_v17_postgres.sql"),
        include_str!("migrate_v17_mysql.sql"),
    ),
    (
        18,
        include_str!("migrate_v18_postgres.sql"),
        include_str!("migrate_v18_mysql.sql"),
    ),
    (
        19,
        include_str!("migrate_v19_postgres.sql"),
        include_str!("migrate_v19_mysql.sql"),
    ),
    (
        20,
        include_str!("migrate_v20_postgres.sql"),
        include_str!("migrate_v20_mysql.sql"),
    ),
    (
        21,
        include_str!("migrate_v21_postgres.sql"),
        include_str!("migrate_v21_mysql.sql"),
    ),
    (
        22,
        include_str!("migrate_v22_postgres.sql"),
        include_str!("migrate_v22_mysql.sql"),
    ),
    (
        23,
        include_str!("migrate_v23_postgres.sql"),
        include_str!("migrate_v23_mysql.sql"),
    ),
    (
        24,
        include_str!("migrate_v24_postgres.sql"),
        include_str!("migrate_v24_mysql.sql"),
    ),
];

pub const DEFAULT_STAGES: &[&str] = &[
    "Considering",
    "Applied",
    "Screening",
    "Interviewing",
    "Offer",
];

/// A new hunt's swimlanes, the board's rows: its active stages, then its
/// inactive (terminal) ones.
pub const DEFAULT_SWIMLANES: &[&str] = &["Active Processes", "Terminated Processes"];

/// A new hunt's lanes, under its stages: where a stage holds two waits
/// worth telling apart (the job-seeker FSM's Preparing, Deciding and
/// Accepted), without a column each.
pub const DEFAULT_LANES: &[(&str, &str)] = &[
    ("Considering", "Preparing"),
    ("Interviewing", "Waiting on a decision"),
    ("Offer", "Accepted"),
];

pub struct Db {
    pub(crate) store: Store,
    /// The clock, replaceable in tests. Read it through [`Db::clock`],
    /// which keeps to the time zone chosen in Settings.
    pub now: fn() -> DateTime,
    /// The time zone chosen in Settings (`locale.timezone`); none, the
    /// machine's own.
    pub(crate) zone: std::sync::Arc<std::sync::RwLock<Option<jiff::tz::TimeZone>>>,
    /// How mail is read: Gmail, or a mailbox in memory in tests.
    pub mailbox: crate::mail::Connect,
    /// Set while mail syncs: one sync at a time.
    pub(crate) syncing: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

/// Where a database is, as `--db` or `HUNT_DB` gives it, without its
/// password: for saying which one is in use.
pub fn describe(target: &str) -> String {
    match target.split_once("://") {
        Some((scheme, rest)) if matches!(scheme, "postgres" | "postgresql" | "mysql") => {
            let rest = match rest.rsplit_once('@') {
                Some((who, at)) => format!("{}@{at}", who.split(':').next().unwrap_or(who)),
                None => rest.to_string(),
            };
            format!("{scheme}://{rest}")
        }
        _ => target.trim_start_matches("sqlite://").to_string(),
    }
}

impl Db {
    /// Open a database: a file (SQLite; `sqlite://` before it is optional),
    /// or a `postgres://…` or `mysql://…` address. A new, empty one is set
    /// up; an older SQLite one is upgraded.
    pub fn open(target: impl AsRef<std::ffi::OsStr>) -> Result<Db> {
        let db = Db::open_store(target)?;
        db.load_zone()?;
        Ok(db)
    }

    fn open_store(target: impl AsRef<std::ffi::OsStr>) -> Result<Db> {
        let target = target.as_ref().to_string_lossy().into_owned();
        if target.starts_with("postgres://") || target.starts_with("postgresql://") {
            return Db::init_server(Store::new(Conn::Postgres(crate::store::Pg::connect(
                &target,
            )?)));
        }
        if target.starts_with("mysql://") {
            return Db::init_server(Store::new(Conn::Mysql(crate::store::connect_mysql(
                &target,
            )?)));
        }
        let path = std::path::PathBuf::from(target.strip_prefix("sqlite://").unwrap_or(&target));
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir)?;
        }
        Db::init(rusqlite::Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Db> {
        Db::init(rusqlite::Connection::open_in_memory()?)
    }

    /// Now, where hunt keeps time: in the zone chosen in Settings, or the
    /// machine's own. A clock replaced in tests is kept as it is.
    pub fn clock(&self) -> DateTime {
        if std::ptr::fn_addr_eq(self.now, time::now as fn() -> DateTime)
            && let Some(zone) = self.zone.read().ok().and_then(|z| z.clone())
        {
            return jiff::Timestamp::now().to_zoned(zone).datetime();
        }
        (self.now)()
    }

    /// The zone chosen in Settings, read when the database opens.
    fn load_zone(&self) -> Result<()> {
        let zone = self
            .setting("locale.timezone")?
            .and_then(|name| jiff::tz::TimeZone::get(&name).ok());
        self.set_zone(zone);
        Ok(())
    }

    pub(crate) fn set_zone(&self, zone: Option<jiff::tz::TimeZone>) {
        if let Ok(mut z) = self.zone.write() {
            *z = zone;
        }
    }

    fn with_store(store: Store) -> Db {
        Db {
            store,
            now: time::now,
            zone: Default::default(),
            mailbox: crate::mail::gmail(),
            syncing: Default::default(),
        }
    }

    pub fn dialect(&self) -> Dialect {
        self.store.dialect()
    }

    fn init(conn: rusqlite::Connection) -> Result<Db> {
        conn.pragma_update(None, "foreign_keys", true)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let db = Db::with_store(Store::new(Conn::Sqlite(conn)));
        let c = db.store.sqlite().expect("SQLite");
        let tables: i64 = c.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))?;
        let app: i64 = c.pragma_query_value(None, "application_id", |r| r.get(0))?;
        let version: i64 = c.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if tables == 0 {
            c.execute_batch(&format!(
                "BEGIN; {SCHEMA}; PRAGMA application_id = {APP_ID}; PRAGMA user_version = {SCHEMA_BASE}; COMMIT;"
            ))?;
            if SCHEMA_BASE < SCHEMA_VERSION {
                db.migrate(SCHEMA_BASE)?;
            }
            db.seed()?;
        } else if app != APP_ID {
            return Err(Error::ForeignDb("not a hunt database".into()));
        } else if !(1..=SCHEMA_VERSION).contains(&version) {
            return Err(Error::ForeignDb(format!("schema version {version}")));
        } else if version < SCHEMA_VERSION {
            db.migrate(version)?;
        }
        Ok(db)
    }

    /// PostgreSQL or MySQL: an empty database gets the schema, and
    /// `hunt_meta` says it's ours, at which version.
    fn init_server(store: Store) -> Result<Db> {
        let db = Db::with_store(store);
        let in_schema = match db.dialect() {
            Dialect::Mysql => "table_schema = DATABASE()",
            _ => "table_schema = current_schema()",
        };
        let tables = db.int(
            &format!("SELECT count(*) FROM information_schema.tables WHERE {in_schema}"),
            &[],
        )?;
        let has_meta = db.int(
            &format!(
                "SELECT count(*) FROM information_schema.tables WHERE {in_schema} AND table_name = 'hunt_meta'"
            ),
            &[],
        )? > 0;
        if tables == 0 {
            let schema = if db.dialect() == Dialect::Mysql {
                SCHEMA_MYSQL
            } else {
                SCHEMA_POSTGRES
            };
            db.store.batch(schema)?;
            db.exec(
                "INSERT INTO hunt_meta (name, value) VALUES ('app', 'hunt'), ('schema_version', ?1)",
                args![SCHEMA_BASE.to_string()],
            )?;
            db.upgrade_server(SCHEMA_BASE)?;
            db.atomic(|db| db.seed())?;
            return Ok(db);
        }
        if !has_meta {
            return Err(Error::ForeignDb(
                "not a hunt database: it has other tables".into(),
            ));
        }
        let version: i64 = db
            .text(
                "SELECT value FROM hunt_meta WHERE name = 'schema_version'",
                &[],
            )?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        if (8..SCHEMA_VERSION).contains(&version) {
            db.upgrade_server(version)?;
            return Ok(db);
        }
        if version != SCHEMA_VERSION {
            return Err(Error::ForeignDb(format!(
                "schema version {version}; this hunt uses {SCHEMA_VERSION}. Move the data with a backup: \
                 export it with the hunt that made it, import it into a new, empty database"
            )));
        }
        Ok(db)
    }

    /// Bring a PostgreSQL or MySQL database from `version` up to date, one
    /// version at a time.
    fn upgrade_server(&self, version: i64) -> Result<()> {
        for (to, pg, my) in SERVER_MIGRATIONS.iter().filter(|(to, _, _)| *to > version) {
            self.store.batch(if self.dialect() == Dialect::Mysql {
                my
            } else {
                pg
            })?;
            self.exec(
                "UPDATE hunt_meta SET value = ?1 WHERE name = 'schema_version'",
                args![to.to_string()],
            )?;
        }
        Ok(())
    }

    /// Bring an older SQLite database up to date, one version at a time,
    /// each all or nothing. Foreign keys are off meanwhile, as SQLite needs
    /// to rebuild a table, and checked before each commit.
    fn migrate(&self, from: i64) -> Result<()> {
        let c = self.store.sqlite().expect("only SQLite is upgraded");
        c.pragma_update(None, "foreign_keys", false)?;
        let result = (from..SCHEMA_VERSION).try_for_each(|v| {
            let sql = MIGRATIONS[(v - 1) as usize];
            c.execute_batch(&format!("BEGIN; {sql}; PRAGMA user_version = {};", v + 1))?;
            let broken: i64 =
                c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
                    r.get(0)
                })?;
            if broken > 0 {
                c.execute_batch("ROLLBACK")?;
                return Err(Error::ForeignDb(format!(
                    "upgrading from schema version {v} would break {broken} references"
                )));
            }
            c.execute_batch("COMMIT")?;
            Ok(())
        });
        if result.is_err() && !c.is_autocommit() {
            let _ = c.execute_batch("ROLLBACK");
        }
        c.pragma_update(None, "foreign_keys", true)?;
        result
    }

    /// A new database starts with the usual stages, so the board works
    /// straight away. They can be changed in Settings.
    /// A new hunt's stages, and its inactive ones with the reasons for
    /// closing as their lanes: the database's, or (with an owner set) an
    /// account's.
    pub fn seed(&self) -> Result<()> {
        let at = time::stamp(self.clock());
        for (i, name) in DEFAULT_STAGES.iter().enumerate() {
            self.exec(
                "INSERT INTO stage (name, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                args![name, i, at],
            )?;
            let stage = self.int(
                "SELECT id FROM stage WHERE name = ?1 ORDER BY id DESC LIMIT 1",
                args![name],
            )?;
            for (j, (_, lane)) in DEFAULT_LANES.iter().filter(|(s, _)| s == name).enumerate() {
                self.exec(
                    "INSERT INTO lane (stage_id, name, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                    args![stage, lane, j, at],
                )?;
            }
        }
        for (i, name) in crate::resource::CLOSED_STAGES.iter().enumerate() {
            let closed = self.insert(
                "INSERT INTO stage (name, position, active, folded, created_at, updated_at) VALUES (?1, ?2, 0, 1, ?3, ?3)",
                args![name, DEFAULT_STAGES.len() + i, at],
            )?;
            let reasons = crate::resource::ARCHIVE_REASONS.iter().filter(|r| r.2 == i);
            for (j, (value, label, _)) in reasons.enumerate() {
                self.exec(
                    "INSERT INTO lane (stage_id, name, value, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                    args![closed, label, value, j, at],
                )?;
            }
        }
        self.seed_swimlanes()?;
        self.seed_cycle()?;
        Ok(())
    }

    /// The board's swimlanes a hunt starts with: its active stages in the
    /// first, its inactive (terminal) ones in the second.
    pub(crate) fn seed_swimlanes(&self) -> Result<()> {
        let at = time::stamp(self.clock());
        for (i, name) in DEFAULT_SWIMLANES.iter().enumerate() {
            let lane = self.insert(
                "INSERT INTO swimlane (name, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                args![name, i, at],
            )?;
            self.exec(
                "UPDATE stage SET swimlane_id = ?1 WHERE active = ?2",
                args![lane, i64::from(i == 0)],
            )?;
        }
        Ok(())
    }

    pub(crate) fn stamp(&self) -> String {
        time::stamp(self.clock())
    }

    /// Run `f` all or nothing. Nests.
    pub(crate) fn atomic<T>(&self, f: impl FnOnce(&Db) -> Result<T>) -> Result<T> {
        self.store.atomic(|| f(self))
    }

    /// The database answers.
    pub fn ping(&self) -> Result<()> {
        self.int("SELECT 1", &[]).map(drop)
    }

    // --- running SQL -----------------------------------------------------------

    /// Rows as records: file contents read as null (see [`Db::rows`]). Who
    /// owns a row is the store's business, not the record's.
    pub(crate) fn query(&self, sql: &str, params: &[Sql]) -> Result<Vec<Record>> {
        Ok(self
            .store
            .rows(sql, params)?
            .into_iter()
            .map(|row| {
                row.into_iter()
                    .filter(|(k, _)| k != "owner_id")
                    .map(|(k, v)| (k, from_sql(v)))
                    .collect()
            })
            .collect())
    }

    /// Run what follows for `owner` (an account): every statement scoped to
    /// its rows (see [`crate::scope`]). None: every row.
    pub fn set_owner(&self, owner: Option<i64>) {
        self.store.set_owner(owner);
    }

    /// The account statements run for, if any.
    pub fn owner(&self) -> Option<i64> {
        self.store.owner()
    }

    pub(crate) fn rows(&self, sql: &str, params: &[Sql]) -> Result<Vec<Row>> {
        self.store.rows(sql, params)
    }

    pub(crate) fn exec(&self, sql: &str, params: &[Sql]) -> Result<usize> {
        self.store.exec(sql, params)
    }

    /// Insert a row; its new id.
    pub(crate) fn insert(&self, sql: &str, params: &[Sql]) -> Result<i64> {
        self.store.insert(sql, params)
    }

    /// The first column of the first row, if any.
    pub(crate) fn scalar(&self, sql: &str, params: &[Sql]) -> Result<Option<Sql>> {
        Ok(self
            .store
            .rows(sql, params)?
            .into_iter()
            .next()
            .and_then(|row| row.into_iter().next())
            .map(|(_, v)| v))
    }

    /// A number, from the first column of the first row (0 when none).
    pub(crate) fn int(&self, sql: &str, params: &[Sql]) -> Result<i64> {
        Ok(match self.scalar(sql, params)? {
            Some(Sql::Integer(n)) => n,
            Some(Sql::Real(f)) => f as i64,
            Some(Sql::Text(t)) => t.parse().unwrap_or(0),
            _ => 0,
        })
    }

    /// Text, from the first column of the first row.
    pub(crate) fn text(&self, sql: &str, params: &[Sql]) -> Result<Option<String>> {
        Ok(match self.scalar(sql, params)? {
            Some(Sql::Text(t)) => Some(t),
            Some(Sql::Integer(n)) => Some(n.to_string()),
            Some(Sql::Real(f)) => Some(f.to_string()),
            _ => None,
        })
    }

    /// Records of a resource. `q` matches words anywhere in their search
    /// text; `filters` are exact matches on fields (or `id`).
    pub fn list(
        &self,
        r: &Resource,
        q: Option<&str>,
        filters: &[(String, String)],
        limit: Option<usize>,
    ) -> Result<Vec<Record>> {
        let mut sql = format!(
            "SELECT t.*, {} AS label FROM {} t {} WHERE 1 = 1",
            r.label_sql, r.table, r.joins
        );
        let mut params = Vec::new();
        for word in q.unwrap_or("").split_whitespace() {
            sql += &format!(" AND ({}) LIKE ?", r.search_sql);
            params.push(Sql::Text(format!("%{word}%")));
        }
        for (k, v) in filters {
            // `tag=name`: records carrying that tag.
            if k == "tag" && r.taggable {
                sql += " AND t.id IN (SELECT x.entity_id FROM tagging x JOIN tag g ON g.id = x.tag_id \
                         WHERE x.entity = ? AND lower(g.name) = lower(?))";
                params.push(Sql::Text(r.entity.into()));
                params.push(Sql::Text(v.clone()));
                continue;
            }
            if k != "id" && r.field(k).is_none() {
                return Err(invalid(format!("{} have no field {k:?}", r.name)));
            }
            if v.is_empty() {
                sql += &format!(" AND t.{k} IS NULL");
            } else {
                sql += &format!(" AND t.{k} = ?");
                params.push(Sql::Text(v.clone()));
            }
        }
        sql += &format!(" ORDER BY {}", r.order_sql);
        if let Some(n) = limit {
            sql += &format!(" LIMIT {n}");
        }
        let mut rows = self.query(&sql, &params)?;
        if r.taggable {
            self.attach_tags(r, &mut rows)?;
        }
        if r.entity == "step" {
            self.attach_step_people(&mut rows)?;
        }
        Ok(rows)
    }

    /// Give each step who it's with: `people`, as `{id, name, photo}`.
    fn attach_step_people(&self, rows: &mut [Record]) -> Result<()> {
        let ids: Vec<String> = rows
            .iter()
            .filter_map(|r| r.get("id").and_then(Value::as_i64))
            .map(|id| id.to_string())
            .collect();
        let mut by_step: std::collections::HashMap<i64, Vec<Value>> =
            std::collections::HashMap::new();
        if !ids.is_empty() {
            for r in self.query(
                &format!(
                    "SELECT sp.step_id, p.id, p.name, p.photo FROM step_person sp \
                     JOIN person p ON p.id = sp.person_id WHERE sp.step_id IN ({}) ORDER BY lower(p.name)",
                    ids.join(", ")
                ),
                &[],
            )? {
                let step = r["step_id"].as_i64().unwrap_or(0);
                by_step
                    .entry(step)
                    .or_default()
                    .push(json!({ "id": r["id"], "name": r["name"], "photo": r["photo"] }));
            }
        }
        for rec in rows {
            let id = rec.get("id").and_then(Value::as_i64).unwrap_or(0);
            rec.insert(
                "people".into(),
                Value::Array(by_step.remove(&id).unwrap_or_default()),
            );
        }
        Ok(())
    }

    /// Give each record its tags: `tags`, a list of names.
    fn attach_tags(&self, r: &Resource, rows: &mut [Record]) -> Result<()> {
        let mut by_id: std::collections::HashMap<i64, Vec<Value>> =
            std::collections::HashMap::new();
        for row in self.query(
            "SELECT x.entity_id, g.name FROM tagging x JOIN tag g ON g.id = x.tag_id \
             WHERE x.entity = ?1 ORDER BY lower(g.name)",
            args![r.entity],
        )? {
            if let (Some(id), Some(name)) = (row["entity_id"].as_i64(), row["name"].as_str()) {
                by_id.entry(id).or_default().push(Value::from(name));
            }
        }
        for rec in rows {
            let id = rec.get("id").and_then(Value::as_i64).unwrap_or(0);
            rec.insert(
                "tags".into(),
                Value::Array(by_id.remove(&id).unwrap_or_default()),
            );
        }
        Ok(())
    }

    pub fn get(&self, r: &Resource, id: i64) -> Result<Record> {
        self.list(r, None, &[("id".into(), id.to_string())], None)?
            .pop()
            .ok_or_else(|| Error::NotFound(format!("no {} #{id}", r.entity)))
    }

    pub(crate) fn label_of(&self, resource_name: &str, id: &Value) -> String {
        let Some(id) = id.as_i64() else {
            return "—".into();
        };
        resource(resource_name)
            .and_then(|r| self.get(r, id).ok())
            .and_then(|rec| rec.get("label").and_then(|l| l.as_str()).map(String::from))
            .unwrap_or_else(|| format!("#{id}"))
    }

    /// Earlier values of a free-text field, most used first, for suggestions;
    /// of a field with options, those in your own words.
    pub fn suggestions(&self, r: &Resource, field: &str, q: &str) -> Result<Vec<String>> {
        let f = r
            .field(field)
            .filter(|f| f.suggest)
            .ok_or_else(|| invalid(format!("no suggestions for {}.{field}", r.entity)))?;
        let sql = format!(
            "SELECT min({0}) AS v FROM {1} WHERE {0} IS NOT NULL AND {0} LIKE ?1 \
             GROUP BY lower({0}) ORDER BY count(*) DESC, min({0}) LIMIT 20",
            f.name, r.table
        );
        Ok(self
            .query(&sql, args![format!("%{q}%")])?
            .into_iter()
            .filter_map(|r| r["v"].as_str().map(String::from))
            .filter(|v| match f.kind {
                FieldKind::Enum { options } => options.iter().all(|(o, _)| o != v),
                _ => true,
            })
            .collect())
    }

    // --- writing -------------------------------------------------------------

    pub fn create(&self, r: &Resource, input: &Record) -> Result<Record> {
        self.atomic(|db| {
            let mut set = db.check_input(r, input, None)?;
            db.before_create(r, &mut set)?;
            for f in r.fields {
                if f.required && !f.defaulted && set.iter().all(|(n, _)| *n != f.name) {
                    return Err(invalid(format!(
                        "{} needs a {}",
                        r.entity,
                        f.label.to_lowercase()
                    )));
                }
            }
            let at = db.stamp();
            let cols: Vec<&str> = set.iter().map(|(n, _)| *n).collect();
            let mut values: Vec<Sql> = set.iter().map(|(_, v)| to_sql(v)).collect();
            values.push(Sql::Text(at.clone()));
            let sql = format!(
                "INSERT INTO {} ({}created_at, updated_at) VALUES ({}?{n}, ?{n})",
                r.table,
                cols.iter().map(|c| format!("{c}, ")).collect::<String>(),
                (1..=cols.len())
                    .map(|i| format!("?{i}, "))
                    .collect::<String>(),
                n = cols.len() + 1,
            );
            let id = db.insert(&sql, &values).map_err(|e| constraint(r, e))?;
            if r.entity == "application" {
                db.convert_gbp(id)?;
            }
            let rec = db.get(r, id)?;
            let changes: Map<String, Value> = set
                .iter()
                .filter(|(n, v)| r.field(n).is_some() && !v.is_null())
                .map(|(n, v)| (n.to_string(), json!([null, v])))
                .collect();
            db.log(
                &at,
                r,
                &rec,
                "created",
                &format!("Added {} {}", r.entity, label(&rec)),
                Some(Value::Object(changes)),
            )?;
            Ok(rec)
        })
    }

    pub fn update(&self, r: &Resource, id: i64, patch: &Record) -> Result<Record> {
        self.atomic(|db| {
            let old = db.get(r, id)?;
            let mut set = db.check_input(r, patch, Some(&old))?;
            set.retain(|(n, v)| old.get(*n) != Some(v));
            let quiet = db.before_update(r, &old, &mut set)?;
            if set.is_empty() && quiet.is_empty() {
                return Ok(old);
            }
            let at = db.stamp();
            let all: Vec<&(&str, Value)> = set.iter().chain(quiet.iter()).collect();
            let mut values: Vec<Sql> = all.iter().map(|(_, v)| to_sql(v)).collect();
            values.push(Sql::Text(at.clone()));
            values.push(Sql::Integer(id));
            let n = all.len();
            let sql = format!(
                "UPDATE {} SET {}updated_at = ?{} WHERE id = ?{}",
                r.table,
                all.iter()
                    .enumerate()
                    .map(|(i, (c, _))| format!("{c} = ?{}, ", i + 1))
                    .collect::<String>(),
                n + 1,
                n + 2
            );
            db.exec(&sql, &values).map_err(|e| constraint(r, e))?;
            if r.entity == "application"
                && set
                    .iter()
                    .any(|(k, _)| matches!(*k, "salary_min" | "salary_max" | "currency"))
            {
                db.convert_gbp(id)?;
            }
            if r.entity == "stage" && set.iter().any(|(k, _)| *k == "active") {
                db.settle_stage(id)?;
            }
            let rec = db.get(r, id)?;
            if !set.is_empty() {
                let changes: Map<String, Value> = set
                    .iter()
                    .map(|(n, v)| {
                        (
                            n.to_string(),
                            json!([old.get(*n).cloned().unwrap_or(Value::Null), v]),
                        )
                    })
                    .collect();
                let summary = db.describe_update(r, &old, &rec, &changes);
                db.log(
                    &at,
                    r,
                    &rec,
                    "updated",
                    &summary,
                    Some(Value::Object(changes)),
                )?;
            }
            Ok(rec)
        })
    }

    pub fn delete(&self, r: &Resource, id: i64) -> Result<Record> {
        self.atomic(|db| {
            let old = db.get(r, id)?;
            // A reason for closing gone: what was closed for it stays closed,
            // in its stage, for no reason given.
            if r.entity == "lane" {
                let code = db.lane_code(id)?;
                db.exec(
                    "UPDATE process SET lane_id = NULL, archive_reason = NULL WHERE lane_id = ?1 AND archive_reason = ?2",
                    args![id, code],
                )?;
            }
            db.exec(&format!("DELETE FROM {} WHERE id = ?1", r.table), args![id])
                .map_err(|e| match e {
                    Error::Constraint { .. } => Error::Conflict(format!(
                        "{} {} is still in use{}",
                        r.entity,
                        label(&old),
                        match r.entity {
                            "company" => ": it has applications. Delete those first.",
                            "stage" => ": processes are in it. Move them first.",
                            "cycle" => ": applications are in it. Move or delete them first.",
                            "document" | "version" =>
                                ": it's recorded as sent with a process. Take it off there first.",
                            _ => ".",
                        }
                    )),
                    e => e,
                })?;
            db.log(
                &db.stamp(),
                r,
                &old,
                "deleted",
                &format!("Deleted {} {}", r.entity, label(&old)),
                Some(Value::Object(old.clone())),
            )?;
            if matches!(r.entity, "document" | "version" | "company" | "person") {
                db.prune_blobs()?;
            }
            if r.taggable {
                db.exec(
                    "DELETE FROM tagging WHERE entity = ?1 AND entity_id = ?2",
                    args![r.entity, id],
                )?;
            }
            Ok(old)
        })
    }

    /// Drop file contents nothing uses any more: no version, no logo.
    pub(crate) fn prune_blobs(&self) -> Result<()> {
        self.exec(
            // Everyone's references count: file contents are shared.
            "DELETE FROM stored_file /* all owners */ WHERE sha256 NOT IN (SELECT sha256 FROM version) \
             AND sha256 NOT IN (SELECT logo FROM company WHERE logo IS NOT NULL) \
             AND sha256 NOT IN (SELECT photo FROM person WHERE photo IS NOT NULL)",
            &[],
        )?;
        Ok(())
    }

    pub(crate) fn log(
        &self,
        at: &str,
        r: &Resource,
        rec: &Record,
        action: &str,
        summary: &str,
        changes: Option<Value>,
    ) -> Result<()> {
        let process_id = match r.process_sql {
            Some("t.id") => rec.get("id").and_then(Value::as_i64),
            Some(_) => rec.get("process_id").and_then(Value::as_i64),
            None => None,
        };
        self.exec(
            "INSERT INTO activity (at, entity, entity_id, process_id, action, summary, changes) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            args![
                at,
                r.entity,
                rec.get("id").and_then(Value::as_i64).unwrap_or(0),
                process_id,
                action,
                summary,
                changes.map(|c| c.to_string()),
            ],
        )?;
        Ok(())
    }

    /// Check every field given, and turn it into what's stored. Read-only
    /// keys (`id`, `label`, stamps) are ignored, so a record read from the
    /// API can be sent back.
    fn check_input(
        &self,
        r: &Resource,
        input: &Record,
        old: Option<&Record>,
    ) -> Result<Vec<(&'static str, Value)>> {
        let mut out = Vec::new();
        for (k, v) in input {
            if matches!(
                k.as_str(),
                "id" | "label" | "created_at" | "updated_at" | "position"
                    // Derived, not set: a company's logo has its own endpoint,
                    // and GBP figures follow the pay.
                    | "tags" | "people" | "mail_label" | "emails" | "logo" | "logo_type" | "photo" | "photo_type" | "salary_min_gbp" | "salary_max_gbp" | "gbp_rate" | "gbp_rate_on"
                    // A daily prep item's streak follows from ticking it off.
                    | "streak" | "last_done_on"
            ) {
                continue;
            }
            // A process's next action was a field; it's a reminder now.
            if r.entity == "process" && matches!(k.as_str(), "next_action" | "next_due") {
                if v.is_null() {
                    continue;
                }
                return Err(invalid(
                    "a next action is a reminder now: POST /api/reminders with its process_id, title and due_at",
                ));
            }
            let f = r.field(k).ok_or_else(|| {
                invalid(format!(
                    "{} have no field {k:?}; they have {}",
                    r.name,
                    r.fields
                        .iter()
                        .map(|f| f.name)
                        .collect::<Vec<_>>()
                        .join(", ")
                ))
            })?;
            if f.readonly {
                // Settable when created, fixed after.
                if old.is_some() {
                    if old.and_then(|o| o.get(k)) != Some(v) {
                        return Err(invalid(format!("{} can't be changed", f.label)));
                    }
                    continue;
                }
            }
            let v = self.check_value(r, f, v, old)?;
            if v.is_null() && f.required {
                if old.is_some() || !f.defaulted {
                    return Err(invalid(format!("{} can't be empty", f.label)));
                }
                continue;
            }
            out.push((f.name, v));
        }
        // In the resource's own field order, so change logs read naturally.
        out.sort_by_key(|(n, _)| r.fields.iter().position(|f| f.name == *n));
        Ok(out)
    }

    fn check_value(
        &self,
        r: &Resource,
        f: &Field,
        v: &Value,
        old: Option<&Record>,
    ) -> Result<Value> {
        let text = match v {
            Value::Null => return Ok(Value::Null),
            Value::String(s) => s.trim().to_string(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            _ => return Err(invalid(format!("{}: expected text", f.label))),
        };
        if text.is_empty() {
            return Ok(Value::Null);
        }
        Ok(match f.kind {
            FieldKind::Text if r.entity == "application" && f.name == "currency" => {
                Value::String(crate::fx::normalize_currency(&text).ok_or_else(|| {
                    invalid(format!(
                        "Currency: {text:?} isn't a currency; use a code like GBP, USD, EUR"
                    ))
                })?)
            }
            FieldKind::Text | FieldKind::LongText | FieldKind::Url => Value::String(text),
            FieldKind::Email => {
                if !text.contains('@') {
                    return Err(invalid(format!(
                        "{}: not an email address: {text:?}",
                        f.label
                    )));
                }
                Value::String(text)
            }
            FieldKind::Number => {
                let n = text.replace([',', '_'], "");
                let n = match n.to_lowercase().strip_suffix('k') {
                    Some(k) => k.parse::<f64>().map(|k| (k * 1000.0).round() as i64),
                    None => n.parse::<f64>().map(|v| v.round() as i64),
                };
                Value::from(n.map_err(|_| invalid(format!("{}: not a number: {text:?}", f.label)))?)
            }
            FieldKind::Choice { .. } => {
                // A reason for closing: a lane of an inactive stage, by its
                // code or its name.
                let closing = "FROM lane l JOIN stage s ON s.id = l.stage_id WHERE s.active = 0";
                let found = self.text(
                    &format!(
                        "SELECT {LANE_CODE} {closing} AND ({LANE_CODE} = ?1 OR lower(l.name) = lower(?1)) \
                         ORDER BY s.position, l.position LIMIT 1"
                    ),
                    args![text],
                )?;
                match found {
                    Some(v) => Value::String(v),
                    None => {
                        let all: Vec<String> = self
                            .query(
                                &format!(
                                    "SELECT {LANE_CODE} AS value {closing} ORDER BY s.position, l.position"
                                ),
                                &[],
                            )?
                            .into_iter()
                            .filter_map(|r| r["value"].as_str().map(String::from))
                            .collect();
                        return Err(invalid(format!(
                            "{}: {text:?} isn't one of {}",
                            f.label,
                            all.join(", ")
                        )));
                    }
                }
            }
            FieldKind::Date => Value::String(time::check_date(&text)?),
            FieldKind::DateTime => Value::String(time::check_datetime(&text)?),
            FieldKind::Enum { options } => {
                let found = options
                    .iter()
                    .find(|(v, l)| v.eq_ignore_ascii_case(&text) || l.eq_ignore_ascii_case(&text));
                match found {
                    Some((v, _)) => Value::String(v.to_string()),
                    // One that suggests takes your own words too.
                    None if f.suggest => Value::String(text),
                    None => {
                        return Err(invalid(format!(
                            "{}: {text:?} isn't one of {}",
                            f.label,
                            options
                                .iter()
                                .map(|(v, _)| *v)
                                .collect::<Vec<_>>()
                                .join(", ")
                        )));
                    }
                }
            }
            FieldKind::Ref { resource: target } => {
                let id: i64 = text
                    .trim_start_matches('#')
                    .parse()
                    .map_err(|_| invalid(format!("{}: not an id: {text:?}", f.label)))?;
                let target = resource(target).expect("refs name resources");
                if self.get(target, id).is_err() {
                    return Err(invalid(format!(
                        "{}: there is no {} #{id}",
                        f.label, target.entity
                    )));
                }
                if target.entity == r.entity
                    && old.and_then(|o| o.get("id")).and_then(Value::as_i64) == Some(id)
                {
                    return Err(invalid(format!(
                        "{}: a {} can't point at itself",
                        f.label, r.entity
                    )));
                }
                Value::from(id)
            }
        })
    }

    /// Fill in what a new record needs that the database can't default.
    fn before_create(&self, r: &Resource, set: &mut Vec<(&'static str, Value)>) -> Result<()> {
        let has = |set: &Vec<(&str, Value)>, n: &str| set.iter().any(|(k, _)| *k == n);
        match r.entity {
            "version" => {
                return Err(invalid(
                    "a version is made by uploading its file: POST /api/documents/{id}/versions",
                ));
            }
            "stage" => {
                check_flag(set, "folded", "Folded: 1 for folded, 0 for not")?;
                let next = self.int("SELECT coalesce(max(position) + 1, 0) FROM stage", &[])?;
                set.push(("position", Value::from(next)));
                // In the first swimlane, unless it's said which.
                if !has(set, "swimlane_id") {
                    let first = self.int(
                        "SELECT coalesce(min(id), 0) FROM swimlane WHERE position = (SELECT min(position) FROM swimlane)",
                        &[],
                    )?;
                    if first > 0 {
                        set.push(("swimlane_id", Value::from(first)));
                    }
                }
            }
            "swimlane" => {
                check_flag(set, "folded", "Folded: 1 for folded, 0 for not")?;
                let next = self.int("SELECT coalesce(max(position) + 1, 0) FROM swimlane", &[])?;
                set.push(("position", Value::from(next)));
            }
            "lane" => {
                check_flag_or(set, "folded", "Folded: 1 for folded, 0 for not", true)?;
                let stage = set
                    .iter()
                    .find(|(k, _)| *k == "stage_id")
                    .and_then(|(_, v)| v.as_i64())
                    .unwrap_or(0);
                self.check_lane_default(stage, None, set)?;
                if !has(set, "position") {
                    let next = self.int(
                        "SELECT coalesce(max(position) + 1, 0) FROM lane WHERE stage_id = ?1",
                        args![stage],
                    )?;
                    set.push(("position", Value::from(next)));
                }
            }
            "cycle" => {
                if !has(set, "started_on") {
                    set.push(("started_on", Value::from(time::date(self.clock().date()))));
                }
                self.check_cycle(set, None)?;
            }
            "prep" => {
                // A step's prep is for its process.
                let step = set
                    .iter()
                    .find(|(k, _)| *k == "step_id")
                    .map(|(_, v)| v.clone());
                if let Some(step) = step.and_then(|v| v.as_i64())
                    && !has(set, "process_id")
                {
                    let process =
                        self.int("SELECT process_id FROM step WHERE id = ?1", args![step])?;
                    set.push(("process_id", Value::from(process)));
                }
            }
            "process" => {
                if !has(set, "cycle_id") {
                    set.push(("cycle_id", Value::from(self.default_cycle()?)));
                }
                let cycle = set
                    .iter()
                    .find(|(k, _)| *k == "cycle_id")
                    .map(|(_, v)| v.clone());
                self.check_cycle_open(&cycle.unwrap_or(Value::Null))?;
                if !has(set, "stage_id") {
                    let first = self.first_stage()?;
                    if first == 0 {
                        return Err(invalid("add a stage in Settings first"));
                    }
                    set.push(("stage_id", Value::from(first)));
                }
                self.settle_process(None, set)?;
                let stage = field_of(set, "stage_id").as_i64().unwrap_or(0);
                let end = self.column_end(stage)?;
                set.push(("position", Value::from(end)));
            }
            _ => {}
        }
        Ok(())
    }

    /// Keep an update consistent. Returns writes that follow from the
    /// change and aren't worth logging on their own (a card's position).
    fn before_update(
        &self,
        r: &Resource,
        old: &Record,
        set: &mut Vec<(&'static str, Value)>,
    ) -> Result<Vec<(&'static str, Value)>> {
        let mut quiet = Vec::new();
        if r.entity == "cycle" {
            self.check_cycle(set, Some(old))?;
        }
        if r.entity == "stage" {
            self.check_stage_active(old, set)?;
        }
        if matches!(r.entity, "stage" | "swimlane" | "lane") {
            let says = "Folded: 1 for folded, 0 for not";
            check_flag_or(set, "folded", says, r.entity == "lane")?;
        }
        if r.entity == "lane" {
            let stage = old["stage_id"].as_i64().unwrap_or(0);
            self.check_lane_default(stage, old["id"].as_i64(), set)?;
        }
        if r.entity != "process" {
            return Ok(quiet);
        }
        // An ended cycle's board stays as it was; a process moves only to a
        // cycle that's running.
        self.check_process_open(old)?;
        if let Some((_, cycle)) = set.iter().find(|(k, _)| *k == "cycle_id") {
            self.check_cycle_open(cycle)?;
        }
        self.settle_process(Some(old), set)?;
        if set
            .iter()
            .any(|(k, v)| *k == "stage_id" && old.get("stage_id") != Some(v))
        {
            let end = self.column_end(field_of(set, "stage_id").as_i64().unwrap_or(0))?;
            quiet.push(("position", Value::from(end)));
        }
        Ok(quiet)
    }

    /// Where a process is going, and what follows from it. Its stage says
    /// whether it's open: in an inactive stage it's closed (`status`
    /// archived), its lane's code is why (`archive_reason`), and the active
    /// stage it was in is kept (`reached_stage_id`), as how far it got.
    ///
    /// So closing is a move, and so is reopening; the older way of saying
    /// either is kept: `status` archived with an `archive_reason` (a closing
    /// lane's code) moves it to that lane, any active `stage_id` given being
    /// how far it got; `status` active moves it back to the stage it reached.
    pub(crate) fn settle_process(
        &self,
        old: Option<&Record>,
        set: &mut Vec<(&'static str, Value)>,
    ) -> Result<()> {
        let given = |set: &Vec<(&str, Value)>, n: &str| set.iter().any(|(k, _)| *k == n);
        let was = |n: &str| old.and_then(|o| o.get(n)).cloned().unwrap_or(Value::Null);
        let was_closed = was("status") == "archived";
        let status = field_of(set, "status");
        let reason = field_of(set, "archive_reason");
        let mut stage = if given(set, "stage_id") {
            field_of(set, "stage_id").as_i64()
        } else {
            None
        };
        let mut lane = if given(set, "lane_id") {
            Some(field_of(set, "lane_id"))
        } else {
            None
        };
        // How far it got, if this is where it is now and it's active.
        let mut reached = if was_closed {
            was("reached_stage_id")
        } else {
            was("stage_id")
        };
        // Closing, or a closed one's reason changing; an already closed one
        // said to be closed again, without a reason, stays where it is.
        let reason_given = !reason.is_null();
        let closing = (status == "archived" && (!was_closed || reason_given))
            || (reason_given && status.is_null() && was_closed);
        if closing && !stage.is_some_and(|s| !self.stage_active(s)) {
            // Closed for a reason: to its lane. A stage given with it is how far it got.
            let code = if reason.is_null() {
                was("archive_reason")
            } else {
                reason.clone()
            };
            let Some(code) = code.as_str().filter(|c| !c.is_empty()) else {
                return Err(invalid("say why it's closed (archive_reason)"));
            };
            let (to_stage, to_lane) = self.closing_lane(code)?;
            if let Some(s) = stage {
                reached = Value::from(s);
            }
            stage = Some(to_stage);
            lane = Some(Value::from(to_lane));
        } else if status == "active" && was_closed && stage.is_none() {
            // Reopened: back to the stage it reached, or the board's first.
            let back = reached.as_i64().filter(|s| self.stage_active(*s));
            stage = Some(match back {
                Some(s) => s,
                None => self.first_stage()?,
            });
        }
        let stage_now = stage.or_else(|| was("stage_id").as_i64()).unwrap_or(0);
        if stage.is_some() && stage != was("stage_id").as_i64() && lane.is_none() {
            // A lane belongs to its stage: to another stage, out of the
            // lane, into that stage's default one (if it has one).
            lane = Some(match self.default_lane(stage_now)? {
                Some(l) => Value::from(l),
                None => Value::Null,
            });
        }
        let lane_now = lane.clone().unwrap_or_else(|| was("lane_id"));
        self.check_lane(stage_now, &lane_now)?;
        let active = self.stage_active(stage_now);
        if active {
            reached = Value::from(stage_now);
        }
        set.retain(|(k, _)| {
            !matches!(
                *k,
                "stage_id" | "lane_id" | "status" | "archive_reason" | "reached_stage_id"
            )
        });
        if old.is_none() || stage_now != was("stage_id").as_i64().unwrap_or(0) {
            set.push(("stage_id", Value::from(stage_now)));
        }
        if old.is_none() || lane_now != was("lane_id") {
            set.push(("lane_id", lane_now.clone()));
        }
        let status_now = Value::from(if active { "active" } else { "archived" });
        if old.is_none() || status_now != was("status") {
            set.push(("status", status_now));
        }
        let code = match lane_now.as_i64() {
            Some(l) if !active => Value::from(self.lane_code(l)?),
            _ => Value::Null,
        };
        if old.is_none() || code != was("archive_reason") {
            set.push(("archive_reason", code));
        }
        if old.is_none() || reached != was("reached_stage_id") {
            set.push(("reached_stage_id", reached));
        }
        Ok(())
    }

    /// A stage is active (1) or not (0); the board keeps one active, at least.
    fn check_stage_active(&self, old: &Record, set: &mut [(&'static str, Value)]) -> Result<()> {
        check_flag(set, "active", "Active: 1 for active, 0 for inactive")?;
        let Some(on) = set
            .iter()
            .find(|(k, _)| *k == "active")
            .map(|(_, v)| v != 0)
        else {
            return Ok(());
        };
        let others = self.int(
            "SELECT count(*) FROM stage WHERE active = 1 AND id <> ?1",
            args![old["id"].clone()],
        )?;
        if !on && others == 0 {
            return Err(invalid(
                "the board needs an active stage: make another active first",
            ));
        }
        Ok(())
    }

    /// A stage made active or inactive: its processes open, or close (their
    /// lane being why), with it.
    fn settle_stage(&self, stage: i64) -> Result<()> {
        if self.stage_active(stage) {
            self.exec(
                "UPDATE process SET status = 'active', archive_reason = NULL, reached_stage_id = stage_id \
                 WHERE stage_id = ?1",
                args![stage],
            )?;
        } else {
            self.exec(
                &format!(
                    "UPDATE process SET status = 'archived', \
                     archive_reason = (SELECT {LANE_CODE} FROM lane l WHERE l.id = process.lane_id) \
                     WHERE stage_id = ?1"
                ),
                args![stage],
            )?;
        }
        Ok(())
    }

    /// The first active stage, by position: where a new process goes. 0: none.
    pub(crate) fn first_stage(&self) -> Result<i64> {
        self.int(
            "SELECT id FROM stage WHERE active = 1 ORDER BY position, id LIMIT 1",
            &[],
        )
    }

    /// Whether a stage is active: a column on the board.
    pub(crate) fn stage_active(&self, stage: i64) -> bool {
        self.int("SELECT active FROM stage WHERE id = ?1", args![stage])
            .is_ok_and(|a| a != 0)
    }

    /// A lane's code, as a closed process's `archive_reason` says it:
    /// hunt's own (rejected, accepted …), or one from its id.
    pub(crate) fn lane_code(&self, lane: i64) -> Result<String> {
        Ok(self
            .text(
                &format!("SELECT {LANE_CODE} FROM lane l WHERE l.id = ?1"),
                args![lane],
            )?
            .unwrap_or_default())
    }

    /// The inactive stage and lane a reason for closing (a code) is.
    pub(crate) fn closing_lane(&self, code: &str) -> Result<(i64, i64)> {
        let rows = self.query(
            &format!(
                "SELECT l.id, l.stage_id FROM lane l JOIN stage s ON s.id = l.stage_id \
                 WHERE s.active = 0 AND {LANE_CODE} = ?1 ORDER BY s.position, l.position LIMIT 1"
            ),
            args![code],
        )?;
        let row = rows
            .first()
            .ok_or_else(|| invalid(format!("{code:?} isn't a reason for closing")))?;
        Ok((
            row["stage_id"].as_i64().unwrap_or(0),
            row["id"].as_i64().unwrap_or(0),
        ))
    }

    /// A stage's default lane (sub stage): where a process going into it
    /// goes when no lane is said.
    pub(crate) fn default_lane(&self, stage: i64) -> Result<Option<i64>> {
        let id = self.int(
            "SELECT coalesce(min(id), 0) FROM lane WHERE stage_id = ?1 AND is_default = 1",
            args![stage],
        )?;
        Ok((id != 0).then_some(id))
    }

    /// A lane made its stage's default: the stage's others aren't, now.
    fn check_lane_default(
        &self,
        stage: i64,
        id: Option<i64>,
        set: &mut [(&'static str, Value)],
    ) -> Result<()> {
        check_flag(
            set,
            "is_default",
            "Default: 1 for the stage's default, 0 for not",
        )?;
        if set.iter().any(|(k, v)| *k == "is_default" && v == 1) {
            self.exec(
                "UPDATE lane SET is_default = 0 WHERE stage_id = ?1 AND id <> ?2",
                args![stage, id.unwrap_or(0)],
            )?;
        }
        Ok(())
    }

    /// A lane, if any, must be one of the stage's.
    pub(crate) fn check_lane(&self, stage: i64, lane: &Value) -> Result<()> {
        let Some(lane) = lane.as_i64() else {
            return Ok(());
        };
        let of = self.int("SELECT stage_id FROM lane WHERE id = ?1", args![lane])?;
        if of != stage {
            return Err(invalid(format!(
                "lane #{lane} isn't one of this stage's lanes"
            )));
        }
        Ok(())
    }

    /// The position after the last card in a column.
    pub(crate) fn column_end(&self, stage: i64) -> Result<i64> {
        self.int(
            "SELECT coalesce(max(position) + 1, 0) FROM process WHERE stage_id = ?1 AND status = 'active'",
            args![stage],
        )
    }

    fn describe_update(
        &self,
        r: &Resource,
        old: &Record,
        new: &Record,
        changes: &Map<String, Value>,
    ) -> String {
        let show = |f: &Field, v: &Value| -> String {
            match (f.kind, v) {
                (_, Value::Null) => "—".into(),
                (FieldKind::Ref { resource }, v) => self.label_of(resource, v),
                (FieldKind::Choice { .. }, Value::String(code)) => self
                    .text(
                        &format!("SELECT l.name FROM lane l WHERE {LANE_CODE} = ?1"),
                        args![code],
                    )
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| code.clone()),
                (FieldKind::Enum { options }, Value::String(s)) => {
                    option_label(options, s).unwrap_or(s).to_string()
                }
                (_, Value::String(s)) if s.chars().count() > 50 => {
                    format!("{}…", s.chars().take(50).collect::<String>())
                }
                (_, Value::String(s)) => s.clone(),
                (_, v) => v.to_string(),
            }
        };
        let mut parts = Vec::new();
        for (name, pair) in changes {
            let Some(f) = r.field(name) else { continue };
            if f.kind_is_long() {
                parts.push(format!("{} edited", f.label.to_lowercase()));
            } else {
                parts.push(format!(
                    "{}: {} → {}",
                    f.label.to_lowercase(),
                    show(f, &pair[0]),
                    show(f, &pair[1])
                ));
            }
        }
        let verb = if r.entity == "process" && changes.contains_key("status") {
            match new.get("status").and_then(Value::as_str) {
                Some("archived") => "Closed",
                _ => "Reopened",
            }
        } else {
            "Updated"
        };
        let name = if changes.contains_key("name") || changes.contains_key("title") {
            old
        } else {
            new
        };
        format!("{verb} {} {}: {}", r.entity, label(name), parts.join("; "))
    }
}

impl Field {
    fn kind_is_long(&self) -> bool {
        matches!(self.kind, FieldKind::LongText)
    }
}

/// A lane's code, in SQL (the lane as `l`): its own, or `lane-` and its id.
pub(crate) const LANE_CODE: &str = "coalesce(l.value, 'lane-' || l.id)";

/// A yes-or-no field, as 1 or 0 (from a number or a boolean); none, when
/// `unsaid` may be (a sub stage's Folded: as its stage).
fn check_flag(set: &mut [(&'static str, Value)], key: &str, says: &str) -> Result<()> {
    check_flag_or(set, key, says, false)
}
fn check_flag_or(
    set: &mut [(&'static str, Value)],
    key: &str,
    says: &str,
    unsaid: bool,
) -> Result<()> {
    let Some((_, v)) = set.iter_mut().find(|(k, _)| *k == key) else {
        return Ok(());
    };
    let on = match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64() != Some(0),
        Value::Null if unsaid => return Ok(()),
        _ => return Err(invalid(says)),
    };
    *v = Value::from(i64::from(on));
    Ok(())
}

/// A field being set, or null.
fn field_of(set: &[(&str, Value)], n: &str) -> Value {
    set.iter()
        .find(|(k, _)| *k == n)
        .map(|(_, v)| v.clone())
        .unwrap_or(Value::Null)
}

pub fn label(rec: &Record) -> &str {
    rec.get("label").and_then(Value::as_str).unwrap_or("")
}

fn from_sql(v: Sql) -> Value {
    match v {
        Sql::Null | Sql::Blob(_) => Value::Null,
        Sql::Integer(i) => Value::from(i),
        Sql::Real(f) => Value::from(f),
        Sql::Text(t) => Value::String(t),
    }
}

pub(crate) fn to_sql(v: &Value) -> Sql {
    match v {
        Value::Null => Sql::Null,
        Value::Number(n) => n
            .as_i64()
            .map(Sql::Integer)
            .unwrap_or_else(|| Sql::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => Sql::Text(s.clone()),
        v => Sql::Text(v.to_string()),
    }
}

/// Explain a constraint failure in the resource's own words.
fn constraint(r: &Resource, e: Error) -> Error {
    match e {
        Error::Constraint {
            kind: Constraint::Unique,
            column,
            ..
        } => {
            let field = column.unwrap_or_default();
            let label = r.field(&field).map_or(field.as_str(), |f| f.label);
            Error::Conflict(format!(
                "there's already a {} with that {}",
                r.entity,
                label.to_lowercase()
            ))
        }
        Error::Constraint { message, .. } => Error::Invalid(message),
        other => other,
    }
}
