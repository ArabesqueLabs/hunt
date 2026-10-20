//! Operations beyond plain create/read/update/delete: the board, moving
//! cards, adding a process with its application and company in one go, the
//! people on a process, and managing stages.

use crate::args;
use crate::db::Sql;
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::db::{Db, Record, label};
use crate::error::{Error, Result, invalid};
use crate::resource::{self, resource};

/// Keys that name an application's company instead of giving its id.
const COMPANY_KEYS: &[&str] = &[
    "company",
    "company_website",
    "company_linkedin",
    "company_logo",
];

pub(crate) fn res(name: &str) -> &'static resource::Resource {
    resource(name).expect("known resource")
}

/// The fields a board card shows.
const CARD_SQL: &str = "
    SELECT p.id, p.application_id, p.stage_id, p.lane_id, p.position, p.status, p.archive_reason, p.archive_note,
           (SELECT l.name FROM lane l WHERE l.id = p.lane_id) AS lane,
           (SELECT l.name FROM lane l WHERE l.id = p.lane_id AND p.status = 'archived') AS archive_label,
           p.reached_stage_id, (SELECT rs.name FROM stage rs WHERE rs.id = p.reached_stage_id) AS reached_stage,
           (SELECT group_concat(g.name, '|') FROM tagging x JOIN tag g ON g.id = x.tag_id
             WHERE x.entity = 'application' AND x.entity_id = a.id) AS tags,
           p.applied_on, p.created_at, p.updated_at, p.cycle_id,
           (SELECT cy.name FROM cycle cy WHERE cy.id = p.cycle_id) AS cycle,
           (SELECT r.title FROM reminder r WHERE r.process_id = p.id AND r.done_at IS NULL
             ORDER BY coalesce(r.due_at, '9'), r.id LIMIT 1) AS reminder,
           (SELECT r.due_at FROM reminder r WHERE r.process_id = p.id AND r.done_at IS NULL
             ORDER BY coalesce(r.due_at, '9'), r.id LIMIT 1) AS reminder_at,
           a.title, a.source, a.location, a.work_mode, a.url, a.employment, a.closes_on,
           a.salary_min, a.salary_max, a.currency, a.pay_period, a.salary_min_gbp, a.salary_max_gbp,
           c.id AS company_id, c.name AS company, c.logo AS company_logo, s.name AS stage,
           (SELECT count(*) FROM process_person pp WHERE pp.process_id = p.id) AS people,
           (SELECT count(*) FROM process_file pf WHERE pf.process_id = p.id) AS files,
           (SELECT count(*) FROM email e WHERE e.process_id = p.id AND e.status = 'linked') AS emails,
           (SELECT st.title FROM step st WHERE st.process_id = p.id AND st.status = 'scheduled'
             ORDER BY coalesce(st.at, '9') LIMIT 1) AS next_step,
           (SELECT st.at FROM step st WHERE st.process_id = p.id AND st.status = 'scheduled'
             ORDER BY coalesce(st.at, '9') LIMIT 1) AS next_step_at
    FROM process p
    JOIN application a ON a.id = p.application_id
    JOIN company c ON c.id = a.company_id
    JOIN stage s ON s.id = p.stage_id";

#[derive(Debug, Default, Deserialize)]
pub struct Move {
    pub stage_id: i64,
    /// Which of the stage's lanes; none, the column's undivided top.
    #[serde(default)]
    pub lane_id: Option<i64>,
    /// Where in the column (in the lane, given one), from the top; the
    /// end if left out.
    pub index: Option<usize>,
    /// No lane said, into another stage: true, its top; false (or left
    /// out), its default lane, if it has one.
    #[serde(default)]
    pub top: bool,
}

impl Db {
    /// Everything the board shows: each active stage with its cards, and
    /// the closed ones (in the inactive stages, `closed_stages`, with their
    /// lanes), newest first. `archived_since` (a date) leaves
    /// out those archived before it; `archived_total` counts them all.
    /// `cycle` is the id of the cycle to show, ended or running; without
    /// one, every running cycle's.
    pub fn board(&self, archived_since: Option<&str>, cycle: Option<i64>) -> Result<Value> {
        let stages = self.list(res("stages"), None, &[], None)?;
        let lanes = self.list(res("lanes"), None, &[], None)?;
        let (which, cycle) = match cycle {
            Some(id) => (
                format!("p.cycle_id = {id}"),
                Value::Object(self.get(res("cycles"), id)?),
            ),
            None => (
                "p.cycle_id IN (SELECT id FROM cycle WHERE ended_on IS NULL)".to_string(),
                Value::Null,
            ),
        };
        let active = self.query(
            &format!(
                "{CARD_SQL} WHERE p.status = 'active' AND {which} ORDER BY s.position, p.position, p.id"
            ),
            &[],
        )?;
        let since = archived_since
            .map(crate::time::check_date)
            .transpose()?
            .unwrap_or_default();
        let archived = self.query(
            &format!(
                "{CARD_SQL} WHERE p.status = 'archived' AND p.updated_at >= ?1 AND {which} \
                 ORDER BY p.updated_at DESC, p.id DESC"
            ),
            &[Sql::Text(since)],
        )?;
        let archived_total = self.int(
            &format!("SELECT count(*) FROM process p WHERE p.status = 'archived' AND {which}"),
            &[],
        )?;
        // Who's on each card, for filtering by person.
        let mut on: std::collections::HashMap<i64, Vec<Value>> = std::collections::HashMap::new();
        for r in self.query(
            "SELECT pp.process_id, pe.id, pe.name FROM process_person pp JOIN person pe ON pe.id = pp.person_id \
             ORDER BY lower(pe.name)",
            &[],
        )? {
            if let Some(pid) = r["process_id"].as_i64() {
                on.entry(pid).or_default().push(json!({ "id": r["id"], "name": r["name"] }));
            }
        }
        let with_people = |mut cards: Vec<Record>| -> Vec<Record> {
            for c in &mut cards {
                let id = c["id"].as_i64().unwrap_or(0);
                c.insert(
                    "people_list".into(),
                    Value::Array(on.get(&id).cloned().unwrap_or_default()),
                );
            }
            cards
        };
        let active = with_people(active);
        let archived = with_people(archived);
        let (stages, inactive): (Vec<Record>, Vec<Record>) = stages
            .into_iter()
            .partition(|s| s["active"].as_i64() != Some(0));
        let closed_stages: Vec<Value> = inactive
            .into_iter()
            .map(|mut st| {
                let mine: Vec<Value> = lanes
                    .iter()
                    .filter(|l| l["stage_id"] == st["id"])
                    .cloned()
                    .map(Value::Object)
                    .collect();
                st.insert("lanes".into(), Value::Array(mine));
                Value::Object(st)
            })
            .collect();
        let columns: Vec<Value> = stages
            .into_iter()
            .map(|mut col| {
                let cards: Vec<Value> = active
                    .iter()
                    .filter(|c| c["stage_id"] == col["id"])
                    .cloned()
                    .map(Value::Object)
                    .collect();
                col.insert("cards".into(), Value::Array(cards));
                let mine: Vec<Value> = lanes
                    .iter()
                    .filter(|l| l["stage_id"] == col["id"])
                    .cloned()
                    .map(Value::Object)
                    .collect();
                col.insert("lanes".into(), Value::Array(mine));
                Value::Object(col)
            })
            .collect();
        let read_only = cycle.get("ended_on").is_some_and(|e| !e.is_null());
        let swimlanes = self.list(res("swimlanes"), None, &[], None)?;
        Ok(json!({
            "swimlanes": swimlanes,
            "stages": columns,
            "closed_stages": closed_stages,
            "archived": archived,
            "archived_total": archived_total,
            "cycle": cycle,
            "read_only": read_only,
        }))
    }

    pub fn card(&self, id: i64) -> Result<Record> {
        self.query(&format!("{CARD_SQL} WHERE p.id = ?1"), &[Sql::Integer(id)])?
            .pop()
            .ok_or_else(|| Error::NotFound(format!("no process #{id}")))
    }

