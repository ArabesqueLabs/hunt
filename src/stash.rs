//! The stash: anything kept to sort later. A link, some text or a file goes
//! in with one gesture, from hunt, the bookmarklet, a phone or the CLI, and
//! nothing about it has to be decided then. Sorting it later makes it into
//! something in hunt (an application, a company, a person, a note, a task,
//! a reminder, a link or a document) or dismisses it.
//!
//! Each item says what it looks like it should become: worked out from its
//! link and text, and from what hunt already has (a posting already
//! tracked, a company's website), with no fetching and no AI. Taking it is
//! one click; anything else is a choice away.

use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::args;
use crate::db::{Db, Record, label};
use crate::error::{Error, Result, invalid};
use crate::files::{File, MAX_FILE};
use crate::lookup::{host_of, normalize_url};
use crate::mail::mentions;
use crate::posting::is_posting;
use crate::resource::STASH_SOURCES;
use crate::service::res;

/// Something to keep: a link, some text, or both. Text that's only a link
/// is kept as the link.
#[derive(Debug, Default, Deserialize)]
pub struct Capture {
    pub url: Option<String>,
    pub title: Option<String>,
    /// A note, or the text selected on a page.
    #[serde(alias = "text")]
    pub body: Option<String>,
    pub source: Option<String>,
}

/// What an item can become, by `to`: the resource it's made as.
const MADE_AS: &[(&str, &str)] = &[
    ("application", "applications"),
    ("company", "companies"),
    ("person", "people"),
    ("memo", "memos"),
    ("note", "notes"),
    ("prep", "prep"),
    ("reminder", "reminders"),
    ("link", "links"),
    ("document", "documents"),
];

fn made_as(entity: &str) -> Option<&'static str> {
    MADE_AS.iter().find(|(e, _)| *e == entity).map(|(_, r)| *r)
}

fn text(v: Option<&str>) -> Option<String> {
    v.map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

/// The one link in some text, when that's all it is.
fn only_link(s: &str) -> Option<String> {
    let s = s.trim();
    let one = !s.is_empty() && !s.contains(char::is_whitespace);
    (one && (s.starts_with("http://") || s.starts_with("https://"))).then(|| s.to_string())
}

/// A LinkedIn profile's or company page's handle: `("in", "dana-lee")`.
fn linkedin_handle(url: &str) -> Option<(String, String)> {
    let host = host_of(&normalize_url(url).ok()?);
    if !host.ends_with("linkedin.com") {
        return None;
    }
    let path = url.split("linkedin.com/").nth(1)?;
    let mut parts = path.split(['/', '?', '#']).filter(|s| !s.is_empty());
    let kind = parts.next()?.to_lowercase();
    let handle = parts.next()?.to_lowercase();
    matches!(kind.as_str(), "in" | "company" | "school").then_some((kind, handle))
}

/// The document kind a file's name suggests.
fn document_kind(filename: &str) -> &'static str {
    let n = filename.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| n.contains(w));
    if has(&["resume", "résumé", "cv"]) {
        "resume"
    } else if has(&["cover"]) {
        "cover-letter"
    } else if has(&["offer"]) {
        "offer"
    } else if has(&["nda", "non-disclosure"]) {
        "nda"
    } else if has(&["contract", "agreement"]) {
        "contract"
    } else if has(&["take-home", "takehome", "assignment", "exercise"]) {
        "assignment"
    } else if has(&["job description", "job-description", "jd"]) {
        "job-description"
    } else if has(&["screenshot", "screen shot"]) || n.ends_with(".png") || n.ends_with(".jpg") {
        "screenshot"
    } else {
        "other"
    }
}

/// A suggestion: what to make, why, and what it's for, if anything.
fn suggestion(to: &str, why: String, target: Option<Value>) -> Value {
    json!({ "to": to, "why": why, "target": target })
}

fn target(entity: &str, r: &Record) -> Value {
    json!({ "entity": entity, "id": r["id"], "label": r["label"] })
}

