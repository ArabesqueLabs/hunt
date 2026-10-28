//! Each account's rows, and nobody else's: SQL scoped to an owner.
//!
//! With several accounts in one database, every row someone keeps carries
//! its owner (`owner_id`). Rather than each query remembering to say so,
//! the store rewrites the SQL it runs while it acts for an account:
//!
//! - every owned table read (after `FROM` or `JOIN`, in subqueries too)
//!   becomes that owner's rows only: `FROM company c` →
//!   `FROM (SELECT * FROM company WHERE owner_id = 7) c`;
//! - an `INSERT` into an owned table gets the owner, for every row (and an
//!   upsert's conflict target names it too);
//! - an `UPDATE` or `DELETE` of an owned table touches the owner's rows only.
//!
//! What everyone shares (file contents, exchange rates, the accounts, the
//! schema's version) isn't owned, so isn't touched. A statement that has to
//! see every owner's rows (pruning file contents nobody uses any more, a
//! sequence after an import) says so: `/* all owners */`.

use std::sync::LazyLock;

use regex::Regex;

/// The tables whose rows belong to an account.
pub const OWNED: &[&str] = &[
    "swimlane",
    "stage",
    "lane",
    "company",
    "person",
    "application",
    "posting",
    "process",
    "process_person",
    "step",
    "note",
    "step_person",
    "document",
    "version",
    "process_file",
    "tag",
    "tagging",
    "email",
    "setting",
    "memo",
    "cycle",
    "reminder",
    "link",
    "prep_item",
    "story",
    "stash_item",
    "activity",
];

/// A statement marked to see every owner's rows.
pub const ALL_OWNERS: &str = "/* all owners */";

fn owned(table: &str) -> bool {
    OWNED.iter().any(|t| t.eq_ignore_ascii_case(table))
}

/// Words that can follow a table where an alias could: not aliases.
const NOT_ALIAS: &[&str] = &[
    "where",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "cross",
    "full",
    "natural",
    "on",
    "using",
    "order",
    "group",
    "limit",
    "offset",
    "union",
    "except",
    "intersect",
    "having",
    "window",
    "set",
    "values",
    "and",
    "or",
    "returning",
    "when",
    "then",
    "else",
    "end",
];

/// `sql` run for nobody in particular (one person's hunt, or work for
/// everyone): rows are written with the default owner, so an upsert's
/// conflict target still names the owner, as the keys do.
pub fn unscoped(sql: &str) -> std::borrow::Cow<'_, str> {
    static INTO: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^\s*INSERT\s+(?:OR\s+[A-Za-z]+\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)")
            .expect("a good pattern")
    });
    match INTO.captures(sql) {
        Some(c)
            if owned(&c[1])
                && sql.to_ascii_uppercase().contains("ON CONFLICT")
                && !sql.contains("owner_id") =>
        {
            std::borrow::Cow::Owned(scope_conflict(sql))
        }
        _ => std::borrow::Cow::Borrowed(sql),
    }
}

/// `sql`, as `owner` may run it.
pub fn scope(sql: &str, owner: i64) -> String {
    if sql.contains(ALL_OWNERS) {
        return sql.to_string();
    }
    let head = sql.trim_start();
    let lead = &sql[..sql.len() - head.len()];
    let first = head
        .split(|c: char| !c.is_ascii_alphabetic())
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    let out = match first.as_str() {
        "INSERT" => scope_insert(head, owner),
        "UPDATE" => scope_update(head, owner),
        "DELETE" => scope_delete(head, owner),
        _ => scope_reads(head, owner),
    };
    format!("{lead}{out}")
}

/// Every owned table read: the owner's rows only.
fn scope_reads(sql: &str, owner: i64) -> String {
    static TABLE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)\b(FROM|JOIN)(\s+)([A-Za-z_][A-Za-z0-9_]*)\b(\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)\b)?")
            .expect("a good pattern")
    });
    let mut out = String::with_capacity(sql.len() + 64);
    let mut last = 0;
    let mut pos = 0;
    // One at a time: a keyword after a table (JOIN …) is looked at again.
    while let Some(c) = TABLE.captures_at(sql, pos) {
        let whole = c.get(0).expect("a match");
        let table = &c[3];
        // Inside a quoted string, or not an owned table: as it is.
        if !owned(table) || inside_quotes(sql, whole.start()) {
            pos = c.get(3).expect("a table").end();
            continue;
        }
        let alias = c
            .get(5)
            .map(|m| m.as_str())
            .filter(|a| !NOT_ALIAS.iter().any(|k| k.eq_ignore_ascii_case(a)));
        out.push_str(&sql[last..whole.start()]);
        out.push_str(&format!(
            "{}{}(SELECT * FROM {table} WHERE owner_id = {owner}) {}",
            &c[1],
            &c[2],
            alias.unwrap_or(table)
        ));
        // A word after the table that wasn't its alias stays, and is read again.
        last = match (alias, c.get(4)) {
            (None, Some(rest)) => rest.start(),
            _ => whole.end(),
        };
        pos = last;
    }
    out.push_str(&sql[last..]);
    out
}

