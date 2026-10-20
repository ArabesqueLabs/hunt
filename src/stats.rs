//! Numbers about the search, for the Stats page: where processes are and
//! how far they got, how the weeks went, what ended them, which sources work,
//! pay, interviews, and what's gone quiet.
//!
//! Everything is read once and counted here, so the SQL stays plain and the
//! same on every database.

use std::collections::{BTreeMap, HashMap};

use jiff::civil::Date;
use serde_json::{Value, json};

use crate::db::Db;
use crate::error::Result;
use crate::time;

/// How many weeks the weekly charts cover.
const WEEKS: i64 = 16;
/// How many days of activity the activity grid covers.
const ACTIVITY_DAYS: i64 = 182;
/// An active process untouched for this long has gone quiet.
const QUIET_DAYS: i64 = 14;

fn day(s: &str) -> Option<Date> {
    s.get(..10)?.parse().ok()
}

/// The Monday of a date's week.
fn week_of(d: Date) -> Date {
    let back = d.weekday().to_monday_zero_offset() as i64;
    d.checked_sub(jiff::Span::new().days(back)).unwrap_or(d)
}

fn days_between(a: Date, b: Date) -> i64 {
    (b - a).get_days() as i64
}

fn median(mut v: Vec<i64>) -> Option<i64> {
    if v.is_empty() {
        return None;
    }
    v.sort_unstable();
    let n = v.len();
    Some(if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2
    })
}

