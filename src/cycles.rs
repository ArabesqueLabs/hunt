//! Cycles: job searches. Several can run at once (by season, place or
//! industry); every process is in one. One that has ended keeps its board
//! exactly as it was: its processes can't be moved, archived or changed.
//! Companies, people, stories and settings are shared by them all.

use jiff::civil::Date;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::args;
use crate::db::{Db, Record, label};
use crate::error::{Error, Result, invalid};
use crate::service::res;
use crate::time;

/// What starting a cycle takes: its details, and the processes of an ended
/// cycle to bring back into it.
#[derive(Debug, Default, Deserialize)]
pub struct Start {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub started_on: Option<String>,
    /// Processes of ended cycles, to carry on in this one: each comes back
    /// as a new process of the same application, in the first stage.
    #[serde(default)]
    pub bring_back: Vec<i64>,
}

/// What ending a cycle takes: how it ended, and with an offer, which
/// process it was (none: one that isn't on the board).
#[derive(Debug, Default, Deserialize)]
pub struct End {
    pub outcome: String,
    #[serde(default)]
    pub process_id: Option<i64>,
    /// A new name for it, if it's to change as it ends.
    #[serde(default)]
    pub name: Option<String>,
}

/// A season and year to name a cycle by: "Autumn 2026".
pub fn season_name(d: Date) -> String {
    let season = match d.month() {
        3..=5 => "Spring",
        6..=8 => "Summer",
        9..=11 => "Autumn",
        _ => "Winter",
    };
    format!("{season} {}", d.year())
}

impl Db {
    /// A new hunt's first cycle, named for the season, starting today.
    pub(crate) fn seed_cycle(&self) -> Result<i64> {
        let at = self.stamp();
        let today = self.clock().date();
        self.insert(
            "INSERT INTO cycle (name, started_on, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            args![season_name(today), time::date(today), at],
        )
    }

    /// The cycle a new process goes into when it doesn't say: the running
    /// one started last; with none running, a new one.
    pub(crate) fn default_cycle(&self) -> Result<i64> {
        let latest = self.int(
            "SELECT id FROM cycle WHERE ended_on IS NULL ORDER BY started_on DESC, id DESC LIMIT 1",
            &[],
        )?;
        if latest != 0 {
            return Ok(latest);
        }
        self.seed_cycle()
    }

    /// Fail unless a cycle is still running.
    pub(crate) fn check_cycle_open(&self, cycle: &Value) -> Result<()> {
        let Some(id) = cycle.as_i64() else {
            return Ok(());
        };
        let c = self.get(res("cycles"), id)?;
        if !c["ended_on"].is_null() {
            return Err(invalid(format!(
                "{} has ended: its board is kept as it was",
                label(&c)
            )));
        }
        Ok(())
    }

    /// Every cycle, running ones first, with how far its processes got:
    /// on the board (`active`), `archived`, `applied` (past the first
    /// stage), `interviewed` (reached the stage before last) and `offers`
    /// (reached the last).
    pub fn cycles_overview(&self) -> Result<Vec<Record>> {
        let mut cycles = self.list(res("cycles"), None, &[], None)?;
        let stages: Vec<i64> = self
            .query(
                "SELECT id FROM stage WHERE active = 1 ORDER BY position, id",
                &[],
            )?
            .iter()
            .filter_map(|s| s["id"].as_i64())
            .collect();
        let at = |id: Option<i64>| id.and_then(|id| stages.iter().position(|s| *s == id));
        let last = stages.len().saturating_sub(1);
        let interviewing = stages.len().saturating_sub(2).max(1);
        let procs = self.query(
            // A closed one counts at the stage it reached.
            "SELECT id, cycle_id, coalesce(reached_stage_id, stage_id) AS stage_id, status, applied_on FROM process",
            &[],
        )?;
        for c in &mut cycles {
            let mine: Vec<&Record> = procs.iter().filter(|p| p["cycle_id"] == c["id"]).collect();
            let reached = |i: usize| {
                mine.iter()
                    .filter(|p| at(p["stage_id"].as_i64()).is_some_and(|a| a >= i))
                    .count()
            };
            let applied = mine
                .iter()
                .filter(|p| {
                    !p["applied_on"].is_null() || at(p["stage_id"].as_i64()).is_some_and(|a| a >= 1)
                })
                .count();
            let active = mine.iter().filter(|p| p["status"] == "active").count();
            c.insert(
                "counts".into(),
                json!({
                    "active": active,
                    "archived": mine.len() - active,
                    "applied": applied,
                    "interviewed": reached(interviewing),
                    "offers": if stages.is_empty() { 0 } else { reached(last) },
                }),
            );
        }
        Ok(cycles)
    }

