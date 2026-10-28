//! Documents and their versions: uploading a version, reading its file
//! back, and recording which versions went with which process.
//!
//! A document's metadata and a version's tag and note are edited through
//! the generic API like everything else. A version itself is only made by
//! uploading a file, and its file never changes. Contents are kept once
//! per distinct file, keyed by SHA-256.

use crate::args;
use crate::db::Sql;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::db::{Db, Record, label};
use crate::error::{Error, Result, invalid};
use crate::service::res;

/// The largest file accepted.
pub const MAX_FILE: usize = 25 * 1024 * 1024;

/// A new version's file and what's known about it.
pub struct Upload<'a> {
    pub filename: &'a str,
    pub content_type: Option<&'a str>,
    pub tag: Option<&'a str>,
    pub note: Option<&'a str>,
    pub data: &'a [u8],
}

/// A version's file, to send back.
pub struct File {
    pub filename: String,
    pub content_type: String,
    pub data: Vec<u8>,
}

impl Db {
    /// Add the next version of a document from an uploaded file.
    pub fn upload(&self, document_id: i64, up: &Upload) -> Result<Record> {
        let filename = up.filename.rsplit(['/', '\\']).next().unwrap_or("").trim();
        if filename.is_empty() {
            return Err(invalid("the file needs a name"));
        }
        if up.data.is_empty() {
            return Err(invalid("the file is empty"));
        }
        if up.data.len() > MAX_FILE {
            return Err(invalid(format!(
                "the file is {}; the most is {}",
                size(up.data.len() as i64),
                size(MAX_FILE as i64)
            )));
        }
        let content_type = up
            .content_type
            .filter(|t| !t.is_empty() && *t != "application/octet-stream")
            .map(String::from)
            .unwrap_or_else(|| guess_type(filename).to_string());
        let hash = format!("{:x}", Sha256::digest(up.data));
        let text = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(String::from);
        self.atomic(|db| {
            let doc = db.get(res("documents"), document_id)?;
            let number = db.int(
                "SELECT coalesce(max(number), 0) + 1 FROM version WHERE document_id = ?1",
                args![document_id],
            )?;
            db.exec(
                "INSERT OR IGNORE INTO stored_file (sha256, data) VALUES (?1, ?2)",
                args![hash, up.data],
            )?;
            let at = db.stamp();
            let id = db.insert(
                "INSERT INTO version (document_id, number, tag, note, filename, content_type, size, \
                 sha256, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                args![
                    document_id,
                    number,
                    text(up.tag),
                    text(up.note),
                    filename,
                    content_type,
                    up.data.len() as i64,
                    hash,
                    at
                ],
            )?;
            let rec = db.get(res("versions"), id)?;
            db.log(
                &at,
                res("versions"),
                &rec,
                "created",
                &format!(
                    "Uploaded {} v{number}: {filename}, {}",
                    label(&doc),
                    size(up.data.len() as i64)
                ),
                Some(json!({ "filename": [null, filename], "sha256": [null, hash] })),
            )?;
            Ok(rec)
        })
    }

    /// A version's file.
    pub fn file(&self, version_id: i64) -> Result<File> {
        let row = self
            .rows(
                "SELECT v.filename, v.content_type, b.data FROM version v \
                 JOIN stored_file b ON b.sha256 = v.sha256 WHERE v.id = ?1",
                args![version_id],
            )?
            .pop()
            .ok_or_else(|| Error::NotFound(format!("no version #{version_id}")))?;
        Ok(file_of(row, |name| name.to_string()))
    }

    /// Versions sent with a process, with their documents' names.
    pub fn process_files(&self, process_id: i64) -> Result<Vec<Record>> {
        self.query(
            "SELECT v.id, v.document_id, v.number, v.tag, v.filename, v.content_type, v.size, \
                    v.created_at, d.name AS document, d.kind, pf.added_at, \
                    d.name || ' v' || v.number || coalesce(' (' || v.tag || ')', '') AS label \
             FROM process_file pf JOIN version v ON v.id = pf.version_id \
             JOIN document d ON d.id = v.document_id \
             WHERE pf.process_id = ?1 ORDER BY pf.added_at, v.id",
            &[Sql::Integer(process_id)],
        )
    }

    /// The processes a version was sent with.
    pub fn version_uses(&self, version_id: i64) -> Result<Vec<Record>> {
        self.query(
            "SELECT p.id, p.status, pf.added_at, \
                    c.name || CASE WHEN coalesce(a.title, '') <> '' THEN ' — ' || a.title ELSE '' END AS label \
             FROM process_file pf JOIN process p ON p.id = pf.process_id \
             JOIN application a ON a.id = p.application_id JOIN company c ON c.id = a.company_id \
             WHERE pf.version_id = ?1 ORDER BY pf.added_at",
            &[Sql::Integer(version_id)],
        )
    }

    /// Record that a version went with a process. Give `version_id`, or
    /// `document_id` for its latest version.
    pub fn attach(&self, process_id: i64, input: &Record) -> Result<Vec<Record>> {
        let id = |k: &str| {
            input
                .get(k)
                .and_then(|v| v.as_i64().or_else(|| v.as_str()?.parse().ok()))
        };
        self.atomic(|db| {
            let process = db.get(res("processes"), process_id)?;
            let version_id = match (id("version_id"), id("document_id")) {
                (Some(v), _) => db.get(res("versions"), v)?["id"].as_i64().unwrap_or(v),
                (None, Some(d)) => {
                    let doc = db.get(res("documents"), d)?;
                    match db.int(
                        "SELECT id FROM version WHERE document_id = ?1 ORDER BY number DESC LIMIT 1",
                        args![d],
                    )? {
                        0 => return Err(invalid(format!("{} has no versions yet", label(&doc)))),
                        v => v,
                    }
                }
                (None, None) => return Err(invalid("which file? give version_id or document_id")),
            };
            db.exec(
                "INSERT INTO process_file (process_id, version_id, added_at) VALUES (?1, ?2, ?3)",
                args![process_id, version_id, db.stamp()],
            )
            .map_err(|e| match e {
                Error::Constraint { .. } => Error::Conflict("that version is already on this process".into()),
                e => e,
            })?;
            let what = db.label_of("versions", &Value::from(version_id));
            db.log(
                &db.stamp(),
                res("processes"),
                &process,
                "updated",
                &format!("Sent {what} with {}", label(&process)),
                Some(json!({ "files": [null, version_id] })),
            )?;
            db.process_files(process_id)
        })
    }

    pub fn detach(&self, process_id: i64, version_id: i64) -> Result<Vec<Record>> {
        self.atomic(|db| {
            let process = db.get(res("processes"), process_id)?;
            let n = db.exec(
                "DELETE FROM process_file WHERE process_id = ?1 AND version_id = ?2",
                args![process_id, version_id],
            )?;
            if n == 0 {
                return Err(Error::NotFound("that version isn't on this process".into()));
            }
            let what = db.label_of("versions", &Value::from(version_id));
            db.log(
                &db.stamp(),
                res("processes"),
                &process,
                "updated",
                &format!("Took {what} off {}", label(&process)),
                Some(json!({ "files": [version_id, null] })),
            )?;
            db.process_files(process_id)
        })
    }
}