impl Db {
    fn check_source(source: Option<&str>) -> Result<&str> {
        let s = source.unwrap_or("app");
        if STASH_SOURCES.iter().any(|(v, _)| *v == s) {
            Ok(s)
        } else {
            Err(invalid(format!("a stash item can't come from {s:?}")))
        }
    }

    /// Keep a link or some text in the stash.
    pub fn capture(&self, c: &Capture) -> Result<Record> {
        let source = Db::check_source(c.source.as_deref())?;
        let mut url = text(c.url.as_deref());
        let mut body = text(c.body.as_deref());
        if url.is_none()
            && let Some(link) = body.as_deref().and_then(only_link)
        {
            url = Some(link);
            body = None;
        }
        if url.is_none() && body.is_none() {
            return Err(invalid("give a link or some text to keep"));
        }
        if let Some(u) = &url {
            url = Some(normalize_url(u).map_err(|_| invalid(format!("{u:?} isn't a link")))?);
        }
        let kind = if url.is_some() { "link" } else { "text" };
        self.atomic(|db| {
            let mut rec = Record::new();
            rec.insert("kind".into(), json!(kind));
            rec.insert("url".into(), json!(url));
            rec.insert("title".into(), json!(text(c.title.as_deref())));
            rec.insert("body".into(), json!(body));
            rec.insert("source".into(), json!(source));
            let item = db.create(res("stash"), &rec)?;
            db.suggested(item)
        })
    }

    /// Keep a file in the stash.
    pub fn capture_file(
        &self,
        filename: &str,
        content_type: Option<&str>,
        data: &[u8],
        source: Option<&str>,
    ) -> Result<Record> {
        let source = Db::check_source(source)?;
        let filename = filename.rsplit(['/', '\\']).next().unwrap_or("").trim();
        if filename.is_empty() {
            return Err(invalid("the file needs a name"));
        }
        if data.is_empty() {
            return Err(invalid("the file is empty"));
        }
        if data.len() > MAX_FILE {
            return Err(invalid("that file is too big for hunt"));
        }
        let content_type = content_type
            .filter(|t| !t.is_empty() && *t != "application/octet-stream")
            .map(String::from)
            .unwrap_or_else(|| crate::files::guess_type(filename).to_string());
        let hash = format!("{:x}", Sha256::digest(data));
        self.atomic(|db| {
            db.exec(
                "INSERT OR IGNORE INTO stored_file (sha256, data) VALUES (?1, ?2)",
                args![hash, data],
            )?;
            let mut rec = Record::new();
            rec.insert("kind".into(), json!("file"));
            rec.insert("source".into(), json!(source));
            let item = db.create(res("stash"), &rec)?;
            let id = item["id"].as_i64().unwrap_or(0);
            db.exec(
                "UPDATE stash_item SET filename = ?1, content_type = ?2, file_sha256 = ?3 WHERE id = ?4",
                args![filename, content_type, hash, id],
            )?;
            db.suggested(db.get(res("stash"), id)?)
        })
    }

    /// The stash: what's to sort (`new`), or what was sorted or dismissed,
    /// newest first, each with what it looks like it should become.
    pub fn stash(&self, status: &str) -> Result<Vec<Record>> {
        self.list(
            res("stash"),
            None,
            &[("status".into(), status.into())],
            None,
        )?
        .into_iter()
        .map(|r| self.suggested(r))
        .collect()
    }

    /// How many items wait to be sorted.
    pub fn stash_count(&self) -> Result<i64> {
        self.int("SELECT count(*) FROM stash_item WHERE status = 'new'", &[])
    }

    /// An item with its suggestion, and what it became.
    fn suggested(&self, mut item: Record) -> Result<Record> {
        let s = if item["status"] == "new" {
            self.suggest(&item)?
        } else {
            Value::Null
        };
        item.insert("suggestion".into(), s);
        if let (Some(entity), Some(id)) =
            (item["result_entity"].as_str(), item["result_id"].as_i64())
            && let Some(r) = made_as(entity)
        {
            let result = self.get(res(r), id).ok().map(|rec| target(entity, &rec));
            item.insert("result".into(), json!(result));
        }
        item.remove("file_sha256");
        Ok(item)
    }