impl Db {
    /// `cycle`: one cycle's numbers (its id), every cycle's (`all`), or,
    /// without, the running cycles'.
    pub fn stats(&self, cycle: Option<&str>) -> Result<Value> {
        let which = match cycle.filter(|c| !c.is_empty()) {
            Some("all") => "1 = 1".to_string(),
            Some(id) => format!(
                "p.cycle_id = {}",
                id.parse::<i64>()
                    .map_err(|_| crate::error::invalid(format!(
                        "cycle: not a cycle's id: {id:?}"
                    )))?
            ),
            None => "p.cycle_id IN (SELECT id FROM cycle WHERE ended_on IS NULL)".to_string(),
        };
        let today = self.clock().date();
        let s = |r: &crate::db::Record, k: &str| {
            r.get(k).and_then(Value::as_str).unwrap_or("").to_string()
        };
        let n = |r: &crate::db::Record, k: &str| r.get(k).and_then(Value::as_i64);

        // The board's stages; a closed process counts at the one it reached.
        let stages = self.query(
            "SELECT id, name FROM stage WHERE active = 1 ORDER BY position, id",
            &[],
        )?;
        let stage_at: HashMap<i64, usize> = stages
            .iter()
            .enumerate()
            .filter_map(|(i, st)| Some((n(st, "id")?, i)))
            .collect();
        let procs = self.query(
            &format!("SELECT p.id, p.application_id, coalesce(p.reached_stage_id, p.stage_id) AS stage_id, \
                    p.status, p.archive_reason, p.applied_on, \
                    p.created_at, p.updated_at, a.title, a.source, a.work_mode, \
                    a.salary_min_gbp, a.salary_max_gbp, a.pay_period, c.id AS company_id, c.name AS company, \
                    c.logo AS company_logo \
             FROM process p JOIN application a ON a.id = p.application_id JOIN company c ON c.id = a.company_id \
             WHERE {which}"),
            &[],
        )?;
        let steps = self.query(
            &format!("SELECT st.id, st.process_id, st.title, st.at, st.status, a.id AS application_id, a.title AS role, \
                    c.name AS company, c.id AS company_id, c.logo AS company_logo \
             FROM step st JOIN process p ON p.id = st.process_id JOIN application a ON a.id = p.application_id \
             JOIN company c ON c.id = a.company_id WHERE {which}"),
            &[],
        )?;
        let count = |sql: &str| self.int(sql, &[]);

        // ---- headline numbers ----
        let active = procs.iter().filter(|p| s(p, "status") == "active").count();
        let archived = procs.len() - active;
        let week_ago = today
            .checked_sub(jiff::Span::new().days(7))
            .unwrap_or(today);
        let fortnight_ago = today
            .checked_sub(jiff::Span::new().days(14))
            .unwrap_or(today);
        let in_range =
            |d: Option<Date>, from: Date, to: Date| d.is_some_and(|d| d > from && d <= to);
        let added_week = procs
            .iter()
            .filter(|p| in_range(day(&s(p, "created_at")), week_ago, today))
            .count();
        let added_prev = procs
            .iter()
            .filter(|p| in_range(day(&s(p, "created_at")), fortnight_ago, week_ago))
            .count();
        let done = |st: &&crate::db::Record| {
            matches!(
                s(st, "status").as_str(),
                "done" | "completed" | "passed" | "failed"
            )
        };
        let interviews_done = steps.iter().filter(done).count();
        let upcoming: Vec<&crate::db::Record> = {
            let mut v: Vec<_> = steps
                .iter()
                .filter(|st| {
                    s(st, "status") == "scheduled" && day(&s(st, "at")).is_some_and(|d| d >= today)
                })
                .collect();
            v.sort_by_key(|st| s(st, "at"));
            v
        };
        let offers = stages.last().and_then(|st| n(st, "id")).map_or(0, |last| {
            procs
                .iter()
                .filter(|p| n(p, "stage_id") == Some(last))
                .count()
        });

        // ---- how far processes got: each stage, how many reached it ----
        let funnel: Vec<Value> = stages
            .iter()
            .enumerate()
            .map(|(i, st)| {
                let reached = procs
                    .iter()
                    .filter(|p| {
                        n(p, "stage_id")
                            .and_then(|id| stage_at.get(&id))
                            .is_some_and(|at| *at >= i)
                    })
                    .count();
                let now = procs
                    .iter()
                    .filter(|p| s(p, "status") == "active" && n(p, "stage_id") == n(st, "id"))
                    .count();
                json!({ "stage": s(st, "name"), "reached": reached, "now": now })
            })
            .collect();

        // ---- the weeks: added, archived, interviews ----
        let this_week = week_of(today);
        let first_week = this_week
            .checked_sub(jiff::Span::new().weeks(WEEKS - 1))
            .unwrap_or(this_week);
        let mut weeks: BTreeMap<Date, [usize; 3]> = BTreeMap::new();
        let mut w = first_week;
        while w <= this_week {
            weeks.insert(w, [0; 3]);
            w = w
                .checked_add(jiff::Span::new().weeks(1))
                .unwrap_or(this_week.tomorrow().unwrap());
        }
        let mut bump = |d: Option<Date>, i: usize| {
            if let Some(slot) = d.and_then(|d| weeks.get_mut(&week_of(d))) {
                slot[i] += 1;
            }
        };
        for p in &procs {
            bump(day(&s(p, "created_at")), 0);
            if s(p, "status") == "archived" {
                bump(day(&s(p, "updated_at")), 1);
            }
        }
        for st in &steps {
            if done(&st) {
                bump(day(&s(st, "at")), 2);
            }
        }
        let weekly: Vec<Value> = weeks
            .iter()
            .map(|(w, [added, archived, interviews])| {
                json!({ "week": time::date(*w), "added": added, "archived": archived, "interviews": interviews })
            })
            .collect();

        // ---- what ended them ----
        let reasons = self.query(
            &format!(
                "SELECT {} AS value, l.name FROM lane l JOIN stage s ON s.id = l.stage_id \
                 WHERE s.active = 0 ORDER BY s.position, l.position",
                crate::db::LANE_CODE
            ),
            &[],
        )?;
        let mut outcomes: Vec<Value> = reasons
            .iter()
            .map(|r| {
                let v = s(r, "value");
                let c = procs
                    .iter()
                    .filter(|p| s(p, "status") == "archived" && s(p, "archive_reason") == v)
                    .count();
                json!({ "reason": v, "label": s(r, "name"), "count": c })
            })
            .filter(|o| o["count"].as_u64() > Some(0))
            .collect();
        outcomes.sort_by(|a, b| b["count"].as_u64().cmp(&a["count"].as_u64()));

        // ---- sources: how many, and how many got past the first two stages ----
        let mut by_source: BTreeMap<String, (usize, usize)> = BTreeMap::new();
        for p in &procs {
            let src = s(p, "source").trim().to_lowercase();
            let src = if src.is_empty() {
                "unknown".to_string()
            } else {
                src
            };
            let got_far = n(p, "stage_id")
                .and_then(|id| stage_at.get(&id))
                .is_some_and(|at| *at >= 2);
            let e = by_source.entry(src).or_default();
            e.0 += 1;
            e.1 += got_far as usize;
        }
        let mut sources: Vec<Value> = by_source
            .into_iter()
            .map(|(source, (count, progressed))| json!({ "source": source, "count": count, "progressed": progressed }))
            .collect();
        sources.sort_by(|a, b| b["count"].as_u64().cmp(&a["count"].as_u64()));

        // ---- active processes: work modes ----
        let mut modes: BTreeMap<String, usize> = BTreeMap::new();
        for p in procs.iter().filter(|p| s(p, "status") == "active") {
            let m = s(p, "work_mode");
            *modes
                .entry(if m.is_empty() { "unknown".into() } else { m })
                .or_default() += 1;
        }
        let work_modes: Vec<Value> = ["remote", "hybrid", "onsite", "unknown"]
            .iter()
            .map(|m| json!({ "mode": m, "count": modes.get(*m).copied().unwrap_or(0) }))
            .collect();

        // ---- pay, in GBP a year, of active processes ----
        let mut pay: Vec<Value> = procs
            .iter()
            .filter(|p| s(p, "status") == "active" && s(p, "pay_period") == "year")
            .filter(|p| n(p, "salary_min_gbp").is_some() || n(p, "salary_max_gbp").is_some())
            .map(|p| {
                let min = n(p, "salary_min_gbp").or(n(p, "salary_max_gbp"));
                let max = n(p, "salary_max_gbp").or(n(p, "salary_min_gbp"));
                json!({ "application_id": n(p, "application_id"), "process_id": n(p, "id"), "company": s(p, "company"),
                        "title": s(p, "title"), "min": min, "max": max })
            })
            .collect();
        pay.sort_by(|a, b| b["max"].as_i64().cmp(&a["max"].as_i64()));
        let mids: Vec<i64> = pay
            .iter()
            .filter_map(|p| Some((p["min"].as_i64()? + p["max"].as_i64()?) / 2))
            .collect();

        // ---- time ----
        let start =
            |p: &crate::db::Record| day(&s(p, "applied_on")).or_else(|| day(&s(p, "created_at")));
        let open_days: Vec<i64> = procs
            .iter()
            .filter(|p| s(p, "status") == "active")
            .filter_map(|p| Some(days_between(start(p)?, today)))
            .collect();
        let to_close: Vec<i64> = procs
            .iter()
            .filter(|p| s(p, "status") == "archived")
            .filter_map(|p| Some(days_between(start(p)?, day(&s(p, "updated_at"))?)))
            .filter(|d| *d >= 0)
            .collect();
        let mut first_step: HashMap<i64, Date> = HashMap::new();
        for st in &steps {
            if let (Some(pid), Some(d)) = (n(st, "process_id"), day(&s(st, "at"))) {
                first_step
                    .entry(pid)
                    .and_modify(|x| *x = (*x).min(d))
                    .or_insert(d);
            }
        }
        let to_first_step: Vec<i64> = procs
            .iter()
            .filter_map(|p| Some(days_between(start(p)?, *first_step.get(&n(p, "id")?)?)))
            .filter(|d| *d >= 0)
            .collect();

        // ---- gone quiet: active, untouched for a while ----
        let mut quiet: Vec<Value> = procs
            .iter()
            .filter(|p| s(p, "status") == "active")
            .filter_map(|p| {
                let idle = days_between(day(&s(p, "updated_at"))?, today);
                (idle >= QUIET_DAYS).then(|| {
                    json!({ "process_id": n(p, "id"), "application_id": n(p, "application_id"), "company": s(p, "company"),
                            "company_id": n(p, "company_id"), "company_logo": p.get("company_logo"),
                            "title": s(p, "title"), "days": idle,
                            "stage": n(p, "stage_id").and_then(|id| stage_at.get(&id)).map(|i| s(&stages[*i], "name")) })
                })
            })
            .collect();
        quiet.sort_by(|a, b| b["days"].as_i64().cmp(&a["days"].as_i64()));

        // ---- activity, day by day ----
        let since = today
            .checked_sub(jiff::Span::new().days(ACTIVITY_DAYS - 1))
            .unwrap_or(today);
        let mut per_day: BTreeMap<Date, usize> = BTreeMap::new();
        for r in self.query(
            "SELECT at FROM activity WHERE at >= ?1",
            crate::args![time::date(since)],
        )? {
            if let Some(d) = day(&s(&r, "at")) {
                *per_day.entry(d).or_default() += 1;
            }
        }
        let activity: Vec<Value> = per_day
            .iter()
            .map(|(d, c)| json!({ "day": time::date(*d), "count": c }))
            .collect();

        // ---- tags on applications ----
        let tags = self.query(
            "SELECT g.name, count(*) AS count FROM tagging x JOIN tag g ON g.id = x.tag_id \
             WHERE x.entity = 'application' GROUP BY g.name ORDER BY count(*) DESC, g.name LIMIT 12",
            &[],
        )?;

        Ok(json!({
            "today": time::date(today),
            "totals": {
                "applications": count("SELECT count(*) FROM application")?,
                "processes": procs.len(),
                "active": active,
                "archived": archived,
                "offers": offers,
                "companies": count("SELECT count(*) FROM company")?,
                "people": count("SELECT count(*) FROM person")?,
                "interviews_done": interviews_done,
                "interviews_upcoming": upcoming.len(),
                "files_sent": count("SELECT count(*) FROM process_file")?,
                "emails": count("SELECT count(*) FROM email WHERE status = 'linked'")?,
                "added_this_week": added_week,
                "added_last_week": added_prev,
            },
            "funnel": funnel,
            "weekly": weekly,
            "outcomes": outcomes,
            "sources": sources,
            "work_modes": work_modes,
            "pay": pay,
            "pay_median": median(mids),
            "days": {
                "open_median": median(open_days),
                "to_close_median": median(to_close),
                "to_first_step_median": median(to_first_step),
            },
            "quiet": quiet,
            "quiet_after_days": QUIET_DAYS,
            "upcoming": upcoming.iter().take(8).map(|st| json!({
                "process_id": n(st, "process_id"), "application_id": n(st, "application_id"), "title": s(st, "title"),
                "at": s(st, "at"), "company": s(st, "company"), "company_id": n(st, "company_id"),
                "company_logo": st.get("company_logo"), "role": s(st, "role") })).collect::<Vec<_>>(),
            "activity": activity,
            "activity_since": time::date(since),
            "tags": tags,
        }))
    }
}