// --- pictures: company logos and people's photos ---------------------------------

/// Where a kind of picture is kept: a company's logo, a person's photo.
#[derive(Clone, Copy)]
pub enum Picture {
    Logo,
    Photo,
}

impl Picture {
    fn parts(self) -> (&'static str, &'static str, &'static str, &'static str) {
        // (resource, table, column, what it's called)
        match self {
            Picture::Logo => ("companies", "company", "logo", "logo"),
            Picture::Photo => ("people", "person", "photo", "photo"),
        }
    }
}

impl Db {
    /// Set a company's logo from an image: uploaded, or fetched from where
    /// its website or a posting said. The image is kept like any file.
    pub fn set_logo(&self, company_id: i64, data: &[u8], declared: &str) -> Result<Record> {
        self.set_picture(Picture::Logo, company_id, data, declared)
    }

    pub fn remove_logo(&self, company_id: i64) -> Result<Record> {
        self.remove_picture(Picture::Logo, company_id)
    }

    /// A company's logo image.
    pub fn logo(&self, company_id: i64) -> Result<File> {
        self.picture(Picture::Logo, company_id)
    }

    /// Set a picture (a logo or a photo) from an image's bytes, checked by
    /// what's in them.
    pub fn set_picture(
        &self,
        kind: Picture,
        id: i64,
        data: &[u8],
        declared: &str,
    ) -> Result<Record> {
        let (resource, table, column, noun) = kind.parts();
        if data.len() > crate::lookup::MAX_IMAGE {
            return Err(invalid(format!(
                "a {noun} can be at most {}",
                size(crate::lookup::MAX_IMAGE as i64)
            )));
        }
        let mime = image_type(data, declared)
            .ok_or_else(|| invalid("that isn't an image: use PNG, JPEG, GIF, WebP, SVG or ICO"))?;
        let hash = format!("{:x}", Sha256::digest(data));
        self.atomic(|db| {
            let r = res(resource);
            let before = db.get(r, id)?;
            db.exec(
                "INSERT OR IGNORE INTO stored_file (sha256, data) VALUES (?1, ?2)",
                args![hash, data],
            )?;
            let at = db.stamp();
            db.exec(
                &format!("UPDATE {table} SET {column} = ?1, {column}_type = ?2, updated_at = ?3 WHERE id = ?4"),
                args![hash, mime, at, id],
            )?;
            db.prune_blobs()?;
            let rec = db.get(r, id)?;
            db.log(
                &at,
                r,
                &rec,
                "updated",
                &format!(
                    "{} the {noun} of {} {}",
                    if before[column].is_null() { "Added" } else { "Changed" },
                    r.entity,
                    label(&rec)
                ),
                Some(json!({ column: [before[column], hash] })),
            )?;
            Ok(rec)
        })
    }