    /// Put a card in a column at a position. A closed process moved onto
    /// the board opens again; one moved to an inactive stage closes, its
    /// lane being why.
    pub fn move_process(&self, id: i64, m: &Move) -> Result<Record> {
        self.atomic(|db| {
            let old = db.get(res("processes"), id)?;
            db.check_process_open(&old)?;
            let stage = db.get(res("stages"), m.stage_id)?;
            // No lane said, into another stage: its default one, unless to its top.
            let lane_id = match m.lane_id {
                None if !m.top && old["stage_id"].as_i64() != Some(m.stage_id) => {
                    db.default_lane(m.stage_id)?
                }
                l => l,
            };
            let lane = lane_id.map_or(Value::Null, Value::from);
            db.check_lane(m.stage_id, &lane)?;
            let others = db.query(
                "SELECT id, lane_id FROM process WHERE stage_id = ?1 \
                 AND id <> ?2 ORDER BY position, id",
                &[Sql::Integer(m.stage_id), Sql::Integer(id)],
            )?;
            let mut column: Vec<i64> = others.iter().filter_map(|r| r["id"].as_i64()).collect();
            // The index counts within the lane: before that lane's card, or
            // after its last (or at the end, for an empty lane).
            let in_lane: Vec<usize> = others
                .iter()
                .enumerate()
                .filter(|(_, r)| r["lane_id"].as_i64() == lane_id)
                .map(|(i, _)| i)
                .collect();
            let at = match m.index {
                Some(n) if n < in_lane.len() => in_lane[n],
                _ => in_lane.last().map_or(column.len(), |i| i + 1),
            };
            column.insert(at, id);
            for (i, pid) in column.iter().enumerate() {
                db.exec(
                    "UPDATE process SET position = ?1 WHERE id = ?2",
                    args![i as i64, pid],
                )?;
            }
            let from_stage = old["stage_id"].as_i64() != Some(m.stage_id);
            let from_lane = old["lane_id"].as_i64() != lane_id;
            if !from_stage && !from_lane {
                return db.card(id);
            }
            // Where it's going says whether it's open, and why it's closed.
            let mut set: Vec<(&'static str, Value)> = vec![("lane_id", lane.clone())];
            if from_stage {
                set.push(("stage_id", Value::from(m.stage_id)));
            }
            db.settle_process(Some(&old), &mut set)?;
            let stamp = db.stamp();
            let mut values: Vec<Sql> = set.iter().map(|(_, v)| crate::db::to_sql(v)).collect();
            values.push(Sql::Text(stamp.clone()));
            values.push(Sql::Integer(id));
            let n = set.len();
            db.exec(
                &format!(
                    "UPDATE process SET {}updated_at = ?{} WHERE id = ?{}",
                    set.iter()
                        .enumerate()
                        .map(|(i, (c, _))| format!("{c} = ?{}, ", i + 1))
                        .collect::<String>(),
                    n + 1,
                    n + 2
                ),
                &values,
            )?;
            let rec = db.get(res("processes"), id)?;
            let to = lane_id.map_or_else(
                || label(&stage).to_string(),
                |l| {
                    format!(
                        "{} ({})",
                        db.label_of("lanes", &Value::from(l)),
                        label(&stage)
                    )
                },
            );
            let opened = old["status"] != "active" && rec["status"] == "active";
            let closed = old["status"] == "active" && rec["status"] != "active";
            let summary = if closed {
                format!("Closed {}: {}", label(&rec), to)
            } else if opened {
                format!("Reopened {} in {}", label(&rec), to)
            } else if from_stage {
                format!(
                    "Moved {} from {} to {}",
                    label(&rec),
                    db.label_of("stages", &old["stage_id"]),
                    to
                )
            } else {
                format!("Moved {} to {}", label(&rec), to)
            };
            let changes: Map<String, Value> = set
                .iter()
                .map(|(k, v)| {
                    (
                        k.to_string(),
                        json!([old.get(*k).cloned().unwrap_or(Value::Null), v]),
                    )
                })
                .collect();
            db.log(
                &stamp,
                res("processes"),
                &rec,
                "moved",
                &summary,
                Some(Value::Object(changes)),
            )?;
            db.card(id)
        })
    }

    /// Add a process. Give `application_id` for an existing application,
    /// or the application's fields, with its company as in
    /// [`Db::add_application`].
    pub fn add_process(&self, input: &Record) -> Result<Record> {
        self.atomic(|db| {
            let applications = res("applications");
            let mut process = Record::new();
            let mut app = Record::new();
            for (k, v) in input {
                let for_app = COMPANY_KEYS.contains(&k.as_str())
                    || (k != "note"
                        && applications.field(k).is_some()
                        && res("processes").field(k).is_none());
                if for_app {
                    app.insert(k.clone(), v.clone());
                } else {
                    process.insert(k.clone(), v.clone());
                }
            }
            if process.get("application_id").is_none_or(Value::is_null) {
                let created = db.add_application(&app)?;
                process.insert("application_id".into(), created["id"].clone());
            } else if !app.is_empty() {
                return Err(invalid(
                    "give either application_id or the application's details, not both",
                ));
            }
            let rec = db.create(res("processes"), &process)?;
            db.card(rec["id"].as_i64().unwrap_or(0))
        })
    }

    /// Add an application. Its company is `company_id`, or `company`: a
    /// name, of an existing company (case aside) or a new one. With a name,
    /// `company_website` and `company_linkedin` fill in what the company
    /// doesn't have yet, as when importing a posting.
    pub fn add_application(&self, input: &Record) -> Result<Record> {
        self.atomic(|db| {
            let mut app = input.clone();
            let text = |k: &str| {
                app.get(k)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(String::from)
            };
            let name = text("company");
            let website = text("company_website");
            let linkedin = text("company_linkedin");
            for k in COMPANY_KEYS {
                app.remove(*k);
            }
            if app.get("company_id").is_none_or(Value::is_null) {
                let name =
                    name.ok_or_else(|| invalid("which company? give company or company_id"))?;
                let id = db.company_by_name(&name)?;
                let company = db.get(res("companies"), id)?;
                let mut gaps = Record::new();
                for (field, value) in [("website", website), ("linkedin", linkedin)] {
                    if let Some(v) = value
                        && company[field].is_null()
                    {
                        gaps.insert(field.into(), Value::from(v));
                    }
                }
                if !gaps.is_empty() {
                    db.update(res("companies"), id, &gaps)?;
                }
                app.insert("company_id".into(), Value::from(id));
            }
            db.create(res("applications"), &app)
        })
    }

    /// Applications with this posting link (as their own, or one of their
    /// other postings), however it was copied, each with its processes: for
    /// warning about a posting already tracked.
    pub fn same_posting(&self, url: &str) -> Result<Vec<Record>> {
        let want = crate::posting::canonical(url);
        if url.trim().is_empty() {
            return Ok(vec![]);
        }
        let apps = self.query(
            &format!(
                "SELECT t.id, t.url, {} AS label FROM application t {} ORDER BY t.created_at",
                res("applications").label_sql,
                res("applications").joins
            ),
            &[],
        )?;
        let others = self.query("SELECT application_id, url FROM posting", &[])?;
        let mut out = Vec::new();
        for mut a in apps {
            let id = a["id"].as_i64();
            let found = a["url"].as_str().map(crate::posting::canonical) == Some(want.clone())
                || others.iter().any(|p| {
                    p["application_id"].as_i64() == id
                        && p["url"].as_str().map(crate::posting::canonical) == Some(want.clone())
                });
            if !found {
                continue;
            }
            let processes = self.query(
                // The stage a closed one reached.
                "SELECT p.id, p.status, p.archive_reason, s.name AS stage, p.created_at FROM process p \
                 JOIN stage s ON s.id = coalesce(p.reached_stage_id, p.stage_id) WHERE p.application_id = ?1 ORDER BY p.created_at",
                &[a["id"].as_i64().map_or(Sql::Null, Sql::Integer)],
            )?;
            a.insert(
                "processes".into(),
                Value::Array(processes.into_iter().map(Value::Object).collect()),
            );
            out.push(a);
        }
        Ok(out)
    }

    /// The id of the company with this name, created if there's none.
    pub fn company_by_name(&self, name: &str) -> Result<i64> {
        let found = self.query(
            "SELECT id FROM company WHERE lower(name) = lower(?1)",
            &[Sql::Text(name.to_string())],
        )?;
        if let Some(id) = found.first().and_then(|r| r["id"].as_i64()) {
            return Ok(id);
        }
        let mut rec = Record::new();
        rec.insert("name".into(), Value::from(name));
        Ok(self.create(res("companies"), &rec)?["id"]
            .as_i64()
            .unwrap_or(0))
    }

    /// A process with everything around it, for its page.
    pub fn process_detail(&self, id: i64) -> Result<Value> {
        let process = self.get(res("processes"), id)?;
        let app = self.get(
            res("applications"),
            process["application_id"].as_i64().unwrap_or(0),
        )?;
        let company = self.get(res("companies"), app["company_id"].as_i64().unwrap_or(0))?;
        let by_process = [("process_id".to_string(), id.to_string())];
        let others = self.query(
            &format!("{CARD_SQL} WHERE p.application_id = ?1 AND p.id <> ?2 ORDER BY p.created_at"),
            &[
                app["id"].as_i64().map_or(Sql::Null, Sql::Integer),
                Sql::Integer(id),
            ],
        )?;
        Ok(json!({
            "process": process,
            "card": self.card(id)?,
            "application": app,
            "company": company,
            "people": self.process_people(id)?,
            "files": self.process_files(id)?,
            "steps": self.list(res("steps"), None, &by_process, None)?,
            "notes": self.list(res("notes"), None, &by_process, None)?,
            "emails": self.emails(Some("linked"), Some(id))?,
            "activity": self.process_activity(id)?,
            "others": others,
        }))
    }

    /// Changes to a process, and to its steps, notes, application and company.
    pub fn process_activity(&self, id: i64) -> Result<Vec<Record>> {
        let p = self.get(res("processes"), id)?;
        let app = self.get(
            res("applications"),
            p["application_id"].as_i64().unwrap_or(0),
        )?;
        self.query(
            "SELECT * FROM activity WHERE process_id = ?1 \
               OR (entity = 'application' AND entity_id = ?2) \
               OR (entity = 'company' AND entity_id = ?3) \
             ORDER BY at DESC, id DESC",
            &[
                Sql::Integer(id),
                app["id"].as_i64().map_or(Sql::Null, Sql::Integer),
                app["company_id"].as_i64().map_or(Sql::Null, Sql::Integer),
            ],
        )
        .map(|rows| rows.into_iter().map(parse_changes).collect())
    }

    /// The change log, newest first, optionally for one record.
    pub fn activity(
        &self,
        entity: Option<&str>,
        entity_id: Option<i64>,
        limit: usize,
    ) -> Result<Vec<Record>> {
        let mut sql = "SELECT * FROM activity WHERE 1 = 1".to_string();
        let mut p = Vec::new();
        if let Some(e) = entity {
            let e = resource(e).map_or(e, |r| r.entity);
            sql += " AND entity = ?";
            p.push(Sql::Text(e.into()));
        }
        if let Some(id) = entity_id {
            sql += " AND entity_id = ?";
            p.push(Sql::Integer(id));
        }
        sql += &format!(" ORDER BY at DESC, id DESC LIMIT {limit}");
        Ok(self
            .query(&sql, &p)?
            .into_iter()
            .map(parse_changes)
            .collect())
    }

    // --- people on a process ----------------------------------------------------

    pub fn process_people(&self, id: i64) -> Result<Vec<Record>> {
        self.query(
            "SELECT p.*, pp.role, c.name AS company FROM process_person pp \
             JOIN person p ON p.id = pp.person_id LEFT JOIN company c ON c.id = p.company_id \
             WHERE pp.process_id = ?1 ORDER BY lower(p.name)",
            &[Sql::Integer(id)],
        )
    }

    /// Put someone on a process: `person_id`, or `name` (an existing person,
    /// or a new one at the process's company), and optionally a `role`.
    pub fn add_person(&self, process_id: i64, input: &Record) -> Result<Vec<Record>> {
        self.atomic(|db| {
            let process = db.get(res("processes"), process_id)?;
            let role = db.check_role(input.get("role"))?;
            let person_id = match input
                .get("person_id")
                .and_then(|v| v.as_i64().or_else(|| v.as_str()?.parse().ok()))
            {
                Some(id) => db.get(res("people"), id)?["id"].as_i64().unwrap_or(id),
                None => {
                    let name = input
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .ok_or_else(|| invalid("who? give person_id or name"))?;
                    let found = db.query(
                        "SELECT id FROM person WHERE lower(name) = lower(?1) ORDER BY id LIMIT 1",
                        &[Sql::Text(name.into())],
                    )?;
                    match found.first().and_then(|r| r["id"].as_i64()) {
                        Some(id) => id,
                        None => {
                            let card = db.card(process_id)?;
                            let mut rec = Record::new();
                            rec.insert("name".into(), Value::from(name));
                            rec.insert("company_id".into(), card["company_id"].clone());
                            db.create(res("people"), &rec)?["id"].as_i64().unwrap_or(0)
                        }
                    }
                }
            };
            db.exec(
                "INSERT INTO process_person (process_id, person_id, role) VALUES (?1, ?2, ?3)",
                args![process_id, person_id, role],
            )
            .map_err(|e| match e {
                Error::Constraint { .. } => {
                    Error::Conflict("they're already on this process".into())
                }
                e => e,
            })?;
            let who = db.label_of("people", &Value::from(person_id));
            let summary = match &role {
                Some(r) => format!("Added {who} to {} as {}", label(&process), role_label(r)),
                None => format!("Added {who} to {}", label(&process)),
            };
            db.log(
                &db.stamp(),
                res("processes"),
                &process,
                "updated",
                &summary,
                Some(json!({ "people": [null, { "person_id": person_id, "role": role }] })),
            )?;
            db.process_people(process_id)
        })
    }

    pub fn set_person_role(
        &self,
        process_id: i64,
        person_id: i64,
        input: &Record,
    ) -> Result<Vec<Record>> {
        self.atomic(|db| {
            let process = db.get(res("processes"), process_id)?;
            let role = db.check_role(input.get("role"))?;
            let old = db.query(
                "SELECT role FROM process_person WHERE process_id = ?1 AND person_id = ?2",
                &[Sql::Integer(process_id), Sql::Integer(person_id)],
            )?;
            let Some(old) = old.first() else {
                return Err(Error::NotFound("they aren't on this process".into()));
            };
            if old["role"].as_str() != role.as_deref() {
                db.exec(
                    "UPDATE process_person SET role = ?1 WHERE process_id = ?2 AND person_id = ?3",
                    args![role, process_id, person_id],
                )?;
                let who = db.label_of("people", &Value::from(person_id));
                db.log(
                    &db.stamp(),
                    res("processes"),
                    &process,
                    "updated",
                    &format!(
                        "Updated {} on {}: role: {} → {}",
                        who,
                        label(&process),
                        old["role"].as_str().map_or("—", role_label),
                        role.as_deref().map_or("—", role_label)
                    ),
                    Some(json!({ "role": [old["role"], role], "person_id": person_id })),
                )?;
            }
            db.process_people(process_id)
        })
    }

    pub fn remove_person(&self, process_id: i64, person_id: i64) -> Result<Vec<Record>> {
        self.atomic(|db| {
            let process = db.get(res("processes"), process_id)?;
            let n = db.exec(
                "DELETE FROM process_person WHERE process_id = ?1 AND person_id = ?2",
                args![process_id, person_id],
            )?;
            if n == 0 {
                return Err(Error::NotFound("they aren't on this process".into()));
            }
            let who = db.label_of("people", &Value::from(person_id));
            db.log(
                &db.stamp(),
                res("processes"),
                &process,
                "updated",
                &format!("Removed {who} from {}", label(&process)),
                Some(json!({ "people": [{ "person_id": person_id }, null] })),
            )?;
            db.process_people(process_id)
        })
    }

    fn check_role(&self, v: Option<&Value>) -> Result<Option<String>> {
        match v
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            None => Ok(None),
            Some(s) => resource::PERSON_ROLES
                .iter()
                .find(|(v, l)| v.eq_ignore_ascii_case(s) || l.eq_ignore_ascii_case(s))
                .map(|(v, _)| Some(v.to_string()))
                .ok_or_else(|| {
                    invalid(format!(
                        "role {s:?} isn't one of {}",
                        resource::PERSON_ROLES
                            .iter()
                            .map(|(v, _)| *v)
                            .collect::<Vec<_>>()
                            .join(", ")
                    ))
                }),
        }
    }