    /// Start a cycle, bringing back what was chosen from ended ones.
    pub fn start_cycle(&self, input: &Start) -> Result<Record> {
        self.atomic(|db| {
            let mut fields = Record::new();
            fields.insert("name".into(), Value::from(input.name.clone()));
            if let Some(d) = input.description.as_ref().filter(|d| !d.trim().is_empty()) {
                fields.insert("description".into(), Value::from(d.clone()));
            }
            if let Some(d) = input.started_on.as_ref().filter(|d| !d.is_empty()) {
                fields.insert("started_on".into(), Value::from(d.clone()));
            }
            let cycle = db.create(res("cycles"), &fields)?;
            let id = cycle["id"].as_i64().unwrap_or(0);
            for pid in &input.bring_back {
                let old = db.get(res("processes"), *pid)?;
                let from = db.get(res("cycles"), old["cycle_id"].as_i64().unwrap_or(0))?;
                if from["ended_on"].is_null() {
                    return Err(invalid(format!(
                        "{} is still running: move {} to the new cycle instead",
                        label(&from),
                        label(&old)
                    )));
                }
                let mut p = Record::new();
                p.insert("application_id".into(), old["application_id"].clone());
                p.insert("cycle_id".into(), Value::from(id));
                db.create(res("processes"), &p)?;
            }
            Ok(cycle)
        })
    }

    /// End a running cycle: its board stays as it is. With an offer, the
    /// process it came from moves to the Accepted stage, if there's one, or
    /// the last (its Accepted lane, if it has one). Open reminders for its processes are done, and their
    /// prep closed; general prep stays.
    pub fn end_cycle(&self, id: i64, input: &End) -> Result<Record> {
        self.atomic(|db| {
            let cycle = db.get(res("cycles"), id)?;
            if !cycle["ended_on"].is_null() {
                return Err(invalid(format!("{} has already ended", label(&cycle))));
            }
            // One of offer, break, stopped and other, or in your own words.
            let outcome = input.outcome.trim();
            if outcome.is_empty() {
                return Err(invalid(
                    "How it ended: say which (offer, break, stopped, other), or in your own words",
                ));
            }
            let mut note = crate::resource::option_label(crate::resource::CYCLE_OUTCOMES, outcome)
                .unwrap_or(outcome)
                .to_string();
            if outcome == "offer" {
                note = "Accepted an offer from outside the board".into();
            }
            if let (Some(pid), "offer") = (input.process_id, outcome) {
                let card = db.card(pid)?;
                if card["cycle_id"].as_i64() != Some(id) {
                    return Err(invalid(format!(
                        "{} isn't in {}",
                        card["company"].as_str().unwrap_or("that process"),
                        label(&cycle)
                    )));
                }
                note = match card["title"].as_str().filter(|t| !t.is_empty()) {
                    Some(t) => format!("Accepted {}, {t}", card["company"].as_str().unwrap_or("")),
                    None => format!("Accepted {}", card["company"].as_str().unwrap_or("")),
                };
                // An Accepted stage, if there's one; else the last.
                let last = db.int(
                    "SELECT id FROM stage WHERE active = 1 \
                     ORDER BY lower(name) = 'accepted' DESC, position DESC, id DESC LIMIT 1",
                    &[],
                )?;
                let accepted = db.int(
                    "SELECT id FROM lane WHERE stage_id = ?1 AND lower(name) = 'accepted' LIMIT 1",
                    args![last],
                )?;
                if last != 0 {
                    db.move_process(
                        pid,
                        &crate::service::Move {
                            stage_id: last,
                            lane_id: (accepted != 0).then_some(accepted),
                            index: None,
                            top: false,
                        },
                    )?;
                }
            }
            let now = time::datetime(db.clock());
            let open: Vec<i64> = db
                .query(
                    "SELECT r.id FROM reminder r JOIN process p ON p.id = r.process_id \
                     WHERE p.cycle_id = ?1 AND r.done_at IS NULL",
                    args![id],
                )?
                .iter()
                .filter_map(|r| r["id"].as_i64())
                .collect();
            for r in open {
                db.update(res("reminders"), r, &record(json!({ "done_at": now })))?;
            }
            let prep: Vec<i64> = db
                .query(
                    "SELECT x.id FROM prep_item x JOIN process p ON p.id = x.process_id \
                     WHERE p.cycle_id = ?1 AND x.status IN ('todo', 'doing')",
                    args![id],
                )?
                .iter()
                .filter_map(|r| r["id"].as_i64())
                .collect();
            for x in prep {
                db.update(res("prep"), x, &record(json!({ "status": "closed" })))?;
            }
            let mut end = record(json!({
                "ended_on": time::date(db.clock().date()),
                "outcome": outcome,
                "outcome_note": note,
            }));
            if let Some(name) = input.name.as_ref().filter(|n| !n.trim().is_empty()) {
                end.insert("name".into(), Value::from(name.trim()));
            }
            db.update(res("cycles"), id, &end)
        })
    }