fn inside_quotes(sql: &str, at: usize) -> bool {
    sql[..at].matches('\'').count() % 2 == 1
}

/// Where a keyword stands at the top level (outside parentheses and
/// quotes), from `from` on.
fn top_level(sql: &str, word: &str, from: usize) -> Option<usize> {
    let bytes = sql.as_bytes();
    let (mut depth, mut quoted) = (0i32, false);
    let mut i = from;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' => quoted = !quoted,
            b'(' if !quoted => depth += 1,
            b')' if !quoted => depth -= 1,
            _ if !quoted && depth == 0 => {
                let rest = &sql[i..];
                let before_ok =
                    i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_');
                if before_ok
                    && rest.len() >= word.len()
                    && rest[..word.len()].eq_ignore_ascii_case(word)
                    && rest[word.len()..]
                        .chars()
                        .next()
                        .is_none_or(|c| !(c.is_ascii_alphanumeric() || c == '_'))
                {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// The parenthesis closing the one opened at `open`.
fn closing(sql: &str, open: usize) -> Option<usize> {
    let bytes = sql.as_bytes();
    let (mut depth, mut quoted) = (0i32, false);
    for (i, b) in bytes.iter().enumerate().skip(open) {
        match b {
            b'\'' => quoted = !quoted,
            b'(' if !quoted => depth += 1,
            b')' if !quoted => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// `INSERT [OR …] INTO t (cols) VALUES (…), (…)` or `… SELECT …`: each
/// row gets the owner.
fn scope_insert(sql: &str, owner: i64) -> String {
    static HEAD: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^INSERT\s+(?:OR\s+[A-Za-z]+\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
            .expect("a good pattern")
    });
    let Some(head) = HEAD.captures(sql) else {
        return scope_reads(sql, owner);
    };
    let table = head[1].to_string();
    if !owned(&table) {
        return scope_reads(sql, owner);
    }
    let open = head.get(0).expect("a match").end() - 1;
    let Some(close) = closing(sql, open) else {
        return sql.to_string();
    };
    let cols = &sql[open + 1..close];
    if cols
        .split(',')
        .any(|c| c.trim().eq_ignore_ascii_case("owner_id"))
    {
        return scope_reads(sql, owner);
    }
    let mut out = format!("{}owner_id, {}", &sql[..=open], &sql[open + 1..=close]);
    let rest = &sql[close + 1..];
    if let Some(v) = top_level(rest, "VALUES", 0) {
        // Each row's parentheses, at the top level.
        out.push_str(&rest[..v + "VALUES".len()]);
        let mut tail = &rest[v + "VALUES".len()..];
        while let Some(p) = tail.find('(') {
            let gap = &tail[..p];
            if !gap.trim().is_empty() && gap.trim() != "," {
                break;
            }
            let Some(end) = closing(tail, p) else { break };
            out.push_str(&format!("{}({owner}, {}", gap, &tail[p + 1..=end]));
            tail = &tail[end + 1..];
        }
        out.push_str(&scope_conflict(tail));
    } else if let Some(s) = top_level(rest, "SELECT", 0) {
        let after = s + "SELECT".len();
        out.push_str(&rest[..after]);
        out.push_str(&format!(" {owner},"));
        out.push_str(&scope_conflict(&scope_reads(&rest[after..], owner)));
    } else {
        out.push_str(rest);
    }
    out
}

/// An upsert's conflict target names the owner too: its keys are per owner.
fn scope_conflict(sql: &str) -> String {
    static TARGET: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\bON\s+CONFLICT\s*\(").expect("a good pattern"));
    TARGET.replace(sql, "${0}owner_id, ").into_owned()
}

/// `UPDATE t SET … [WHERE …]`: the owner's rows only.
fn scope_update(sql: &str, owner: i64) -> String {
    static HEAD: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)\s+SET\b").expect("a good pattern")
    });
    match HEAD.captures(sql) {
        Some(h) if owned(&h[1]) => {
            let body = h.get(0).expect("a match").end();
            restrict(&sql[..body], &scope_reads(&sql[body..], owner), owner)
        }
        _ => scope_reads(sql, owner),
    }
}

/// `DELETE FROM t [WHERE …]`: the owner's rows only.
fn scope_delete(sql: &str, owner: i64) -> String {
    static HEAD: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)\b").expect("a good pattern")
    });
    match HEAD.captures(sql) {
        Some(h) => {
            let body = h.get(0).expect("a match").end();
            let rest = scope_reads(&sql[body..], owner);
            if owned(&h[1]) {
                restrict(&sql[..body], &rest, owner)
            } else {
                format!("{}{rest}", &sql[..body])
            }
        }
        None => scope_reads(sql, owner),
    }
}