    // --- stages ------------------------------------------------------------------

    /// Put a stage's lanes in this order, top to bottom. Every one of its
    /// lanes must be listed.
    pub fn reorder_lanes(&self, stage: i64, ids: &[i64]) -> Result<Vec<Record>> {
        self.atomic(|db| {
            db.get(res("stages"), stage)?;
            let lanes = db.list(
                res("lanes"),
                None,
                &[("stage_id".into(), stage.to_string())],
                None,
            )?;
            let mut have: Vec<i64> = lanes.iter().filter_map(|l| l["id"].as_i64()).collect();
            let mut want = ids.to_vec();
            have.sort();
            want.sort();
            if have != want {
                return Err(invalid("list every lane of the stage, each once"));
            }
            for (i, id) in ids.iter().enumerate() {
                db.exec(
                    "UPDATE lane SET position = ?1 WHERE id = ?2",
                    args![i as i64, id],
                )?;
            }
            db.list(
                res("lanes"),
                None,
                &[("stage_id".into(), stage.to_string())],
                None,
            )
        })
    }

    /// Put the board's swimlanes in this order, top to bottom: every one, once.
    pub fn reorder_swimlanes(&self, ids: &[i64]) -> Result<Vec<Record>> {
        self.atomic(|db| {
            let lanes = db.list(res("swimlanes"), None, &[], None)?;
            let mut have: Vec<i64> = lanes.iter().filter_map(|l| l["id"].as_i64()).collect();
            let mut want = ids.to_vec();
            have.sort();
            want.sort();
            if have != want {
                return Err(invalid("list every swimlane, each once"));
            }
            for (i, id) in ids.iter().enumerate() {
                db.exec(
                    "UPDATE swimlane SET position = ?1 WHERE id = ?2",
                    args![i as i64, id],
                )?;
            }
            db.list(res("swimlanes"), None, &[], None)
        })
    }

