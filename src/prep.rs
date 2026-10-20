//! Prep: what to read, practise and rehearse, for an interview or in
//! general. Ticking off a daily item keeps its streak rather than finishing
//! it; the interviews coming up are what prep gathers around.

use serde_json::{Value, json};

use crate::args;
use crate::db::{Db, Record};
use crate::error::Result;
use crate::service::res;
use crate::time;

/// How many interviews to gather prep around.
const READY: usize = 6;

impl Db {
    /// Tick a prep item off, or back on. A daily one stays to do: its
    /// streak grows by a day (or starts again, after a day missed), and
    /// unticking takes today back off.
    pub fn tick_prep(&self, id: i64, done: bool) -> Result<Record> {
        self.atomic(|db| {
            let item = db.get(res("prep"), id)?;
            if item["repeats"].is_null() {
                let status = if done { "done" } else { "todo" };
                return db.update(res("prep"), id, &one("status", Value::from(status)));
            }
            let today = db.clock().date();
            let yesterday = time::date(today.yesterday().unwrap_or(today));
            let today = time::date(today);
            let last = item["last_done_on"].as_str().map(String::from);
            let streak = item["streak"].as_i64().unwrap_or(0);
            let (streak, last) = match (done, last.as_deref()) {
                (true, Some(d)) if d == today => return Ok(item),
                (true, Some(d)) if d == yesterday => (streak + 1, Some(today)),
                (true, _) => (1, Some(today)),
                (false, Some(d)) if d == today => {
                    let s = (streak - 1).max(0);
                    (s, (s > 0).then_some(yesterday))
                }
                (false, _) => return Ok(item),
            };
            db.exec(
                "UPDATE prep_item SET streak = ?1, last_done_on = ?2, updated_at = ?3 WHERE id = ?4",
                args![streak, last, db.stamp(), id],
            )?;
            db.get(res("prep"), id)
        })
    }

    /// The interviews coming up in running cycles, soonest first, each with
    /// how much of its prep is done.
    pub fn prep_ready(&self) -> Result<Vec<Value>> {
        let today = time::date(self.clock().date());
        let steps = self.query(
            "SELECT st.id, st.title, st.at, st.process_id, a.title AS role, c.name AS company, \
                    c.id AS company_id, c.logo AS company_logo, \
                    (SELECT count(*) FROM prep_item x WHERE x.step_id = st.id AND x.status <> 'closed') AS prep, \
                    (SELECT count(*) FROM prep_item x WHERE x.step_id = st.id AND x.status = 'done') AS prep_done \
             FROM step st JOIN process p ON p.id = st.process_id \
             JOIN application a ON a.id = p.application_id JOIN company c ON c.id = a.company_id \
             WHERE st.status = 'scheduled' AND p.status = 'active' AND st.at >= ?1 \
               AND p.cycle_id IN (SELECT id FROM cycle WHERE ended_on IS NULL) \
             ORDER BY st.at, st.id",
            args![today],
        )?;
        Ok(steps.into_iter().take(READY).map(|s| json!(s)).collect())
    }
}

fn one(k: &str, v: Value) -> Record {
    let mut r = Record::new();
    r.insert(k.into(), v);
    r
}
