//! Backups: everything tracked, as one JSON file, and importing one back.
//!
//! A backup holds every table's rows, files included (base64), and the
//! schema version it was made at. It doesn't depend on the database: one
//! made from SQLite imports into PostgreSQL or MySQL, which is also how to
//! move between them. Importing replaces everything, all or nothing.
//!
//! Left out: the Gmail connection (`mail.*` settings), so a backup file
//! never carries a password or a sign-in; and this service's uptime
//! (`system.*`), which belongs to where it runs.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde_json::{Map, Value, json};

use crate::args;
use crate::db::{Db, SCHEMA_VERSION, Sql, to_sql};
use crate::error::{Error, Result, invalid};
use crate::store::Dialect;

/// The backup format's version.
pub const FORMAT: i64 = 1;

/// Every table, each after the ones it refers to.
pub(crate) const TABLES: &[&str] = &[
    "swimlane",
    "stage",
    "lane",
    "stored_file",
    "company",
    "person",
    "application",
    "posting",
    "cycle",
    "process",
    "process_person",
    "step",
    "step_person",
    "note",
    "reminder",
    "link",
    "prep_item",
    "story",
    "document",
    "version",
    "process_file",
    "fx_rate",
    "tag",
    "tagging",
    "email",
    "mail_ignore",
    "setting",
    "memo",
    "activity",
];

/// Tables older backups have that this hunt doesn't: their rows are read,
/// not kept as they are. `archive_reason` (to schema 18): the reasons for
/// closing, lanes of an inactive stage since.
const LEGACY: &[&str] = &["archive_reason"];

/// Columns holding file contents, kept as base64.
const FILE_COLUMNS: &[(&str, &str)] = &[("stored_file", "data")];

/// Tables everyone shares (not an account's rows): an import adds to them,
/// and never empties them.
const SHARED: &[&str] = &["stored_file", "fx_rate"];

/// Each table's references to others' ids: (column, table referred to).
/// An import into a hunt several people share gives rows new ids, and
/// these follow.
const REFS: &[(&str, &[(&str, &str)])] = &[
    ("stage", &[("swimlane_id", "swimlane")]),
    ("lane", &[("stage_id", "stage")]),
    ("person", &[("company_id", "company")]),
    ("application", &[("company_id", "company")]),
    ("posting", &[("application_id", "application")]),
    (
        "process",
        &[
            ("application_id", "application"),
            ("stage_id", "stage"),
            ("lane_id", "lane"),
            ("cycle_id", "cycle"),
            ("reached_stage_id", "stage"),
        ],
    ),
    (
        "process_person",
        &[("process_id", "process"), ("person_id", "person")],
    ),
    ("step", &[("process_id", "process")]),
    (
        "step_person",
        &[("step_id", "step"), ("person_id", "person")],
    ),
    ("note", &[("process_id", "process")]),
    ("reminder", &[("process_id", "process")]),
    ("link", &[("application_id", "application")]),
    (
        "prep_item",
        &[("process_id", "process"), ("step_id", "step")],
    ),
    ("version", &[("document_id", "document")]),
    (
        "process_file",
        &[("process_id", "process"), ("version_id", "version")],
    ),
    ("tagging", &[("tag_id", "tag")]),
    ("email", &[("process_id", "process")]),
    ("activity", &[("process_id", "process")]),
];

/// The table an entity's rows are in, as `tagging` and `activity` name them.
fn table_of(entity: &str) -> Option<&'static str> {
    Some(match entity {
        "swimlane" => "swimlane",
        "stage" => "stage",
        "lane" => "lane",
        "company" => "company",
        "person" => "person",
        "application" => "application",
        "posting" => "posting",
        "process" => "process",
        "step" => "step",
        "note" => "note",
        "document" => "document",
        "version" => "version",
        "tag" => "tag",
        "memo" => "memo",
        "cycle" => "cycle",
        "reminder" => "reminder",
        "link" => "link",
        "prep" => "prep_item",
        "story" => "story",
        "email" => "email",
        _ => return None,
    })
}

/// Settings that belong to this machine (its Gmail connection, its
/// uptime): not backed up, and kept as they are when a backup is imported.
fn is_private_setting(name: &str) -> bool {
    // And the calendar's private link: a copy of hunt elsewhere shouldn't share it.
    name.starts_with("mail.")
        || name.starts_with("system.")
        || name == crate::service::CALENDAR_TOKEN
}