    /// Put the stages in this order, left to right: every stage, or the
    /// board's (active) ones alone, the inactive ones keeping theirs after.
    pub fn reorder_stages(&self, ids: &[i64]) -> Result<Vec<Record>> {
        self.atomic(|db| {
            let stages = db.list(res("stages"), None, &[], None)?;
            let all: Vec<i64> = stages.iter().filter_map(|s| s["id"].as_i64()).collect();
            let board: Vec<i64> = stages
                .iter()
                .filter(|s| s["active"].as_i64() != Some(0))
                .filter_map(|s| s["id"].as_i64())
                .collect();
            let mut want = ids.to_vec();
            want.sort();
            let sorted = |v: &[i64]| {
                let mut v = v.to_vec();
                v.sort();
                v
            };
            // Every stage; or the board's alone, the inactive ones after them.
            let ids: Vec<i64> = if want == sorted(&all) {
                ids.to_vec()
            } else if want == sorted(&board) {
                ids.iter()
                    .copied()
                    .chain(all.iter().copied().filter(|s| !board.contains(s)))
                    .collect()
            } else {
                return Err(invalid("list every stage (or every active one), each once"));
            };
            for (i, id) in ids.iter().enumerate() {
                db.exec(
                    "UPDATE stage SET position = ?1 WHERE id = ?2",
                    args![i as i64, id],
                )?;
            }
            let after = db.list(res("stages"), None, &[], None)?;
            let names = |l: &[Record]| {
                l.iter()
                    .map(|s| label(s).to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            if names(&stages) != names(&after) {
                let mut rec = Record::new();
                rec.insert("id".into(), Value::from(0));
                db.log(
                    &db.stamp(),
                    res("stages"),
                    &rec,
                    "updated",
                    &format!("Reordered stages: {}", names(&after)),
                    Some(json!({ "order": [names(&stages), names(&after)] })),
                )?;
            }
            Ok(after)
        })
    }

    /// Delete a stage. Processes in it (archived ones too)
    /// go to `move_to`, which is needed if there are any.
    pub fn delete_stage(&self, id: i64, move_to: Option<i64>) -> Result<Record> {
        self.atomic(|db| {
            let stage = db.get(res("stages"), id)?;
            let active = db.int("SELECT count(*) FROM stage WHERE active = 1", &[])?;
            if stage["active"].as_i64() != Some(0) && active <= 1 {
                return Err(Error::Conflict("the board needs at least one stage".into()));
            }
            let inside: Vec<i64> = db
                .query(
                    "SELECT id FROM process WHERE stage_id = ?1 ORDER BY position",
                    &[Sql::Integer(id)],
                )?
                .iter()
                .filter_map(|r| r["id"].as_i64())
                .collect();
            if !inside.is_empty() {
                let to = move_to.ok_or_else(|| {
                    Error::Conflict(format!(
                        "{} process{} in {}; choose a stage to move {} to",
                        inside.len(),
                        if inside.len() == 1 { " is" } else { "es are" },
                        label(&stage),
                        if inside.len() == 1 { "it" } else { "them" }
                    ))
                })?;
                if to == id {
                    return Err(invalid("move them to a different stage"));
                }
                db.get(res("stages"), to)?;
                for pid in inside {
                    let mut patch = Record::new();
                    patch.insert("stage_id".into(), Value::from(to));
                    db.update(res("processes"), pid, &patch)?;
                }
            }
            db.delete(res("stages"), id)
        })
    }
}

fn role_label(r: &str) -> &str {
    resource::option_label(resource::PERSON_ROLES, r).unwrap_or(r)
}

/// `changes` is stored as JSON text; hand it out as JSON.
pub(crate) fn parse_changes(mut rec: Record) -> Record {
    if let Some(Value::String(s)) = rec.get("changes")
        && let Ok(v) = serde_json::from_str::<Value>(s)
    {
        rec.insert("changes".into(), v);
    }
    rec
}

/// The reasons for closing, for clients.
impl Db {
    /// The inactive stages, in order, as `{id, name}`: where closed
    /// processes are, a lane of one being why.
    pub fn closed_stages(&self) -> Result<Value> {
        Ok(Value::Array(
            self.query(
                "SELECT id, name FROM stage WHERE active = 0 ORDER BY position, id",
                &[],
            )?
            .into_iter()
            .map(Value::Object)
            .collect(),
        ))
    }

    /// The reasons for closing: the lanes of the inactive stages, in
    /// order, as `{value, label}` (`value` being the code a closed
    /// process's `archive_reason` gives), with their lane and stage.
    pub fn archive_reasons(&self) -> Result<Value> {
        Ok(Value::Array(
            self.query(
                &format!(
                    "SELECT l.id, {} AS value, l.name, l.stage_id, s.name AS stage FROM lane l \
                     JOIN stage s ON s.id = l.stage_id WHERE s.active = 0 ORDER BY s.position, s.id, l.position, l.id",
                    crate::db::LANE_CODE
                ),
                &[],
            )?
            .into_iter()
            .map(|r| {
                json!({ "id": r["id"], "value": r["value"], "label": r["name"],
                        "stage_id": r["stage_id"], "stage": r["stage"] })
            })
            .collect(),
        ))
    }

    /// Set the tags a record carries, by name; new names become tags. The
    /// change is logged on the record.
    pub fn set_tags(&self, resource_name: &str, id: i64, names: &[String]) -> Result<Vec<String>> {
        let r = resource(resource_name)
            .filter(|r| r.taggable)
            .ok_or_else(|| invalid(format!("{resource_name} can't be tagged")))?;
        self.atomic(|db| {
            let rec = db.get(r, id)?;
            let before: Vec<String> = rec["tags"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|t| t.as_str().map(String::from))
                .collect();
            let mut wanted: Vec<String> = Vec::new();
            for n in names {
                let n = n.split_whitespace().collect::<Vec<_>>().join(" ");
                if !n.is_empty() && !wanted.iter().any(|w| w.eq_ignore_ascii_case(&n)) {
                    wanted.push(n);
                }
            }
            db.exec(
                "DELETE FROM tagging WHERE entity = ?1 AND entity_id = ?2",
                args![r.entity, id],
            )?;
            let at = db.stamp();
            for n in &wanted {
                db.exec(
                    "INSERT OR IGNORE INTO tag (name, created_at, updated_at) VALUES (?1, ?2, ?2)",
                    args![n, at],
                )?;
                db.exec(
                    "INSERT OR IGNORE INTO tagging (tag_id, entity, entity_id) \
                     SELECT id, ?2, ?3 FROM tag WHERE lower(name) = lower(?1)",
                    args![n, r.entity, id],
                )?;
            }
            let after: Vec<String> = db.get(r, id)?["tags"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|t| t.as_str().map(String::from))
                .collect();
            let added: Vec<&String> = after
                .iter()
                .filter(|t| !before.iter().any(|b| b.eq_ignore_ascii_case(t)))
                .collect();
            let removed: Vec<&String> = before
                .iter()
                .filter(|t| !after.iter().any(|a| a.eq_ignore_ascii_case(t)))
                .collect();
            if !added.is_empty() || !removed.is_empty() {
                let mut parts = Vec::new();
                if !added.is_empty() {
                    parts.push(format!(
                        "+{}",
                        added
                            .iter()
                            .map(|s| s.as_str())
                            .collect::<Vec<_>>()
                            .join(", +")
                    ));
                }
                if !removed.is_empty() {
                    parts.push(format!(
                        "−{}",
                        removed
                            .iter()
                            .map(|s| s.as_str())
                            .collect::<Vec<_>>()
                            .join(", −")
                    ));
                }
                db.log(
                    &at,
                    r,
                    &rec,
                    "updated",
                    &format!("Tagged {} {}: {}", r.entity, label(&rec), parts.join(" ")),
                    Some(json!({ "tags": [before, after] })),
                )?;
            }
            Ok(after)
        })
    }
}

// --- the calendar --------------------------------------------------------------------

/// What the calendar can show.
pub const CALENDAR_KINDS: &[(&str, &str)] = &[
    ("step", "Interview steps"),
    ("next", "Next actions"),
    ("closes", "Applications close"),
    ("applied", "Applied"),
    ("posted", "Posted"),
];

/// Which dated things, from when to when, matching what.
#[derive(Debug, Default, Deserialize)]
pub struct CalendarQuery {
    /// The first day, YYYY-MM-DD [default: no limit].
    pub from: Option<String>,
    /// The last day, YYYY-MM-DD [default: no limit].
    pub to: Option<String>,
    /// Words to find in the company, role, or the event itself.
    pub q: Option<String>,
    /// Comma-separated kinds [default: steps, next actions, deadlines].
    pub kinds: Option<String>,
    /// active (the default), closed, or all. Closed is a closed process,
    /// or an active one whose cycle has ended; `archived` says closed too.
    pub status: Option<String>,
    /// Cancelled interview steps too [default: no].
    pub cancelled: Option<bool>,
    /// One company's, by its id.
    pub company: Option<i64>,
    /// Applications with this tag.
    pub tag: Option<String>,
}

/// Everything dated, as one list: each row's `kind`, `at` (a date, or a
/// date and time), `title`, `detail`, the process and application it
/// belongs to, and their company, role, stage (the one a closed process
/// reached) and status.
const EVENTS_SQL: &str = "
    SELECT 'step' AS kind, st.id AS ref_id, st.at AS at, st.title AS title, st.status AS detail,
           p.id AS process_id, a.id AS application_id, c.id AS company_id, c.name AS company,
           c.logo AS company_logo, a.title AS role, s.name AS stage, p.status AS status,
           (SELECT cy.ended_on FROM cycle cy WHERE cy.id = p.cycle_id) AS ended
    FROM step st JOIN process p ON p.id = st.process_id JOIN application a ON a.id = p.application_id
    JOIN company c ON c.id = a.company_id JOIN stage s ON s.id = coalesce(p.reached_stage_id, p.stage_id)
    WHERE st.at IS NOT NULL
  UNION ALL
    SELECT 'next', r.id, r.due_at, r.title, NULL,
           p.id, a.id, c.id, c.name, c.logo, a.title, s.name, p.status,
           (SELECT cy.ended_on FROM cycle cy WHERE cy.id = p.cycle_id)
    FROM reminder r JOIN process p ON p.id = r.process_id JOIN application a ON a.id = p.application_id
    JOIN company c ON c.id = a.company_id JOIN stage s ON s.id = coalesce(p.reached_stage_id, p.stage_id)
    WHERE r.due_at IS NOT NULL AND r.done_at IS NULL
  UNION ALL
    SELECT 'applied', p.id, p.applied_on, 'Applied', NULL,
           p.id, a.id, c.id, c.name, c.logo, a.title, s.name, p.status,
           (SELECT cy.ended_on FROM cycle cy WHERE cy.id = p.cycle_id)
    FROM process p JOIN application a ON a.id = p.application_id
    JOIN company c ON c.id = a.company_id JOIN stage s ON s.id = coalesce(p.reached_stage_id, p.stage_id)
    WHERE p.applied_on IS NOT NULL
  UNION ALL
    SELECT 'closes', a.id, a.closes_on, 'Applications close', NULL,
           p.id, a.id, c.id, c.name, c.logo, a.title, s.name, p.status,
           (SELECT cy.ended_on FROM cycle cy WHERE cy.id = p.cycle_id)
    FROM application a JOIN company c ON c.id = a.company_id
    LEFT JOIN process p ON p.id = (SELECT id FROM process WHERE application_id = a.id ORDER BY created_at DESC LIMIT 1)
    LEFT JOIN stage s ON s.id = coalesce(p.reached_stage_id, p.stage_id)
    WHERE a.closes_on IS NOT NULL
      /* Only until applied for: applied on a day, or past the first stage. */
      AND (p.id IS NULL OR (p.applied_on IS NULL
           AND coalesce(p.reached_stage_id, p.stage_id) = (SELECT id FROM stage WHERE active = 1 ORDER BY position, id LIMIT 1)))
  UNION ALL
    SELECT 'posted', a.id, a.posted_on, 'Posted', NULL,
           p.id, a.id, c.id, c.name, c.logo, a.title, s.name, p.status,
           (SELECT cy.ended_on FROM cycle cy WHERE cy.id = p.cycle_id)
    FROM application a JOIN company c ON c.id = a.company_id
    LEFT JOIN process p ON p.id = (SELECT id FROM process WHERE application_id = a.id ORDER BY created_at DESC LIMIT 1)
    LEFT JOIN stage s ON s.id = coalesce(p.reached_stage_id, p.stage_id)
    WHERE a.posted_on IS NOT NULL";

/// The setting holding the calendar's private link, while it's shared.
pub(crate) const CALENDAR_TOKEN: &str = "calendar.token";

/// A secret for the calendar's private link: 32 characters, hard to guess.
fn calendar_token() -> String {
    format!(
        "{}{}",
        crate::google::random_token(),
        crate::google::random_token()
    )
    .chars()
    .filter(char::is_ascii_alphanumeric)
    .take(32)
    .collect()
}

impl Db {
    /// Whose calendar a private link shares, if it's one: the account (with
    /// several people), or the one person's hunt (`Some(None)`).
    pub fn calendar_sharer(&self, token: &str) -> Result<Option<Option<i64>>> {
        if token.len() < 32 || !token.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Ok(None);
        }
        let who = self.int(
            "SELECT owner_id AS who /* all owners */ FROM setting WHERE name = ?1 AND value = ?2",
            crate::args![CALENDAR_TOKEN, token],
        )?;
        Ok((who != 0).then_some(Some(who)))
    }

    /// Dated things, in time order: for the calendar.
    pub fn calendar(&self, q: &CalendarQuery) -> Result<Vec<Record>> {
        let mut sql = format!("SELECT * FROM ({EVENTS_SQL}) e WHERE 1 = 1");
        let mut params: Vec<Sql> = Vec::new();
        if let Some(from) = q.from.as_deref().filter(|s| !s.is_empty()) {
            sql += " AND substr(e.at, 1, 10) >= ?";
            params.push(Sql::Text(crate::time::check_date(from)?));
        }
        if let Some(to) = q.to.as_deref().filter(|s| !s.is_empty()) {
            sql += " AND substr(e.at, 1, 10) <= ?";
            params.push(Sql::Text(crate::time::check_date(to)?));
        }
        let kinds: Vec<String> = match q.kinds.as_deref().filter(|s| !s.is_empty()) {
            Some(k) => k
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            None => vec!["step".into(), "next".into(), "closes".into()],
        };
        for k in &kinds {
            if !CALENDAR_KINDS.iter().any(|(v, _)| v == k) {
                return Err(invalid(format!(
                    "kinds: {k:?} isn't one of {}",
                    CALENDAR_KINDS
                        .iter()
                        .map(|(v, _)| *v)
                        .collect::<Vec<_>>()
                        .join(", ")
                )));
            }
        }
        sql += &format!(" AND e.kind IN ({})", vec!["?"; kinds.len()].join(", "));
        params.extend(kinds.into_iter().map(Sql::Text));
        match q.status.as_deref().unwrap_or("active") {
            // Active: on a running cycle's board.
            "active" => sql += " AND coalesce(e.status, 'active') = 'active' AND e.ended IS NULL",
            // Closed, or left behind when its cycle ended: every event is
            // either active or closed.
            "closed" | "archived" => sql += " AND (e.status = 'archived' OR e.ended IS NOT NULL)",
            "all" | "" => {}
            other => {
                return Err(invalid(format!(
                    "status: {other:?} isn't active, closed or all"
                )));
            }
        }
        if !q.cancelled.unwrap_or(false) {
            sql += " AND NOT (e.kind = 'step' AND e.detail = 'cancelled')";
        }
        if let Some(company) = q.company {
            sql += " AND e.company_id = ?";
            params.push(Sql::Integer(company));
        }
        if let Some(tag) = q.tag.as_deref().filter(|t| !t.is_empty()) {
            sql += " AND e.application_id IN (SELECT x.entity_id FROM tagging x JOIN tag g ON g.id = x.tag_id \
                    WHERE x.entity = 'application' AND lower(g.name) = lower(?))";
            params.push(Sql::Text(tag.into()));
        }
        // Words in its company, role or title (not its step's outcome).
        for word in q.q.as_deref().unwrap_or("").split_whitespace() {
            sql += " AND (e.company || ' ' || coalesce(e.role, '') || ' ' || e.title) LIKE ?";
            params.push(Sql::Text(format!("%{word}%")));
        }
        sql += " ORDER BY e.at, e.kind, e.company";
        self.query(&sql, &params)
    }

    /// The calendar as iCalendar, for calendar apps to subscribe to: active
    /// processes' interview steps, next actions and deadlines, from a month
    /// ago onwards.
    pub fn calendar_ics(&self, kinds: Option<&str>) -> Result<String> {
        let today = self.clock().date();
        let from = today
            .checked_sub(jiff::Span::new().days(31))
            .unwrap_or(today);
        let events = self.calendar(&CalendarQuery {
            from: Some(crate::time::date(from)),
            kinds: kinds.map(String::from),
            ..CalendarQuery::default()
        })?;
        let stamp = self.clock().strftime("%Y%m%dT%H%M%S").to_string();
        // With a time zone chosen in Settings, times are in it; without, they
        // float (each calendar shows them in its own).
        let zone = self.setting("locale.timezone")?;
        let mut out = String::from(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//hunt//job search//EN\r\nCALSCALE:GREGORIAN\r\n\
             X-WR-CALNAME:Job search\r\n",
        );
        if let Some(zone) = &zone {
            out += &fold(&format!("X-WR-TIMEZONE:{zone}"));
        }
        for e in &events {
            let at = e["at"].as_str().unwrap_or_default();
            let kind = e["kind"].as_str().unwrap_or_default();
            let what = match kind {
                "step" => format!("Interview: {}", e["title"].as_str().unwrap_or_default()),
                "next" => format!("To do: {}", e["title"].as_str().unwrap_or_default()),
                _ => e["title"].as_str().unwrap_or_default().to_string(),
            };
            let role = e["role"]
                .as_str()
                .map(|r| format!(", {r}"))
                .unwrap_or_default();
            let summary = format!(
                "{what} — {}{role}",
                e["company"].as_str().unwrap_or_default()
            );
            let day = at.get(..10).unwrap_or(at).replace('-', "");
            let time = at
                .get(11..16)
                .filter(|t| *t != "00:00")
                .map(|t| t.replace(':', ""));
            out += "BEGIN:VEVENT\r\n";
            out += &fold(&format!("UID:{kind}-{}@hunt", e["ref_id"]));
            out += &fold(&format!("DTSTAMP:{stamp}"));
            match time {
                // Local, as it was entered: in the zone chosen, if one was.
                Some(t) => {
                    out += &fold(&match &zone {
                        Some(z) => format!("DTSTART;TZID={z}:{day}T{t}00"),
                        None => format!("DTSTART:{day}T{t}00"),
                    });
                    out += &fold("DURATION:PT1H");
                }
                None => out += &fold(&format!("DTSTART;VALUE=DATE:{day}")),
            }
            out += &fold(&format!("SUMMARY:{}", ics_text(&summary)));
            if let Some(stage) = e["stage"].as_str() {
                out += &fold(&format!(
                    "DESCRIPTION:{}",
                    ics_text(&format!("In {stage}."))
                ));
            }
            out += "END:VEVENT\r\n";
        }
        out += "END:VCALENDAR\r\n";
        Ok(out)
    }
}

/// Text in iCalendar: backslash, comma, semicolon and newline escaped.
fn ics_text(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(',', "\\,")
        .replace(';', "\\;")
        .replace('\n', "\\n")
}

/// An iCalendar line, folded at 75 bytes as the format asks.
fn fold(line: &str) -> String {
    let mut out = String::new();
    let mut width = 0;
    for ch in line.chars() {
        let n = ch.len_utf8();
        if width + n > 75 {
            out += "\r\n ";
            width = 1;
        }
        out.push(ch);
        width += n;
    }
    out + "\r\n"
}

// --- settings --------------------------------------------------------------------

/// What happens when a profile sent from LinkedIn names someone already
/// kept under another (or no) profile link.
pub const SAME_NAME: &[(&str, &str)] = &[
    ("ask", "Ask me"),
    ("merge", "Merge into them"),
    ("new", "Add a new person"),
];

/// How times are shown: as the region does, or 24- or 12-hour.
pub const CLOCKS: &[(&str, &str)] = &[
    ("auto", "As the region does"),
    ("24", "24-hour (14:30)"),
    ("12", "12-hour (2:30 pm)"),
];

/// The day weeks start on, in the calendar.
pub const WEEK_STARTS: &[(&str, &str)] = &[("monday", "Monday"), ("sunday", "Sunday")];

/// The days of the week, Monday first: for working days.
pub const WEEKDAYS: &[(&str, &str)] = &[
    ("monday", "Monday"),
    ("tuesday", "Tuesday"),
    ("wednesday", "Wednesday"),
    ("thursday", "Thursday"),
    ("friday", "Friday"),
    ("saturday", "Saturday"),
    ("sunday", "Sunday"),
];

/// How many other time zones the calendar can show beside its own.
pub const MAX_CALENDAR_ZONES: usize = 3;

/// Working hours, as `{start, end, days}`: "09:00", "17:30", and the days
/// (monday …); null for none. A setting's JSON, checked.
fn work_hours(v: &Value) -> Result<Option<String>> {
    if v.is_null() {
        return Ok(None);
    }
    let time = |k: &str| -> Result<String> {
        let t = v[k].as_str().unwrap_or("");
        let ok = t.len() == 5
            && t.as_bytes()[2] == b':'
            && t[..2].parse::<u8>().is_ok_and(|h| h < 24)
            && t[3..].parse::<u8>().is_ok_and(|m| m < 60);
        if ok {
            Ok(t.to_string())
        } else {
            Err(invalid(format!(
                "work_hours.{k} is a time like 09:00, not {:?}",
                v[k]
            )))
        }
    };
    let (start, end) = (time("start")?, time("end")?);
    if start >= end {
        return Err(invalid("work_hours: the end has to be after the start"));
    }
    let given: Vec<&str> = v["days"]
        .as_array()
        .map(|d| d.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if let Some(day) = given
        .iter()
        .find(|d| !WEEKDAYS.iter().any(|(k, _)| k == *d))
    {
        return Err(invalid(format!("work_hours.days: {day:?} isn't a day")));
    }
    // In the week's order, once each.
    let days: Vec<&str> = WEEKDAYS
        .iter()
        .map(|(k, _)| *k)
        .filter(|k| given.contains(k))
        .collect();
    if days.is_empty() {
        return Err(invalid("work_hours.days: at least one day"));
    }
    Ok(Some(
        json!({ "start": start, "end": end, "days": days }).to_string(),
    ))
}

/// The languages the web UI speaks: (code, its own name, direction).
pub const LANGUAGES: &[(&str, &str, &str)] = &[("en", "English", "ltr"), ("ar", "العربية", "rtl")];

/// Parts of the UK, as income tax divides them.
pub const UK_REGIONS: &[(&str, &str)] = &[
    ("rest", "England, Wales or Northern Ireland"),
    ("scotland", "Scotland"),
];

/// How numbers are written: the language's own way, or always one script.
pub const NUMERALS: &[(&str, &str)] = &[
    ("auto", "As the language does"),
    ("latn", "Western (0123)"),
    ("arab", "Arabic-Indic (٠١٢٣)"),
];

impl Db {
    /// Settings kept by the service: where the bookmark sends profiles, and
    /// what to do about a name already here.
    pub fn settings(&self) -> Result<Value> {
        let currency = self
            .setting("locale.currency")?
            .unwrap_or_else(|| "GBP".into());
        // Pay is kept in GBP; the page shows it in this currency, at this rate.
        let rate = if currency == "GBP" {
            Some((1.0, String::new()))
        } else {
            self.cached_rate(&currency)?
        };
        Ok(json!({
            "bookmarklet_url": self.setting("bookmarklet.url")?,
            "same_name": self.setting("people.same_name")?.unwrap_or_else(|| "ask".into()),
            "locale": self.setting("locale.region")?,
            "clock": self.setting("locale.clock")?.unwrap_or_else(|| "auto".into()),
            "week_start": self.setting("locale.week_start")?.unwrap_or_else(|| "monday".into()),
            "currency": currency,
            "currency_rate": rate.as_ref().map(|r| r.0),
            "currency_rate_on": rate.map(|r| r.1).filter(|d| !d.is_empty()),
            "language": self.setting("locale.language")?.unwrap_or_else(|| "en".into()),
            "numerals": self.setting("locale.numerals")?.unwrap_or_else(|| "auto".into()),
            // The zone hunt keeps time in: chosen, or the machine's own.
            "timezone": self.setting("locale.timezone")?,
            "server_timezone": jiff::tz::TimeZone::system().iana_name().unwrap_or("UTC"),
            // Where you live, for tax: a UK resident has take-home pay
            // (where it's on), worked out for their part of the UK.
            "uk_resident": self.setting("location.uk_resident")?.as_deref() == Some("true"),
            "uk_region": self.setting("location.uk_region")?.unwrap_or_else(|| "rest".into()),
            // The take-home pay wanted, in the home currency, a week, month or
            // year: what take-home pay is set against.
            "desired_take_home": self.setting("pay.desired_take_home")?.and_then(|v| v.parse::<f64>().ok()),
            "desired_take_home_per": self.setting("pay.desired_take_home_per")?.unwrap_or_else(|| "month".into()),
            // Sharing the calendar with calendar apps: the private link's
            // secret while it's on (off unless turned on).
            "calendar_feed": self.setting(CALENDAR_TOKEN)?,
            // Working hours, shaded outside in the calendar: {start, end,
            // days}, or none.
            "work_hours": self.setting("calendar.work_hours")?
                .and_then(|w| serde_json::from_str::<Value>(&w).ok()),
            // Other time zones the calendar shows its hours in, beside its own.
            "calendar_zones": self.setting("calendar.zones")?
                .and_then(|z| serde_json::from_str::<Value>(&z).ok())
                .unwrap_or_else(|| json!([])),
        }))
    }

    /// Change some settings; those left out stay. An empty URL goes back to
    /// the address hunt is opened at.
    pub fn update_settings(&self, v: &Value) -> Result<Value> {
        // Sharing the calendar: on (a private link), off (the link stops
        // working), or "new" (another link, the old one stopping).
        if let Some(share) = v.get("calendar_feed") {
            match share {
                Value::Bool(false) | Value::Null => self.set_setting(CALENDAR_TOKEN, None)?,
                Value::Bool(true) if self.setting(CALENDAR_TOKEN)?.is_some() => {}
                Value::Bool(true) => self.set_setting(CALENDAR_TOKEN, Some(&calendar_token()))?,
                Value::String(s) if s == "new" => {
                    self.set_setting(CALENDAR_TOKEN, Some(&calendar_token()))?;
                }
                other => {
                    return Err(invalid(format!(
                        "calendar_feed: true, false or \"new\", not {other}"
                    )));
                }
            }
        }
        if let Some(url) = v.get("bookmarklet_url") {
            let url = url.as_str().unwrap_or("").trim().trim_end_matches('/');
            if url.is_empty() {
                self.set_setting("bookmarklet.url", None)?;
            } else {
                let ok = url
                    .parse::<ureq::http::Uri>()
                    .ok()
                    .filter(|u| {
                        matches!(u.scheme_str(), Some("http" | "https")) && u.host().is_some()
                    })
                    .filter(|u| u.path().is_empty() || u.path() == "/");
                if ok.is_none() {
                    return Err(invalid(format!(
                        "hunt's address should be like http://127.0.0.1:4848, not {url:?}"
                    )));
                }
                self.set_setting("bookmarklet.url", Some(url))?;
            }
        }
        if let Some(rule) = v.get("same_name") {
            let rule = rule.as_str().unwrap_or("");
            if !SAME_NAME.iter().any(|(k, _)| *k == rule) {
                return Err(invalid(format!(
                    "same_name is one of ask, merge, new; not {rule:?}"
                )));
            }
            self.set_setting("people.same_name", Some(rule))?;
        }
        if let Some(region) = v.get("locale") {
            // A language tag (en-GB, de-DE, pt-BR …), or none: the browser's.
            let region = region.as_str().unwrap_or("").trim();
            let ok = region.split('-').all(|p| {
                (2..=8).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric())
            });
            if !region.is_empty() && !ok {
                return Err(invalid(format!("a region is like en-GB, not {region:?}")));
            }
            self.set_setting("locale.region", Some(region).filter(|r| !r.is_empty()))?;
        }
        let languages: Vec<(&str, &str)> = LANGUAGES.iter().map(|(c, n, _)| (*c, *n)).collect();
        for (key, setting, choices) in [
            ("clock", "locale.clock", CLOCKS),
            ("week_start", "locale.week_start", WEEK_STARTS),
            ("language", "locale.language", languages.as_slice()),
            ("numerals", "locale.numerals", NUMERALS),
        ] {
            if let Some(value) = v.get(key) {
                let value = value.as_str().unwrap_or("");
                if !choices.iter().any(|(k, _)| *k == value) {
                    let names: Vec<_> = choices.iter().map(|(k, _)| *k).collect();
                    return Err(invalid(format!(
                        "{key} is one of {}; not {value:?}",
                        names.join(", ")
                    )));
                }
                self.set_setting(setting, Some(value))?;
            }
        }
        if let Some(zone) = v.get("timezone") {
            // An IANA zone (Europe/London), or none: the machine's own.
            let zone = zone.as_str().unwrap_or("").trim();
            if zone.is_empty() {
                self.set_setting("locale.timezone", None)?;
                self.set_zone(None);
            } else {
                let tz = jiff::tz::TimeZone::get(zone).map_err(|_| {
                    invalid(format!("a time zone is like Europe/London, not {zone:?}"))
                })?;
                self.set_setting("locale.timezone", Some(zone))?;
                self.set_zone(Some(tz));
            }
        }
        if let Some(hours) = v.get("work_hours") {
            self.set_setting("calendar.work_hours", work_hours(hours)?.as_deref())?;
        }
        if let Some(zones) = v.get("calendar_zones") {
            // IANA zones, once each, as many as fit beside the hours.
            let mut kept: Vec<String> = Vec::new();
            for z in zones
                .as_array()
                .ok_or_else(|| invalid("calendar_zones is a list of time zones"))?
            {
                let z = z.as_str().unwrap_or("").trim();
                if jiff::tz::TimeZone::get(z).is_err() {
                    return Err(invalid(format!(
                        "a time zone is like Asia/Tokyo, not {z:?}"
                    )));
                }
                if !kept.iter().any(|k| k == z) {
                    kept.push(z.to_string());
                }
            }
            if kept.len() > MAX_CALENDAR_ZONES {
                return Err(invalid(format!(
                    "calendar_zones: at most {MAX_CALENDAR_ZONES}"
                )));
            }
            let json = (!kept.is_empty()).then(|| json!(kept).to_string());
            self.set_setting("calendar.zones", json.as_deref())?;
        }
        if let Some(uk) = v.get("uk_resident") {
            let uk = uk
                .as_bool()
                .ok_or_else(|| invalid("uk_resident is true or false"))?;
            self.set_setting("location.uk_resident", uk.then_some("true"))?;
        }
        if let Some(region) = v.get("uk_region") {
            let region = region.as_str().unwrap_or("");
            if !UK_REGIONS.iter().any(|(k, _)| *k == region) {
                return Err(invalid(format!(
                    "uk_region is one of rest, scotland; not {region:?}"
                )));
            }
            self.set_setting("location.uk_region", Some(region))?;
        }
        if let Some(want) = v.get("desired_take_home") {
            match want {
                Value::Null => self.set_setting("pay.desired_take_home", None)?,
                w => {
                    let n = w
                        .as_f64()
                        .filter(|n| n.is_finite() && (0.0..=100_000_000.0).contains(n))
                        .ok_or_else(|| {
                            invalid("desired_take_home is an amount from 0, or null for none")
                        })?;
                    self.set_setting("pay.desired_take_home", Some(&n.to_string()))?;
                }
            }
        }
        if let Some(per) = v.get("desired_take_home_per") {
            let per = per.as_str().unwrap_or("");
            if !["week", "month", "year"].contains(&per) {
                return Err(invalid(format!(
                    "desired_take_home_per is one of week, month, year; not {per:?}"
                )));
            }
            self.set_setting("pay.desired_take_home_per", Some(per))?;
        }
        if let Some(currency) = v.get("currency") {
            let given = currency.as_str().unwrap_or("");
            let code = crate::fx::normalize_currency(given).ok_or_else(|| {
                invalid(format!(
                    "a currency is a code like GBP or EUR, not {given:?}"
                ))
            })?;
            if code != "GBP" && self.cached_rate(&code)?.is_none() {
                return Err(invalid(format!("hunt has no exchange rate for {code}")));
            }
            self.set_setting("locale.currency", Some(&code))?;
        }
        self.settings()
    }
}

impl Db {
    /// Set who an interview step is with, by their ids. The change is
    /// logged on the step.
    pub fn set_step_people(&self, step_id: i64, person_ids: &[i64]) -> Result<Record> {
        self.atomic(|db| {
            let r = res("steps");
            let step = db.get(r, step_id)?;
            let mut ids = person_ids.to_vec();
            ids.sort_unstable();
            ids.dedup();
            for id in &ids {
                db.get(res("people"), *id)?;
            }
            let names = |rec: &Record| -> String {
                let list: Vec<&str> = rec["people"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|p| p["name"].as_str())
                    .collect();
                if list.is_empty() {
                    "—".into()
                } else {
                    list.join(", ")
                }
            };
            db.exec(
                "DELETE FROM step_person WHERE step_id = ?1",
                crate::args![step_id],
            )?;
            for id in &ids {
                db.exec(
                    "INSERT INTO step_person (step_id, person_id) VALUES (?1, ?2)",
                    crate::args![step_id, id],
                )?;
            }
            let after = db.get(r, step_id)?;
            let (was, now) = (names(&step), names(&after));
            if was != now {
                db.log(
                    &db.stamp(),
                    r,
                    &after,
                    "updated",
                    &format!("Updated step {}: with: {was} → {now}", label(&after)),
                    Some(json!({ "people": [step["people"], after["people"]] })),
                )?;
            }
            Ok(after)
        })
    }
}

// ---- many at once ----------------------------------------------------------------------

/// A change to several processes at once: `POST /api/processes/bulk`.
#[derive(Debug, Default, Deserialize)]
pub struct Bulk {
    /// The processes (restore takes them from `states`).
    #[serde(default)]
    pub ids: Vec<i64>,
    /// move, archive, resume, tag, untag, set, delete or restore.
    pub action: String,
    /// move: the stage, and a lane of it.
    pub stage_id: Option<i64>,
    pub lane_id: Option<i64>,
    /// archive: why (a reason's code), and a note.
    pub reason: Option<String>,
    pub note: Option<String>,
    /// tag, untag: the tags, on each process's application.
    #[serde(default)]
    pub tags: Vec<String>,
    /// set: process fields (applied_on, cycle_id …).
    pub fields: Option<Record>,
    /// restore: processes as they were (a bulk change's `before`), to undo it.
    #[serde(default)]
    pub states: Vec<Record>,
}

/// The fields a bulk change can put back, and returns as `before`.
const RESTORED: &[&str] = &[
    "stage_id",
    "lane_id",
    "status",
    "archive_reason",
    "archive_note",
    "cycle_id",
    "applied_on",
];

impl Db {
    /// Change several processes at once, all or nothing: every one is
    /// checked, then all are changed in one transaction, each logged as if
    /// changed alone. Those the change doesn't apply to (archiving one
    /// already archived) are skipped, and said so. `before` has each one as
    /// it was, tags included: sent back as `restore`, it undoes the change.
    pub fn bulk_processes(&self, b: &Bulk) -> Result<Value> {
        let mut ids: Vec<i64> = Vec::new();
        for id in &b.ids {
            if !ids.contains(id) {
                ids.push(*id);
            }
        }
        if b.action == "restore" {
            ids = b
                .states
                .iter()
                .filter_map(|s| s.get("id").and_then(Value::as_i64))
                .collect();
        }
        if ids.is_empty() {
            return Err(invalid("choose some processes (ids)"));
        }
        self.atomic(|db| {
            // Every one first: a missing id stops it all.
            let mut olds = Vec::new();
            for id in &ids {
                let p = db.get(res("processes"), *id).map_err(|_| {
                    invalid(format!("no process #{id}; nothing was changed"))
                })?;
                olds.push(p);
            }
            let mut before = Vec::new();
            for p in &olds {
                let mut state: Record = RESTORED
                    .iter()
                    .map(|k| (k.to_string(), p.get(*k).cloned().unwrap_or(Value::Null)))
                    .collect();
                state.insert("id".into(), p["id"].clone());
                let app = db.get(res("applications"), p["application_id"].as_i64().unwrap_or(0))?;
                state.insert("tags".into(), app["tags"].clone());
                before.push(Value::Object(state));
            }
            let mut done = Vec::new();
            let mut skipped = Vec::new();
            let skip = |skipped: &mut Vec<Value>, p: &Record, why: &str| {
                skipped.push(json!({ "id": p["id"], "label": p["label"], "why": why }));
            };
            let tags_of = |db: &Db, app: i64| -> Result<Vec<String>> {
                Ok(db.get(res("applications"), app)?["tags"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|t| t.as_str().map(String::from))
                    .collect())
            };
            match b.action.as_str() {
                "move" => {
                    let stage = b
                        .stage_id
                        .ok_or_else(|| invalid("move to which stage (stage_id)?"))?;
                    db.check_lane(stage, &b.lane_id.map_or(Value::Null, Value::from))?;
                    for p in &olds {
                        let id = p["id"].as_i64().unwrap_or(0);
                        db.move_process(id, &Move { stage_id: stage, lane_id: b.lane_id, index: None, top: false })?;
                        done.push(id);
                    }
                }
                "archive" => {
                    // Why: a reason (a closing lane's code), or an inactive
                    // stage without one.
                    let reason = b.reason.as_deref().filter(|r| !r.is_empty());
                    let into = b.stage_id.filter(|s| !db.stage_active(*s));
                    if reason.is_none() && into.is_none() {
                        return Err(invalid(
                            "say why they're closed (reason), or where (an inactive stage_id)",
                        ));
                    }
                    for p in &olds {
                        if p["status"] == "archived" {
                            skip(&mut skipped, p, "already closed");
                            continue;
                        }
                        let id = p["id"].as_i64().unwrap_or(0);
                        let mut patch = Record::new();
                        match reason {
                            Some(r) => {
                                patch.insert("status".into(), json!("archived"));
                                patch.insert("archive_reason".into(), json!(r));
                            }
                            None => {
                                patch.insert("stage_id".into(), json!(into));
                            }
                        }
                        patch.insert("archive_note".into(), json!(b.note));
                        db.update(res("processes"), id, &patch)?;
                        done.push(id);
                    }
                }
                "resume" => {
                    for p in &olds {
                        if p["status"] == "active" {
                            skip(&mut skipped, p, "already on the board");
                            continue;
                        }
                        // Back to the stage it reached (Db::settle_process).
                        let id = p["id"].as_i64().unwrap_or(0);
                        let mut patch = Record::new();
                        patch.insert("status".into(), json!("active"));
                        db.update(res("processes"), id, &patch)?;
                        done.push(id);
                    }
                }
                "tag" | "untag" => {
                    if b.tags.iter().all(|t| t.trim().is_empty()) {
                        return Err(invalid("which tags?"));
                    }
                    let mut seen = Vec::new();
                    for p in &olds {
                        let app = p["application_id"].as_i64().unwrap_or(0);
                        if seen.contains(&app) {
                            continue;
                        }
                        seen.push(app);
                        let had = tags_of(db, app)?;
                        let want: Vec<String> = if b.action == "tag" {
                            let mut w = had.clone();
                            for t in &b.tags {
                                if !w.iter().any(|x| x.eq_ignore_ascii_case(t.trim())) {
                                    w.push(t.trim().to_string());
                                }
                            }
                            w
                        } else {
                            had.iter()
                                .filter(|x| !b.tags.iter().any(|t| t.trim().eq_ignore_ascii_case(x)))
                                .cloned()
                                .collect()
                        };
                        if want == had {
                            skip(&mut skipped, p, "no change");
                            continue;
                        }
                        db.set_tags("applications", app, &want)?;
                        done.push(p["id"].as_i64().unwrap_or(0));
                    }
                }
                "set" => {
                    let fields = b
                        .fields
                        .as_ref()
                        .filter(|f| !f.is_empty())
                        .ok_or_else(|| invalid("set which fields?"))?;
                    for p in &olds {
                        let id = p["id"].as_i64().unwrap_or(0);
                        db.update(res("processes"), id, fields)?;
                        done.push(id);
                    }
                }
                "delete" => {
                    // A process's application goes, and every process of it.
                    let mut seen = Vec::new();
                    for p in &olds {
                        let app = p["application_id"].as_i64().unwrap_or(0);
                        if !seen.contains(&app) {
                            seen.push(app);
                            db.delete(res("applications"), app)?;
                        }
                        done.push(p["id"].as_i64().unwrap_or(0));
                    }
                }
                "restore" => {
                    for state in &b.states {
                        let id = state["id"].as_i64().unwrap_or(0);
                        let stage = state["stage_id"].as_i64().unwrap_or(0);
                        let lane = state["lane_id"].as_i64();
                        // Its column and lane (back on the board, if it was there) …
                        db.move_process(id, &Move { stage_id: stage, lane_id: lane, index: None, top: true })?;
                        // … then the rest as it was, archived again if it was.
                        let mut patch = Record::new();
                        for k in RESTORED.iter().filter(|k| !matches!(**k, "stage_id" | "lane_id")) {
                            patch.insert(k.to_string(), state.get(*k).cloned().unwrap_or(Value::Null));
                        }
                        db.update(res("processes"), id, &patch)?;
                        if let Some(tags) = state.get("tags").and_then(Value::as_array) {
                            let app = db.get(res("processes"), id)?["application_id"].as_i64().unwrap_or(0);
                            let names: Vec<String> =
                                tags.iter().filter_map(|t| t.as_str().map(String::from)).collect();
                            if tags_of(db, app)? != names {
                                db.set_tags("applications", app, &names)?;
                            }
                        }
                        done.push(id);
                    }
                }
                other => {
                    return Err(invalid(format!(
                        "no bulk action {other:?}: move, archive, resume, tag, untag, set, delete or restore"
                    )));
                }
            }
            Ok(json!({ "done": done, "skipped": skipped, "before": before }))
        })
    }