    /// What an item looks like it should become.
    pub fn suggest(&self, item: &Record) -> Result<Value> {
        let s = |k: &str| {
            item.get(k)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        };
        match s("kind").as_str() {
            "link" => self.suggest_link(&s("url"), &format!("{} {}", s("title"), s("body"))),
            "file" => self.suggest_file(&s("filename")),
            _ => self.suggest_text(&format!("{} {}", s("title"), s("body"))),
        }
    }

    fn suggest_link(&self, url: &str, words: &str) -> Result<Value> {
        // A posting already tracked, or one to track.
        if let Some(app) = self.same_posting(url)?.into_iter().next() {
            return Ok(suggestion(
                "open",
                "You're already tracking this posting".into(),
                Some(target("application", &app)),
            ));
        }
        if is_posting(url) {
            return Ok(suggestion(
                "application",
                "It looks like a job posting".into(),
                None,
            ));
        }
        // A LinkedIn profile or company page: someone or a company, known or not.
        if let Some((kind, handle)) = linkedin_handle(url) {
            let (entity, table, what) = match kind.as_str() {
                "in" => ("person", "people", "someone's LinkedIn profile"),
                _ => ("company", "companies", "a company's LinkedIn page"),
            };
            let known = self
                .list(res(table), None, &[], None)?
                .into_iter()
                .find(|r| {
                    r["linkedin"]
                        .as_str()
                        .and_then(linkedin_handle)
                        .is_some_and(|(_, h)| h == handle)
                });
            return Ok(match known {
                Some(r) => suggestion(
                    "open",
                    format!("It's {}'s LinkedIn", r["label"].as_str().unwrap_or("")),
                    Some(target(entity, &r)),
                ),
                None => suggestion(entity, format!("It looks like {what}"), None),
            });
        }
        // On a company's own site: a link for its application.
        let host = host_of(url).trim_start_matches("www.").to_string();
        if !host.is_empty() {
            for c in self.list(res("companies"), None, &[], None)? {
                let site = c["website"].as_str().unwrap_or("");
                let site_host = normalize_url(site).map(|u| host_of(&u)).unwrap_or_default();
                let site_host = site_host.trim_start_matches("www.");
                if site_host.is_empty()
                    || !(host == site_host || host.ends_with(&format!(".{site_host}")))
                {
                    continue;
                }
                let name = c["label"].as_str().unwrap_or("").to_string();
                return Ok(
                    match self.newest_application(c["id"].as_i64().unwrap_or(0))? {
                        Some(app) => suggestion(
                            "link",
                            format!("It's on {name}'s website"),
                            Some(target("application", &app)),
                        ),
                        None => suggestion(
                            "open",
                            format!("It's on {name}'s website"),
                            Some(target("company", &c)),
                        ),
                    },
                );
            }
        }
        // Words naming a process's company.
        if let Some(p) = self.process_named(words)? {
            return Ok(suggestion(
                "link",
                format!("It mentions {}", p["company"].as_str().unwrap_or("")),
                Some(
                    json!({ "entity": "application", "id": p["application_id"], "label": p["label"] }),
                ),
            ));
        }
        Ok(suggestion(
            "prep",
            "Something to read or watch".into(),
            None,
        ))
    }

    fn suggest_text(&self, words: &str) -> Result<Value> {
        Ok(match self.process_named(words)? {
            Some(p) => suggestion(
                "note",
                format!("It mentions {}", p["company"].as_str().unwrap_or("")),
                Some(json!({ "entity": "process", "id": p["id"], "label": p["label"] })),
            ),
            None => suggestion("memo", "A note to keep".into(), None),
        })
    }