impl Db {
    /// Everything tracked, as a backup.
    pub fn backup(&self) -> Result<Value> {
        let mut tables = Map::new();
        let mut counts = Map::new();
        for table in TABLES {
            let order = if self.columns(table)?.iter().any(|c| c == "id") {
                " ORDER BY id"
            } else {
                ""
            };
            let mut rows = Vec::new();
            // File contents: those this hunt's documents, logos and photos use.
            let sql = if *table == "stored_file" {
                "SELECT * FROM stored_file WHERE sha256 IN (SELECT sha256 FROM version \
                 UNION SELECT logo FROM company WHERE logo IS NOT NULL \
                 UNION SELECT photo FROM person WHERE photo IS NOT NULL)"
                    .to_string()
            } else {
                format!("SELECT * FROM {table}{order}")
            };
            for row in self.rows(&sql, &[])? {
                let mut rec = Map::new();
                for (name, v) in row {
                    // Whose rows they are is this hunt's business, not the backup's.
                    if name != "owner_id" {
                        rec.insert(name, to_json(v));
                    }
                }
                if *table == "setting"
                    && rec
                        .get("name")
                        .and_then(Value::as_str)
                        .is_some_and(is_private_setting)
                {
                    continue;
                }
                rows.push(Value::Object(rec));
            }
            counts.insert(table.to_string(), json!(rows.len()));
            tables.insert(table.to_string(), Value::Array(rows));
        }
        Ok(json!({
            "hunt_backup": FORMAT,
            "schema_version": SCHEMA_VERSION,
            "made_at": self.stamp(),
            "made_by": format!("hunt {}", env!("CARGO_PKG_VERSION")),
            "counts": counts,
            "tables": tables,
        }))
    }