    /// Run an ended cycle again: its board can change once more, as it was
    /// when it ended. Reminders done and prep closed by its ending stay so.
    pub fn resume_cycle(&self, id: i64) -> Result<Record> {
        self.atomic(|db| {
            let cycle = db.get(res("cycles"), id)?;
            if cycle["ended_on"].is_null() {
                return Err(invalid(format!("{} is still running", label(&cycle))));
            }
            db.update(
                res("cycles"),
                id,
                &record(json!({ "ended_on": null, "outcome": null, "outcome_note": null })),
            )
        })
    }

    /// Keep a cycle's dates in order, and an ended one's outcome with it.
    pub(crate) fn check_cycle(
        &self,
        set: &[(&'static str, Value)],
        old: Option<&Record>,
    ) -> Result<()> {
        let get = |n: &str| {
            set.iter()
                .find(|(k, _)| *k == n)
                .map(|(_, v)| v.clone())
                .or_else(|| old.and_then(|o| o.get(n).cloned()))
                .unwrap_or(Value::Null)
        };
        if let (Some(start), Some(end)) = (get("started_on").as_str(), get("ended_on").as_str())
            && end < start
        {
            return Err(invalid(
                "It ends before it starts: pick a later end date, or an earlier start",
            ));
        }
        Ok(())
    }

    /// After importing a backup made before cycles and reminders: its
    /// processes become one cycle's, started when the first was added, and
    /// their next actions reminders. A hunt with no cycle gets one.
    pub(crate) fn settle_import(&self) -> Result<()> {
        let loose = self.query(
            "SELECT id, cycle_id, created_at, updated_at, next_action, next_due FROM process \
             ORDER BY created_at, id",
            &[],
        )?;
        let unplaced: Vec<&Record> = loose.iter().filter(|p| p["cycle_id"].is_null()).collect();
        if let Some(first) = unplaced.first() {
            let at = first["created_at"].as_str().unwrap_or("").to_string();
            let cycle = self.insert(
                "INSERT INTO cycle (name, started_on, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                args!["My job search", at.get(..10).unwrap_or(&at), at],
            )?;
            for p in &unplaced {
                self.exec(
                    "UPDATE process SET cycle_id = ?1 WHERE id = ?2",
                    args![cycle, p["id"].as_i64()],
                )?;
            }
        }
        for p in &loose {
            let what = p["next_action"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            if what.is_none() && p["next_due"].is_null() {
                continue;
            }
            self.insert(
                "INSERT INTO reminder (process_id, title, due_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                args![p["id"].as_i64(), what.unwrap_or("Next action"), p["next_due"].as_str(), p["updated_at"].as_str()],
            )?;
            self.exec(
                "UPDATE process SET next_action = NULL, next_due = NULL WHERE id = ?1",
                args![p["id"].as_i64()],
            )?;
        }
        if self.int("SELECT count(*) FROM cycle", &[])? == 0 {
            self.seed_cycle()?;
        }
        Ok(())
    }

    /// A process can only change while its cycle runs.
    pub(crate) fn check_process_open(&self, old: &Record) -> Result<()> {
        match self.check_cycle_open(&old["cycle_id"]) {
            Err(Error::Invalid(why)) => Err(invalid(format!("{}: {why}", label(old)))),
            r => r,
        }
    }
}

fn record(v: Value) -> Record {
    match v {
        Value::Object(m) => m,
        _ => Record::new(),
    }
}