    fn suggest_file(&self, filename: &str) -> Result<Value> {
        let kind = document_kind(filename);
        let words = filename.replace(['_', '-', '.'], " ");
        let target = self
            .process_named(&words)?
            .map(|p| json!({ "entity": "process", "id": p["id"], "label": p["label"] }));
        let why = match (kind, &target) {
            ("other", None) => "A file to keep".to_string(),
            ("other", Some(t)) => format!("A file for {}", t["label"].as_str().unwrap_or("")),
            (k, _) => {
                let what = crate::resource::DOCUMENT_KINDS
                    .iter()
                    .find(|(v, _)| *v == k)
                    .map(|(_, l)| l.to_lowercase())
                    .unwrap_or_default();
                let a = if what.starts_with(['a', 'e', 'i', 'o', 'u']) {
                    "an"
                } else {
                    "a"
                };
                format!("It looks like {a} {what}")
            }
        };
        let mut s = suggestion("document", why, target);
        s["kind"] = json!(kind);
        Ok(s)
    }

    /// The active process whose company some words name, when only one's does.
    fn process_named(&self, words: &str) -> Result<Option<Record>> {
        if words.trim().is_empty() {
            return Ok(None);
        }
        let mut found: Vec<Record> = self
            .query(
                &format!(
                    "SELECT t.id, t.application_id, c.name AS company, {} AS label FROM process t {} \
                     WHERE t.status = 'active' ORDER BY t.application_id, t.updated_at DESC",
                    res("processes").label_sql,
                    res("processes").joins
                ),
                &[],
            )?
            .into_iter()
            .filter(|p| p["company"].as_str().is_some_and(|c| c.len() > 1 && mentions(words, c)))
            .collect();
        found.dedup_by(|a, b| a["application_id"] == b["application_id"]);
        Ok((found.len() == 1).then(|| found.remove(0)))
    }

    fn newest_application(&self, company_id: i64) -> Result<Option<Record>> {
        Ok(self
            .list(
                res("applications"),
                None,
                &[("company_id".into(), company_id.to_string())],
                None,
            )?
            .into_iter()
            .max_by(|a, b| a["created_at"].as_str().cmp(&b["created_at"].as_str())))
    }

    /// Make an item into something in hunt. `to` is what (see [`MADE_AS`]),
    /// `fields` what it's made with, over what the item gives: the process
    /// for a note or reminder, the application for a link. Applications,
    /// companies and people are made as anything else is, then given to
    /// [`Self::stash_made`].
    pub fn convert_stash(&self, id: i64, to: &str, fields: &Record) -> Result<Record> {
        self.atomic(|db| {
            let item = db.open_item(id)?;
            let s = |k: &str| text(item.get(k).and_then(Value::as_str));
            let given = |k: &str| fields.get(k).filter(|v| !v.is_null()).cloned();
            let title = s("title").or(s("filename"));
            let about = [s("url"), s("body")]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join("\n\n");
            let mut rec = Record::new();
            let mut put = |k: &str, v: Value| {
                rec.insert(k.into(), v);
            };
            let made = match to {
                "memo" => {
                    put("title", json!(title));
                    put("body", json!(about));
                    db.create(res("memos"), &rec)?
                }
                "note" => {
                    put(
                        "process_id",
                        given("process_id")
                            .ok_or_else(|| invalid("a note is on a process: which one?"))?,
                    );
                    let body = match &title {
                        Some(t) if !about.is_empty() => format!("{t}\n\n{about}"),
                        Some(t) => t.clone(),
                        None => about.clone(),
                    };
                    put("body", json!(body));
                    db.create(res("notes"), &rec)?
                }
                "prep" => {
                    put(
                        "title",
                        json!(title.clone().or(s("url")).or(s("body")).unwrap_or_default()),
                    );
                    put("url", json!(s("url")));
                    if s("url").is_some() {
                        put("description", json!(s("body")));
                    }
                    if let Some(p) = given("process_id") {
                        put("process_id", p);
                    }
                    db.create(res("prep"), &rec)?
                }
                "reminder" => {
                    put(
                        "process_id",
                        given("process_id")
                            .ok_or_else(|| invalid("a reminder is for a process: which one?"))?,
                    );
                    put(
                        "title",
                        json!(title.clone().or(s("body")).or(s("url")).unwrap_or_default()),
                    );
                    if let Some(d) = given("due_at") {
                        put("due_at", d);
                    }
                    db.create(res("reminders"), &rec)?
                }
                "link" => {
                    put(
                        "application_id",
                        given("application_id")
                            .ok_or_else(|| invalid("a link is an application's: which one?"))?,
                    );
                    put(
                        "url",
                        json!(s("url").ok_or_else(|| invalid("that item has no link"))?),
                    );
                    put("label", json!(title));
                    put("kind", given("kind").unwrap_or(json!("other")));
                    db.create(res("links"), &rec)?
                }
                "document" => db.stash_document(&item, fields)?,
                other => {
                    return Err(invalid(match made_as(other) {
                        Some(_) => {
                            format!("make the {other} first, then mark the item as made into it")
                        }
                        None => format!("a stash item can't become {other:?}"),
                    }));
                }
            };
            db.sorted(id, to, made["id"].as_i64().unwrap_or(0))
        })
    }