    pub fn remove_picture(&self, kind: Picture, id: i64) -> Result<Record> {
        let (resource, table, column, noun) = kind.parts();
        self.atomic(|db| {
            let r = res(resource);
            let before = db.get(r, id)?;
            if before[column].is_null() {
                return Ok(before);
            }
            let at = db.stamp();
            db.exec(
                &format!("UPDATE {table} SET {column} = NULL, {column}_type = NULL, updated_at = ?1 WHERE id = ?2"),
                args![at, id],
            )?;
            db.prune_blobs()?;
            let rec = db.get(r, id)?;
            db.log(
                &at,
                r,
                &rec,
                "updated",
                &format!("Removed the {noun} of {} {}", r.entity, label(&rec)),
                Some(json!({ column: [before[column], null] })),
            )?;
            Ok(rec)
        })
    }

    /// A picture's image.
    pub fn picture(&self, kind: Picture, id: i64) -> Result<File> {
        let (_, table, column, noun) = kind.parts();
        let row = self
            .rows(
                &format!(
                    "SELECT t.name, t.{column}_type, b.data FROM {table} t \
                     JOIN stored_file b ON b.sha256 = t.{column} WHERE t.id = ?1"
                ),
                args![id],
            )?
            .pop()
            .ok_or_else(|| Error::NotFound(format!("{table} #{id} has no {noun}")))?;
        Ok(file_of(row, |name| format!("{name}-{noun}")))
    }
}

/// A file from a row of (name, content type, contents).
pub(crate) fn file_of(row: crate::store::Row, name: impl Fn(&str) -> String) -> File {
    let mut values = row.into_iter().map(|(_, v)| v);
    let text = |v: Option<Sql>| match v {
        Some(Sql::Text(t)) => t,
        _ => String::new(),
    };
    let filename = name(&text(values.next()));
    let content_type = text(values.next());
    let data = match values.next() {
        Some(Sql::Blob(b)) => b,
        Some(Sql::Text(t)) => t.into_bytes(),
        _ => Vec::new(),
    };
    File {
        filename,
        content_type,
        data,
    }
}

/// What kind of image some bytes are, from the bytes themselves; `declared`
/// (a content type) only settles SVG, which is text.
pub fn image_type(data: &[u8], declared: &str) -> Option<&'static str> {
    let starts = |magic: &[u8]| data.starts_with(magic);
    if starts(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if starts(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if starts(b"GIF87a") || starts(b"GIF89a") {
        Some("image/gif")
    } else if data.len() > 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        Some("image/webp")
    } else if starts(&[0, 0, 1, 0]) {
        Some("image/x-icon")
    } else {
        let head = String::from_utf8_lossy(&data[..data.len().min(1024)]).to_lowercase();
        (head.contains("<svg") || (declared.contains("svg") && head.trim_start().starts_with('<')))
            .then_some("image/svg+xml")
    }
}

/// A byte count for people: 820 B, 14 KB, 2.3 MB.
pub fn size(n: i64) -> String {
    match n {
        n if n < 1024 => format!("{n} B"),
        n if n < 1024 * 1024 => format!("{} KB", (n + 512) / 1024),
        n => format!("{:.1} MB", n as f64 / (1024.0 * 1024.0)),
    }
}

pub(crate) fn guess_type(filename: &str) -> &'static str {
    let ext = filename
        .rsplit_once('.')
        .map(|(_, e)| e.to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "odt" => "application/vnd.oasis.opendocument.text",
        "txt" => "text/plain; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "csv" => "text/csv; charset=utf-8",
        "json" => "application/json",
        "jpg" | "jpeg" => "image/jpeg",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes() {
        assert_eq!(size(820), "820 B");
        assert_eq!(size(14_000), "14 KB");
        assert_eq!(size(2_400_000), "2.3 MB");
    }
}
