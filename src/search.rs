//! Searching everything at once, for the box at the top of every page:
//! applications, companies, people, notes and files, each kind matched by
//! its own search text (as its list is), the best few of each first.

use std::collections::HashMap;

use serde_json::{Value, json};

use crate::args;
use crate::db::{Db, Record};
use crate::error::Result;
use crate::service::res;

/// How many of each kind are shown.
const SHOWN: usize = 5;
/// How many of each kind are read, to choose the best from.
const READ: usize = 40;

/// What's searched: the resource, what the page calls it, and where its records are.
const KINDS: &[(&str, &str)] = &[
    ("applications", "Applications"),
    ("companies", "Companies"),
    ("people", "People"),
    ("memos", "Notes"),
    ("documents", "Files"),
];

/// How well a label matches: starting with the words first, then a word
/// starting with them, then anywhere.
fn rank(label: &str, q: &str) -> u8 {
    let label = label.to_lowercase();
    let first = q.split_whitespace().next().unwrap_or("").to_lowercase();
    if label.starts_with(&q.to_lowercase()) {
        0
    } else if label
        .split(|c: char| !c.is_alphanumeric())
        .any(|w| !first.is_empty() && w.starts_with(&first))
    {
        1
    } else {
        2
    }
}

fn text<'a>(r: &'a Record, key: &str) -> Option<&'a str> {
    r.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
}

impl Db {
    /// What matches `q`, by kind: each kind's best few, how many there are
    /// (as far as was read), and whether there are more. Nothing for an
    /// empty search.
    pub fn search(&self, q: &str) -> Result<Value> {
        let q = q.trim();
        if q.is_empty() {
            return Ok(json!([]));
        }
        let mut groups = Vec::new();
        for (name, title) in KINDS {
            let r = res(name);
            let mut found = self.list(r, Some(q), &[], Some(READ))?;
            if found.is_empty() {
                continue;
            }
            let more = found.len() == READ;
            let count = found.len();
            // Stable: equally good matches stay in the list's own order.
            found
                .sort_by_key(|rec| rank(text(rec, "name").or(text(rec, "label")).unwrap_or(""), q));
            found.truncate(SHOWN);
            let logos = if *name == "applications" {
                self.logos(&found)?
            } else {
                HashMap::new()
            };
            let items: Vec<Value> = found.iter().map(|rec| item(name, rec, &logos)).collect();
            groups.push(json!({ "kind": name, "title": title, "count": count, "more": more, "items": items }));
        }
        Ok(Value::Array(groups))
    }

    /// The logos of applications' companies: (company id → its name and logo).
    fn logos(&self, apps: &[Record]) -> Result<HashMap<i64, (String, Option<String>)>> {
        let mut out = HashMap::new();
        for id in apps
            .iter()
            .filter_map(|a| a.get("company_id").and_then(Value::as_i64))
        {
            if out.contains_key(&id) {
                continue;
            }
            if let Some(row) = self
                .query("SELECT name, logo FROM company WHERE id = ?1", args![id])?
                .pop()
            {
                let name = text(&row, "name").unwrap_or("").to_string();
                out.insert(id, (name, text(&row, "logo").map(str::to_string)));
            }
        }
        Ok(out)
    }
}

/// What's there of some parts, joined by middle dots.
fn dotted(parts: &[Option<&str>]) -> String {
    parts
        .iter()
        .flatten()
        .copied()
        .collect::<Vec<_>>()
        .join(" · ")
}

/// A result: what it is, what it's called, a line about it, and where it is.
fn item(kind: &str, rec: &Record, logos: &HashMap<i64, (String, Option<String>)>) -> Value {
    let id = rec.get("id").and_then(Value::as_i64).unwrap_or(0);
    let label = text(rec, "label").unwrap_or("").to_string();
    match kind {
        "applications" => {
            let company_id = rec.get("company_id").and_then(Value::as_i64);
            let (company, logo) = company_id
                .and_then(|c| logos.get(&c))
                .cloned()
                .unwrap_or_default();
            json!({
                "id": id,
                "label": text(rec, "title").map(str::to_string).unwrap_or_else(|| label.clone()),
                "detail": dotted(&[Some(company.as_str()).filter(|c| !c.is_empty()), text(rec, "location")]),
                "href": format!("/applications/{id}"),
                "company_id": company_id, "logo": logo, "picture": "logo",
            })
        }
        "companies" => json!({
            "id": id, "label": label,
            "detail": text(rec, "industry").or(text(rec, "website")).unwrap_or(""),
            "href": format!("/companies/{id}"),
            "company_id": id, "logo": rec.get("logo"), "picture": "logo",
        }),
        "people" => json!({
            "id": id, "label": text(rec, "name").unwrap_or(&label),
            "detail": dotted(&[text(rec, "title"), label.rsplit_once(" (").map(|(_, c)| c.trim_end_matches(')'))]),
            "href": format!("/people/{id}"),
            "photo": rec.get("photo"), "picture": "photo",
        }),
        "memos" => json!({
            "id": id, "label": label,
            "detail": "",
            "href": format!("/notes?note={id}"),
        }),
        _ => json!({
            "id": id, "label": label,
            "detail": "",
            "kind": text(rec, "kind"),
            "href": format!("/files/{id}"),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::rank;

    #[test]
    fn starting_with_it_ranks_first() {
        assert_eq!(rank("Acme Ltd", "acme"), 0);
        assert_eq!(rank("The Acme Company", "acm"), 1);
        assert_eq!(rank("Megacme", "acme"), 2);
    }
}