    /// A file item as a new document, with its file as the first version;
    /// with `process_id`, sent with that process too.
    fn stash_document(&self, item: &Record, fields: &Record) -> Result<Record> {
        let id = item["id"].as_i64().unwrap_or(0);
        let row = self
            .rows(
                "SELECT i.filename, i.content_type, b.data FROM stash_item i \
                 JOIN stored_file b ON b.sha256 = i.file_sha256 WHERE i.id = ?1",
                args![id],
            )?
            .pop()
            .ok_or_else(|| invalid("that item has no file"))?;
        let file = crate::files::file_of(row, |n| n.to_string());
        let mut doc = Record::new();
        let name = fields
            .get("name")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(|| {
                file.filename
                    .rsplit_once('.')
                    .map_or(file.filename.as_str(), |(stem, _)| stem)
                    .to_string()
            });
        doc.insert("name".into(), json!(name));
        doc.insert(
            "kind".into(),
            fields
                .get("kind")
                .cloned()
                .unwrap_or_else(|| json!(document_kind(&file.filename))),
        );
        let doc = self.create(res("documents"), &doc)?;
        let doc_id = doc["id"].as_i64().unwrap_or(0);
        let version = self.upload(
            doc_id,
            &crate::files::Upload {
                filename: &file.filename,
                content_type: Some(&file.content_type),
                tag: None,
                note: None,
                data: &file.data,
            },
        )?;
        if let Some(p) = fields.get("process_id").and_then(Value::as_i64) {
            let mut input = Record::new();
            input.insert("version_id".into(), version["id"].clone());
            self.attach(p, &input)?;
        }
        self.get(res("documents"), doc_id)
    }

    /// Mark an item as made into a record made elsewhere (a new
    /// application, company or person, from their own forms).
    pub fn stash_made(&self, id: i64, entity: &str, result_id: i64) -> Result<Record> {
        let r = made_as(entity)
            .ok_or_else(|| invalid(format!("a stash item can't become {entity:?}")))?;
        self.atomic(|db| {
            db.open_item(id)?;
            db.get(res(r), result_id)?;
            db.sorted(id, entity, result_id)
        })
    }

    fn open_item(&self, id: i64) -> Result<Record> {
        let item = self.get(res("stash"), id)?;
        if item["status"] != "new" {
            return Err(Error::Conflict(format!(
                "{} is already sorted",
                label(&item)
            )));
        }
        Ok(item)
    }

    fn sorted(&self, id: i64, entity: &str, result_id: i64) -> Result<Record> {
        let mut patch = Record::new();
        patch.insert("status".into(), json!("done"));
        self.update(res("stash"), id, &patch)?;
        self.exec(
            "UPDATE stash_item SET result_entity = ?1, result_id = ?2, done_at = ?3 WHERE id = ?4",
            args![entity, result_id, self.stamp(), id],
        )?;
        self.suggested(self.get(res("stash"), id)?)
    }