    /// Tag or untag several records of a resource at once, all or nothing.
    pub fn bulk_tags(
        &self,
        resource_name: &str,
        ids: &[i64],
        add: &[String],
        remove: &[String],
    ) -> Result<Value> {
        let r = resource(resource_name)
            .filter(|r| r.taggable)
            .ok_or_else(|| invalid(format!("{resource_name} can't be tagged")))?;
        self.atomic(|db| {
            let mut changed = Vec::new();
            for id in ids {
                let had: Vec<String> = db.get(r, *id)?["tags"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|t| t.as_str().map(String::from))
                    .collect();
                let mut want: Vec<String> = had
                    .iter()
                    .filter(|x| !remove.iter().any(|t| t.trim().eq_ignore_ascii_case(x)))
                    .cloned()
                    .collect();
                for t in add {
                    if !t.trim().is_empty()
                        && !want.iter().any(|x| x.eq_ignore_ascii_case(t.trim()))
                    {
                        want.push(t.trim().to_string());
                    }
                }
                if want != had {
                    db.set_tags(resource_name, *id, &want)?;
                    changed.push(*id);
                }
            }
            Ok(json!({ "changed": changed }))
        })
    }

    /// Delete several records of a resource at once, all or nothing: if one
    /// can't go (a company with applications), none do.
    pub fn bulk_delete(&self, resource_name: &str, ids: &[i64]) -> Result<Value> {
        let r = resource(resource_name)
            .ok_or_else(|| invalid(format!("no resource {resource_name}")))?;
        self.atomic(|db| {
            for id in ids {
                db.delete(r, *id)?;
            }
            Ok(json!({ "deleted": ids }))
        })
    }
}