/// `head` + `rest`, with the owner added to `rest`'s top-level WHERE (or
/// one made).
fn restrict(head: &str, rest: &str, owner: i64) -> String {
    match top_level(rest, "WHERE", 0) {
        Some(w) => {
            let cond = &rest[w + "WHERE".len()..];
            format!(
                "{head}{} WHERE owner_id = {owner} AND ({})",
                rest[..w].trim_end(),
                cond.trim()
            )
        }
        None => format!("{head}{} WHERE owner_id = {owner}", rest.trim_end()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_see_the_owners_rows() {
        assert_eq!(
            scope(
                "SELECT c.name FROM company c JOIN application a ON a.company_id = c.id WHERE c.id = ?1",
                7
            ),
            "SELECT c.name FROM (SELECT * FROM company WHERE owner_id = 7) c \
             JOIN (SELECT * FROM application WHERE owner_id = 7) a ON a.company_id = c.id WHERE c.id = ?1"
        );
        // No alias, and a JOIN straight after: both tables seen.
        assert_eq!(
            scope(
                "SELECT 1 FROM tagging JOIN tag ON tag.id = tagging.tag_id",
                4
            ),
            "SELECT 1 FROM (SELECT * FROM tagging WHERE owner_id = 4) tagging \
             JOIN (SELECT * FROM tag WHERE owner_id = 4) tag ON tag.id = tagging.tag_id"
        );
        // No alias: named as the table; a keyword after it isn't an alias.
        assert_eq!(
            scope("SELECT count(*) FROM process WHERE status = 'active'", 2),
            "SELECT count(*) FROM (SELECT * FROM process WHERE owner_id = 2) process WHERE status = 'active'"
        );
        assert_eq!(
            scope("SELECT * FROM tag AS g ORDER BY name", 2),
            "SELECT * FROM (SELECT * FROM tag WHERE owner_id = 2) g ORDER BY name"
        );
        // Subqueries too; a table that's a prefix of another isn't confused.
        assert_eq!(
            scope(
                "SELECT (SELECT count(*) FROM process_person pp WHERE pp.process_id = p.id) AS n FROM process p",
                3
            ),
            "SELECT (SELECT count(*) FROM (SELECT * FROM process_person WHERE owner_id = 3) pp WHERE pp.process_id = p.id) AS n \
             FROM (SELECT * FROM process WHERE owner_id = 3) p"
        );
        // Shared tables, words in quotes, and the marked: as they are.
        assert_eq!(
            scope("SELECT data FROM stored_file WHERE sha256 = ?1", 3),
            "SELECT data FROM stored_file WHERE sha256 = ?1"
        );
        assert_eq!(
            scope("SELECT 'from company' AS x", 3),
            "SELECT 'from company' AS x"
        );
        let all = "SELECT max(id) /* all owners */ FROM company";
        assert_eq!(scope(all, 3), all);
    }

    #[test]
    fn writes_are_the_owners() {
        assert_eq!(
            scope("INSERT INTO company (name, created_at) VALUES (?1, ?2)", 5),
            "INSERT INTO company (owner_id, name, created_at) VALUES (5, ?1, ?2)"
        );
        assert_eq!(
            scope(
                "INSERT INTO stage (name, position) VALUES ('A', 0), ('B', 1)",
                5
            ),
            "INSERT INTO stage (owner_id, name, position) VALUES (5, 'A', 0), (5, 'B', 1)"
        );
        assert_eq!(
            scope(
                "INSERT OR IGNORE INTO tagging (tag_id, entity, entity_id) SELECT id, ?2, ?3 FROM tag WHERE lower(name) = lower(?1)",
                5
            ),
            "INSERT OR IGNORE INTO tagging (owner_id, tag_id, entity, entity_id) SELECT 5, id, ?2, ?3 \
             FROM (SELECT * FROM tag WHERE owner_id = 5) tag WHERE lower(name) = lower(?1)"
        );
        assert_eq!(
            scope(
                "INSERT INTO setting (name, value) VALUES (?1, ?2) ON CONFLICT (name) DO UPDATE SET value = ?2",
                5
            ),
            "INSERT INTO setting (owner_id, name, value) VALUES (5, ?1, ?2) ON CONFLICT (owner_id, name) DO UPDATE SET value = ?2"
        );
        assert_eq!(
            scope("UPDATE process SET position = ?1 WHERE id = ?2", 5),
            "UPDATE process SET position = ?1 WHERE owner_id = 5 AND (id = ?2)"
        );
        assert_eq!(
            scope("UPDATE application SET via_id = NULL", 5),
            "UPDATE application SET via_id = NULL WHERE owner_id = 5"
        );
        assert_eq!(
            scope(
                "DELETE FROM tagging WHERE entity = ?1 AND entity_id IN (SELECT id FROM company)",
                5
            ),
            "DELETE FROM tagging WHERE owner_id = 5 AND (entity = ?1 AND entity_id IN \
             (SELECT id FROM (SELECT * FROM company WHERE owner_id = 5) company))"
        );
        assert_eq!(
            scope("DELETE FROM memo", 5),
            "DELETE FROM memo WHERE owner_id = 5"
        );
        // Shared tables: written as they are.
        assert_eq!(
            scope(
                "INSERT OR IGNORE INTO stored_file (sha256, data) VALUES (?1, ?2)",
                5
            ),
            "INSERT OR IGNORE INTO stored_file (sha256, data) VALUES (?1, ?2)"
        );
    }
}