    /// Dismiss an item: kept, out of the way.
    pub fn dismiss_stash(&self, id: i64) -> Result<Record> {
        self.atomic(|db| {
            db.open_item(id)?;
            let mut patch = Record::new();
            patch.insert("status".into(), json!("dismissed"));
            db.update(res("stash"), id, &patch)?;
            db.exec(
                "UPDATE stash_item SET done_at = ?1 WHERE id = ?2",
                args![db.stamp(), id],
            )?;
            db.suggested(db.get(res("stash"), id)?)
        })
    }

    /// Put an item back to sort. With `undo`, what it was made into goes.
    pub fn reopen_stash(&self, id: i64, undo: bool) -> Result<Record> {
        self.atomic(|db| {
            let item = db.get(res("stash"), id)?;
            if undo
                && let (Some(r), Some(rid)) = (
                    item["result_entity"].as_str().and_then(made_as),
                    item["result_id"].as_i64(),
                )
                && db.get(res(r), rid).is_ok()
            {
                db.delete(res(r), rid)?;
            }
            let mut patch = Record::new();
            patch.insert("status".into(), json!("new"));
            db.update(res("stash"), id, &patch)?;
            db.exec(
                "UPDATE stash_item SET result_entity = NULL, result_id = NULL, done_at = NULL WHERE id = ?1",
                args![id],
            )?;
            db.suggested(db.get(res("stash"), id)?)
        })
    }

    /// An item's file.
    pub fn stash_file(&self, id: i64) -> Result<File> {
        self.get(res("stash"), id)?;
        let row = self
            .rows(
                "SELECT i.filename, i.content_type, b.data FROM stash_item i \
                 JOIN stored_file b ON b.sha256 = i.file_sha256 WHERE i.id = ?1",
                args![id],
            )?
            .pop()
            .ok_or_else(|| Error::NotFound(format!("Stash item #{id} has no file")))?;
        Ok(crate::files::file_of(row, |n| n.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_alone_is_a_link() {
        assert_eq!(
            only_link(" https://acme.com/jobs/1 "),
            Some("https://acme.com/jobs/1".into())
        );
        assert_eq!(only_link("see https://acme.com"), None);
        assert_eq!(only_link("acme.com"), None);
    }

    #[test]
    fn linkedin_handles() {
        assert_eq!(
            linkedin_handle("https://www.linkedin.com/in/Dana-Lee/?trk=x"),
            Some(("in".into(), "dana-lee".into()))
        );
        assert_eq!(
            linkedin_handle("linkedin.com/company/acme/about"),
            Some(("company".into(), "acme".into()))
        );
        assert_eq!(linkedin_handle("https://www.linkedin.com/feed/"), None);
        assert_eq!(linkedin_handle("https://acme.com/in/x"), None);
    }

    #[test]
    fn document_kinds_from_names() {
        assert_eq!(document_kind("Dana Lee CV 2026.pdf"), "resume");
        assert_eq!(document_kind("acme-offer-letter.pdf"), "offer");
        assert_eq!(document_kind("Take-home brief.docx"), "assignment");
        assert_eq!(document_kind("notes.txt"), "other");
    }

    #[test]
    fn postings() {
        assert!(is_posting("https://boards.greenhouse.io/acme/jobs/123"));
        assert!(is_posting("https://jobs.ashbyhq.com/acme/abc"));
        assert!(is_posting("https://www.linkedin.com/jobs/view/4012345678/"));
        assert!(is_posting("https://acme.com/careers/staff-engineer"));
        assert!(!is_posting("https://acme.com/careers"));
        assert!(!is_posting("https://www.linkedin.com/in/dana"));
        assert!(!is_posting("https://blog.example.com/a-post"));
    }
}