    /// Replace everything with a backup's contents. How many rows each
    /// table now has.
    pub fn restore(&self, backup: &Value) -> Result<Value> {
        if backup["hunt_backup"].as_i64() != Some(FORMAT) {
            return Err(invalid(
                "that isn't a hunt backup (or it's from a newer hunt)",
            ));
        }
        // Backups from schema 8 on fit: later versions only add columns.
        let version = backup["schema_version"].as_i64().unwrap_or(0);
        if !(8..=SCHEMA_VERSION).contains(&version) {
            return Err(invalid(format!(
                "that backup is of schema version {version}; this hunt imports version {SCHEMA_VERSION}. \
                 Import it with the hunt that made it, then back up again"
            )));
        }
        let tables = backup["tables"]
            .as_object()
            .ok_or_else(|| invalid("that backup has no tables in it"))?;
        if let Some(t) = tables
            .keys()
            .find(|t| !TABLES.contains(&t.as_str()) && !LEGACY.contains(&t.as_str()))
        {
            return Err(invalid(format!(
                "that backup has a table hunt doesn't know: {t}"
            )));
        }
        // Every column named must be one the table has.
        let mut known = std::collections::HashMap::new();
        for table in TABLES {
            known.insert(*table, self.columns(table)?);
        }
        for (table, rows) in tables.iter().filter(|(t, _)| !LEGACY.contains(&t.as_str())) {
            let cols = &known[table.as_str()];
            for row in rows
                .as_array()
                .ok_or_else(|| invalid(format!("{table}: not a list of rows")))?
            {
                let row = row
                    .as_object()
                    .ok_or_else(|| invalid(format!("{table}: a row isn't an object")))?;
                if let Some(c) = row.keys().find(|c| !cols.contains(c) || *c == "owner_id") {
                    return Err(invalid(format!("{table}: no column {c}")));
                }
            }
        }

        let mut counts = Map::new();
        // In a hunt several people share, rows get new ids (the backup's may
        // be someone else's), and references follow.
        let remap = self.owner().is_some();
        let mut new_ids: std::collections::HashMap<&str, std::collections::HashMap<i64, i64>> =
            std::collections::HashMap::new();
        self.atomic(|db| {
            // Out with the old: what refers to others first.
            db.exec("UPDATE application SET via_id = NULL", &[])?;
            for table in TABLES.iter().rev() {
                if remap && SHARED.contains(table) {
                    continue;
                }
                if *table == "setting" {
                    let keep: Vec<String> = db
                        .query("SELECT name FROM setting", &[])?
                        .into_iter()
                        .filter_map(|r| r["name"].as_str().map(String::from))
                        .filter(|n| !is_private_setting(n))
                        .collect();
                    for name in keep {
                        db.exec("DELETE FROM setting WHERE name = ?1", args![name])?;
                    }
                    continue;
                }
                db.exec(&format!("DELETE FROM {table}"), &[])?;
            }
            // In with the new, ids and all. An application's "via" may point
            // at a later one, so it's set once they're all in.
            let mut via = Vec::new();
            for table in TABLES {
                let rows = tables
                    .get(*table)
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let mut n = 0;
                for row in rows {
                    let mut row = row.as_object().cloned().unwrap_or_default();
                    if *table == "setting"
                        && row
                            .get("name")
                            .and_then(Value::as_str)
                            .is_some_and(is_private_setting)
                    {
                        continue;
                    }
                    if *table == "application"
                        && let Some(v) = row
                            .insert("via_id".into(), Value::Null)
                            .filter(|v| !v.is_null())
                    {
                        via.push((row["id"].clone(), v));
                    }
                    let old_id = row.get("id").and_then(Value::as_i64);
                    if remap {
                        if old_id.is_some() {
                            row.remove("id");
                        }
                        let follow = |row: &mut Map<String, Value>, col: &str, to: &str| {
                            if let Some(old) = row.get(col).and_then(Value::as_i64) {
                                let new = new_ids.get(to).and_then(|m| m.get(&old)).copied();
                                row.insert(col.into(), new.map_or(Value::Null, Value::from));
                            }
                        };
                        for (t, refs) in REFS {
                            if t == table {
                                for (col, to) in *refs {
                                    follow(&mut row, col, to);
                                }
                            }
                        }
                        // Tags and the log name their record by entity and id.
                        if matches!(*table, "tagging" | "activity")
                            && let Some(to) =
                                row.get("entity").and_then(Value::as_str).and_then(table_of)
                        {
                            let keep = *table == "activity";
                            let old = row.get("entity_id").and_then(Value::as_i64);
                            let new =
                                old.and_then(|o| new_ids.get(to).and_then(|m| m.get(&o)).copied());
                            // The log keeps a record of what's gone; a tag of nothing goes.
                            match (new, keep) {
                                (Some(n), _) => {
                                    row.insert("entity_id".into(), Value::from(n));
                                }
                                (None, true) => {}
                                (None, false) => continue,
                            }
                        }
                    }
                    let cols: Vec<&String> = row.keys().collect();
                    let mut values = Vec::with_capacity(cols.len());
                    for c in &cols {
                        let v = &row[c.as_str()];
                        values.push(if FILE_COLUMNS.contains(&(table, c.as_str())) {
                            let text = v.as_str().unwrap_or("");
                            Sql::Blob(
                                B64.decode(text)
                                    .map_err(|_| invalid(format!("{table}.{c}: not base64")))?,
                            )
                        } else {
                            to_sql(v)
                        });
                    }
                    // Shared tables keep what they have.
                    let verb = if remap && SHARED.contains(table) {
                        "INSERT OR IGNORE"
                    } else {
                        "INSERT"
                    };
                    let sql = format!(
                        "{verb} INTO {table} ({}) VALUES ({})",
                        cols.iter()
                            .map(|c| c.as_str())
                            .collect::<Vec<_>>()
                            .join(", "),
                        (1..=cols.len())
                            .map(|i| format!("?{i}"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    );
                    let fits = |e| match e {
                        Error::Constraint { message, .. } => invalid(format!(
                            "that backup doesn't fit together ({table}: {message})"
                        )),
                        e => e,
                    };
                    // Rows with an id: their new one noted, for what refers to them.
                    if remap && let Some(old) = old_id {
                        let new = db.insert(&sql, &values).map_err(fits)?;
                        new_ids.entry(table).or_default().insert(old, new);
                    } else {
                        db.exec(&sql, &values).map_err(fits)?;
                    }
                    n += 1;
                }
                counts.insert(table.to_string(), json!(n));
            }
            for (id, v) in via {
                let (id, v) = if remap {
                    let apps = new_ids.get("application");
                    let new = |x: &Value| {
                        x.as_i64()
                            .and_then(|o| apps.and_then(|m| m.get(&o)).copied())
                    };
                    match (new(&id), new(&v)) {
                        (Some(a), Some(b)) => (Value::from(a), Value::from(b)),
                        _ => continue,
                    }
                } else {
                    (id, v)
                };
                db.exec(
                    "UPDATE application SET via_id = ?1 WHERE id = ?2",
                    args![v, id],
                )?;
            }
            db.renumber()?;
            // A backup from before closing was a stage: its reasons become
            // an inactive stage's lanes, and its closed processes go there.
            if version < 19 {
                let reasons = tables
                    .get("archive_reason")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                db.settle_closing(&reasons)?;
            }
            // From before swimlanes: the terminal stages folded, and the
            // board's swimlanes, as the migration to 20 does.
            if version < 20 {
                db.exec("UPDATE stage SET folded = 1 WHERE active = 0", &[])?;
                db.seed_swimlanes()?;
            }
            // A backup from before cycles: what it had becomes one.
            db.settle_import()
        })?;
        Ok(Value::Object(counts))
    }

    /// A table's columns.
    fn columns(&self, table: &str) -> Result<Vec<String>> {
        let rows = match self.dialect() {
            Dialect::Sqlite => self.query(
                &format!("SELECT name FROM pragma_table_info('{table}')"),
                &[],
            )?,
            Dialect::Postgres => self.query(
                "SELECT column_name AS name FROM information_schema.columns \
                 WHERE table_schema = current_schema() AND table_name = ?1",
                args![table],
            )?,
            Dialect::Mysql => self.query(
                "SELECT column_name AS name FROM information_schema.columns \
                 WHERE table_schema = DATABASE() AND table_name = ?1",
                args![table],
            )?,
        };
        Ok(rows
            .into_iter()
            .filter_map(|r| r.get("name").and_then(Value::as_str).map(String::from))
            .collect())
    }

    /// After rows came in with their ids, new rows' ids carry on from the
    /// highest (SQLite and MySQL do this themselves).
    /// What a backup from before schema 19 had, as this hunt keeps it: its
    /// reasons for closing (`archive_reason` rows: value, name, position) the
    /// lanes of new inactive stages (a new hunt's, each reason with the one
    /// it belongs with); its closed processes there, in their reason's lane;
    /// and each process's stage reached, as the migration to 19 does.
    fn settle_closing(&self, reasons: &[Value]) -> Result<()> {
        use crate::resource::{ARCHIVE_REASONS, CLOSED_STAGES};
        let at = self.stamp();
        let mut stages = Vec::new();
        for name in CLOSED_STAGES {
            let taken = self.int(
                "SELECT count(*) FROM stage WHERE lower(name) = lower(?1)",
                args![name],
            )? > 0;
            let name = if taken {
                format!("{name} (closed)")
            } else {
                name.to_string()
            };
            // After the board's stages (MySQL won't read the table it inserts into).
            let after = self.int("SELECT coalesce(max(position) + 1, 0) FROM stage", &[])?;
            stages.push(self.insert(
                "INSERT INTO stage (name, position, active, folded, created_at, updated_at) VALUES (?1, ?2, 0, 1, ?3, ?3)",
                args![name, after, at],
            )?);
        }
        let mut rows: Vec<(String, String, i64)> = reasons
            .iter()
            .filter_map(|r| {
                Some((
                    r.get("value")?.as_str()?.to_string(),
                    r.get("name")?.as_str()?.to_string(),
                    r.get("position").and_then(Value::as_i64).unwrap_or(0),
                ))
            })
            .collect();
        if rows.is_empty() {
            rows = ARCHIVE_REASONS
                .iter()
                .enumerate()
                .map(|(i, (v, l, _))| (v.to_string(), l.to_string(), i as i64))
                .collect();
        } else if !rows.iter().any(|r| r.0 == "paused") {
            rows.push(("paused".into(), "On hold".into(), -1));
        }
        // Each with the stage its code belongs with; the account's own with the last.
        let last = stages.len() - 1;
        for (value, name, position) in rows {
            let of = ARCHIVE_REASONS
                .iter()
                .find(|r| r.0 == value)
                .map_or(last, |r| r.2);
            self.exec(
                "INSERT INTO lane (stage_id, name, value, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                args![stages[of], name, value, position, at],
            )?;
        }
        self.exec("UPDATE process SET reached_stage_id = stage_id", &[])?;
        self.exec(
            "UPDATE process SET lane_id = (SELECT l.id FROM lane l JOIN stage s ON s.id = l.stage_id \
             WHERE s.active = 0 AND l.value = process.archive_reason) WHERE status = 'archived'",
            &[],
        )?;
        self.exec(
            "UPDATE process SET stage_id = coalesce((SELECT l.stage_id FROM lane l WHERE l.id = process.lane_id), ?1) \
             WHERE status = 'archived'",
            args![stages[last]],
        )?;
        Ok(())
    }

    fn renumber(&self) -> Result<()> {
        if self.dialect() != Dialect::Postgres {
            return Ok(());
        }
        for table in TABLES {
            if self.columns(table)?.iter().any(|c| c == "id") {
                self.exec(
                    &format!(
                        // Past every owner's ids: they share the sequence.
                        "SELECT setval(pg_get_serial_sequence('{table}', 'id'), \
                         coalesce((SELECT max(id) /* all owners */ FROM {table}), 0) + 1, false)"
                    ),
                    &[],
                )?;
            }
        }
        Ok(())
    }
}

fn to_json(v: Sql) -> Value {
    match v {
        Sql::Null => Value::Null,
        Sql::Integer(i) => Value::from(i),
        Sql::Real(f) => Value::from(f),
        Sql::Text(t) => Value::String(t),
        Sql::Blob(b) => Value::String(B64.encode(b)),
    }
}
