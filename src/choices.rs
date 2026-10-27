//! Lists of choices admins can change, for everyone in this hunt: work
//! modes, kinds of employment, an interview step's statuses, formats and
//! lengths, people's roles in an application, and kinds of file. Each
//! starts as hunt's own (see [`crate::resource`]); an admin's list replaces
//! it, kept as a hunt-wide setting (`choices.{key}`, JSON `[[value, label]]`).
//!
//! A value hunt itself relies on (a posting's work mode as it's read, a
//! step's status on the timeline and in Stats) can be renamed and moved,
//! not taken out. Records keep a value taken out of a list since.

use serde_json::{Value, json};

use crate::args;
use crate::db::Db;
use crate::error::{Result, invalid};
use crate::resource;

pub struct List {
    pub key: &'static str,
    /// What Admin calls it.
    pub label: &'static str,
    /// The field it's the choices of, if one: (resource, field).
    pub field: Option<(&'static str, &'static str)>,
    pub defaults: &'static [(&'static str, &'static str)],
    /// Values hunt relies on: renamed, never taken out.
    pub kept: &'static [&'static str],
    /// Offered, not enforced: the field takes other values too.
    pub open: bool,
    /// Its values are whole numbers (minutes).
    pub numeric: bool,
}

/// A step's formats, offered as it's added: the value is the text kept.
pub const STEP_FORMATS: &[(&str, &str)] = &[
    ("Video call", "Video call"),
    ("Phone", "Phone"),
    ("On-site", "On-site"),
    ("Take-home", "Take-home"),
];

/// A step's lengths, in minutes.
pub const STEP_LENGTHS: &[(&str, &str)] = &[
    ("30", "30 min"),
    ("45", "45 min"),
    ("60", "60 min"),
    ("90", "90 min"),
    ("240", "Half a day"),
];

const LIST: List = List {
    key: "",
    label: "",
    field: None,
    defaults: &[],
    kept: &[],
    open: false,
    numeric: false,
};

pub const LISTS: &[List] = &[
    List {
        key: "work_mode",
        label: "Work mode",
        field: Some(("applications", "work_mode")),
        defaults: resource::WORK_MODES,
        kept: &["remote", "hybrid", "onsite"],
        ..LIST
    },
    List {
        key: "employment",
        label: "Employment",
        field: Some(("applications", "employment")),
        defaults: resource::EMPLOYMENT,
        kept: &[
            "full-time",
            "part-time",
            "contract",
            "temporary",
            "internship",
        ],
        ..LIST
    },
    List {
        key: "step_status",
        label: "Interview step status",
        field: Some(("steps", "status")),
        defaults: resource::STEP_STATUSES,
        kept: &[
            "scheduled",
            "done",
            "completed",
            "passed",
            "failed",
            "cancelled",
        ],
        ..LIST
    },
    List {
        key: "step_format",
        label: "Interview step format",
        field: Some(("steps", "format")),
        defaults: STEP_FORMATS,
        open: true,
        ..LIST
    },
    List {
        key: "step_length",
        label: "Interview step length",
        field: Some(("steps", "minutes")),
        defaults: STEP_LENGTHS,
        open: true,
        numeric: true,
        ..LIST
    },
    List {
        key: "person_role",
        label: "People's roles in an application",
        field: None,
        defaults: resource::PERSON_ROLES,
        ..LIST
    },
    List {
        key: "document_kind",
        label: "File kind",
        field: Some(("documents", "kind")),
        defaults: resource::DOCUMENT_KINDS,
        kept: &["resume"],
        ..LIST
    },
];

/// The most a list holds, and the longest label.
const MAX_CHOICES: usize = 60;
const MAX_LABEL: usize = 60;

pub type Choices = Vec<(String, String)>;

pub fn list(key: &str) -> Option<&'static List> {
    LISTS.iter().find(|l| l.key == key)
}

/// The list a field's choices come from, if an admin can change them.
pub fn of_field(resource: &str, field: &str) -> Option<&'static List> {
    LISTS.iter().find(|l| l.field == Some((resource, field)))
}

fn owned(options: &[(&str, &str)]) -> Choices {
    options
        .iter()
        .map(|(v, l)| (v.to_string(), l.to_string()))
        .collect()
}

/// A value made from a label: `Contract to hire` → `contract-to-hire`.
fn slug(label: &str) -> String {
    let mut out = String::new();
    for c in label.trim().to_lowercase().chars() {
        if c.is_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

impl Db {
    /// A list's choices: the admins', or hunt's own.
    pub fn choices(&self, list: &List) -> Result<Choices> {
        let kept = self.text(
            "SELECT value /* all owners */ FROM setting WHERE owner_id = 0 AND name = ?1",
            args![format!("choices.{}", list.key)],
        )?;
        Ok(kept
            .and_then(|s| serde_json::from_str::<Choices>(&s).ok())
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| owned(list.defaults)))
    }

    /// Every list: `{key: {label, open, numeric, kept, changed, choices: [{value, label}]}}`.
    pub fn all_choices(&self) -> Result<Value> {
        let mut out = serde_json::Map::new();
        for l in LISTS {
            let choices = self.choices(l)?;
            out.insert(
                l.key.into(),
                json!({
                    "label": l.label,
                    "open": l.open,
                    "numeric": l.numeric,
                    "kept": l.kept,
                    "changed": choices != owned(l.defaults),
                    "choices": choices.iter().map(|(v, l)| json!({"value": v, "label": l})).collect::<Vec<_>>(),
                }),
            );
        }
        Ok(Value::Object(out))
    }

    /// Change lists: `{key: [{value?, label}] | null}`, null going back to
    /// hunt's own. A new choice's value is made from its label; a value
    /// hunt relies on can't be left out.
    pub fn set_choices(&self, v: &Value) -> Result<Value> {
        let Some(lists) = v.as_object() else {
            return Err(invalid("choices: {list: [{value, label}]}"));
        };
        for (key, given) in lists {
            let l = list(key).ok_or_else(|| {
                invalid(format!(
                    "choices: no list {key:?}; the lists are {}",
                    LISTS.iter().map(|l| l.key).collect::<Vec<_>>().join(", ")
                ))
            })?;
            let name = format!("choices.{key}");
            if given.is_null() {
                self.exec(
                    "DELETE FROM setting /* all owners */ WHERE owner_id = 0 AND name = ?1",
                    args![name],
                )?;
                continue;
            }
            let items = given
                .as_array()
                .ok_or_else(|| invalid(format!("choices.{key}: a list of {{value, label}}")))?;
            let mut choices: Choices = Vec::new();
            for it in items {
                let label = it["label"].as_str().map(str::trim).unwrap_or("");
                if label.is_empty() {
                    return Err(invalid(format!("{}: each choice needs a name", l.label)));
                }
                if label.chars().count() > MAX_LABEL {
                    return Err(invalid(format!(
                        "{}: {label:?} is longer than {MAX_LABEL} characters",
                        l.label
                    )));
                }
                let value = match it["value"]
                    .as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    Some(v) => v.to_string(),
                    None if l.numeric => it["value"]
                        .as_i64()
                        .map(|n| n.to_string())
                        .unwrap_or_default(),
                    // An open list keeps the text itself.
                    None if l.open => label.to_string(),
                    None => slug(label),
                };
                if l.numeric && value.parse::<u32>().map_or(true, |n| n == 0) {
                    return Err(invalid(format!(
                        "{}: {label:?} needs its length in minutes",
                        l.label
                    )));
                }
                if value.is_empty() {
                    return Err(invalid(format!(
                        "{}: {label:?} needs a letter or number in it",
                        l.label
                    )));
                }
                if choices.iter().any(|(v, _)| v.eq_ignore_ascii_case(&value)) {
                    return Err(invalid(format!("{}: {label:?} is there twice", l.label)));
                }
                choices.push((value, label.to_string()));
            }
            if choices.len() > MAX_CHOICES {
                return Err(invalid(format!(
                    "{}: {MAX_CHOICES} choices at most",
                    l.label
                )));
            }
            if let Some(gone) = l.kept.iter().find(|k| choices.iter().all(|(v, _)| v != *k)) {
                let was = resource::option_label(l.defaults, gone).unwrap_or(gone);
                return Err(invalid(format!(
                    "{}: hunt needs {was:?} (rename it, if you like)",
                    l.label
                )));
            }
            let text = serde_json::to_string(&choices).expect("strings");
            if choices == owned(l.defaults) {
                self.exec(
                    "DELETE FROM setting /* all owners */ WHERE owner_id = 0 AND name = ?1",
                    args![name],
                )?;
            } else {
                self.exec(
                    "INSERT INTO setting (owner_id, name, value) /* all owners */ VALUES (0, ?1, ?2) \
                     ON CONFLICT (owner_id, name) DO UPDATE SET value = ?2",
                    args![name, text],
                )?;
            }
        }
        self.all_choices()
    }
}

#[cfg(test)]
mod tests {
    use super::slug;

    #[test]
    fn values_from_labels() {
        assert_eq!(slug("Contract to hire"), "contract-to-hire");
        assert_eq!(slug("  Fixed-term (12 months) "), "fixed-term-12-months");
        assert_eq!(slug("عن بعد"), "عن-بعد");
    }
}
