//! What each kind of record is made of. The generic create/read/update/delete
//! in [`crate::db`] works from these, and `GET /api/meta` serves them so the
//! web UI can build an edit form for anything.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum FieldKind {
    Text,
    /// Several lines: a textarea.
    LongText,
    Url,
    Email,
    Date,
    DateTime,
    Enum {
        options: &'static [(&'static str, &'static str)],
    },
    /// A whole number.
    Number,
    /// A reason for closing: the code of a lane of an inactive stage (its
    /// `value`, or one from its id), given by code or name.
    Choice {
        resource: &'static str,
    },
    /// The id of another record, by its resource name.
    Ref {
        resource: &'static str,
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Field {
    pub name: &'static str,
    pub label: &'static str,
    #[serde(flatten)]
    pub kind: FieldKind,
    /// Can't be empty.
    pub required: bool,
    /// The database fills it in when a create leaves it out.
    pub defaulted: bool,
    /// Offer earlier values as suggestions (e.g. lead sources).
    pub suggest: bool,
    /// Set when the record is made, fixed after.
    pub readonly: bool,
    /// An example of what goes in it, for an empty field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<&'static str>,
    /// Fields shown together under one heading (e.g. "Salary").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<&'static str>,
    /// The label inside its group: "From" under "Salary".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short: Option<&'static str>,
}

const fn field(name: &'static str, label: &'static str, kind: FieldKind) -> Field {
    Field {
        name,
        label,
        kind,
        required: false,
        defaulted: false,
        suggest: false,
        readonly: false,
        placeholder: None,
        group: None,
        short: None,
    }
}

const fn hint(f: Field, text: &'static str) -> Field {
    Field {
        placeholder: Some(text),
        ..f
    }
}

const fn grouped(f: Field, group: &'static str, short: &'static str) -> Field {
    Field {
        group: Some(group),
        short: Some(short),
        ..f
    }
}

const fn required(f: Field) -> Field {
    Field {
        required: true,
        ..f
    }
}

const fn defaulted(f: Field) -> Field {
    Field {
        required: true,
        defaulted: true,
        ..f
    }
}

const fn suggest(f: Field) -> Field {
    Field { suggest: true, ..f }
}

const fn readonly(f: Field) -> Field {
    Field {
        readonly: true,
        ..f
    }
}

use FieldKind::*;

#[derive(Debug, Serialize)]
pub struct Resource {
    /// The API path segment: `companies`.
    pub name: &'static str,
    /// The singular, as the activity log names it: `company`.
    pub entity: &'static str,
    pub title: &'static str,
    pub fields: &'static [Field],
    #[serde(skip)]
    pub table: &'static str,
    /// SQL for a one-line name of a record; the table is `t`.
    #[serde(skip)]
    pub label_sql: &'static str,
    /// Joins `label_sql` and `search_sql` need.
    #[serde(skip)]
    pub joins: &'static str,
    #[serde(skip)]
    pub search_sql: &'static str,
    #[serde(skip)]
    pub order_sql: &'static str,
    /// SQL for the process a record's changes belong to, if any.
    #[serde(skip)]
    pub process_sql: Option<&'static str>,
    /// Can carry tags.
    pub taggable: bool,
}

impl Resource {
    pub fn field(&self, name: &str) -> Option<&'static Field> {
        self.fields.iter().find(|f| f.name == name)
    }
}

pub const WORK_MODES: &[(&str, &str)] = &[
    ("remote", "Remote"),
    ("hybrid", "Hybrid"),
    ("onsite", "On-site"),
];

pub const EMPLOYMENT: &[(&str, &str)] = &[
    ("full-time", "Full-time"),
    ("part-time", "Part-time"),
    ("contract", "Contract"),
    ("temporary", "Temporary"),
    ("internship", "Internship"),
];

pub const PAY_PERIODS: &[(&str, &str)] = &[
    ("year", "a year"),
    ("month", "a month"),
    ("day", "a day"),
    ("hour", "an hour"),
];

pub const STATUSES: &[(&str, &str)] = &[("active", "Active"), ("archived", "Closed")];

/// A new hunt's inactive stages, after the board's: a process moved to one
/// is closed, and its lane (one of [`ARCHIVE_REASONS`]) says why.
pub const CLOSED_STAGES: &[&str] = &["My Decision", "Their Decision", "Paused / Stopped"];

/// A new hunt's closing reasons, the lanes of its inactive stages (by
/// [`CLOSED_STAGES`] index; edited in Settings after, as lanes): every way an
/// application can end (the job-seeker FSM's terminal states), and a pause.
/// Starting the job is the success; accepting an offer isn't an ending (it
/// waits in the Offer stage's Accepted lane).
pub const ARCHIVE_REASONS: &[(&str, &str, usize)] = &[
    ("withdrew", "I withdrew", 0),
    ("declined", "I declined the offer", 0),
    ("reneged", "I backed out after accepting", 0),
    ("accepted", "I started the job", 0),
    ("rejected", "They rejected me", 1),
    ("role-filled", "Role filled", 1),
    ("role-closed", "Role cancelled", 1),
    ("rescinded", "They withdrew the offer", 1),
    (
        "failed-checks",
        "Didn't clear checks (references, background, visa)",
        1,
    ),
    ("paused", "On hold", 2),
    ("no-response", "They went silent (ghosted)", 2),
    ("offer-expired", "The offer expired", 2),
    ("other", "Other", 2),
];

pub const STEP_STATUSES: &[(&str, &str)] = &[
    ("scheduled", "Scheduled"),
    ("done", "Done, waiting"),
    ("completed", "Done"),
    ("passed", "Passed"),
    ("failed", "Failed"),
    ("cancelled", "Cancelled"),
];

pub const PERSON_ROLES: &[(&str, &str)] = &[
    ("recruiter", "Recruiter"),
    ("hiring-manager", "Hiring manager"),
    ("interviewer", "Interviewer"),
    ("referrer", "Referrer"),
    ("other", "Other"),
];

pub const COMPANY_KINDS: &[(&str, &str)] =
    &[("employer", "Employer"), ("agency", "Recruitment agency")];

pub const DOCUMENT_KINDS: &[(&str, &str)] = &[
    ("resume", "Resume"),
    ("cover-letter", "Cover letter"),
    ("portfolio", "Portfolio"),
    ("reference", "Reference"),
    ("certificate", "Certificate or transcript"),
    ("screenshot", "Screenshot"),
    ("job-description", "Job description"),
    ("assignment", "Take-home assignment"),
    ("offer", "Offer"),
    ("contract", "Contract"),
    ("nda", "NDA"),
    ("background-check", "Background check"),
    ("right-to-work", "Right to work or ID"),
    ("candidate-resource", "Candidate resource"),
    ("feedback", "Feedback"),
    ("other", "Other"),
];

const APPLICATION_LABEL: &str = "c.name || CASE WHEN coalesce(t.title, '') <> '' THEN ' — ' || t.title ELSE '' END \
     || CASE WHEN coalesce(t.reference, '') <> '' THEN ' · ' || t.reference ELSE '' END";
const PROCESS_LABEL: &str = "c.name || CASE WHEN coalesce(a.title, '') <> '' THEN ' — ' || a.title ELSE '' END \
     || CASE WHEN coalesce(a.reference, '') <> '' THEN ' · ' || a.reference ELSE '' END";

pub static RESOURCES: &[Resource] = &[
    Resource {
        name: "swimlanes",
        entity: "swimlane",
        title: "Swimlanes",
        table: "swimlane",
        fields: &[
            required(hint(
                field("name", "Swimlane", Text),
                "e.g. Active Processes",
            )),
            // 1: folded to its heading on the board, until opened; 0: open.
            defaulted(field("folded", "Folded", Number)),
        ],
        label_sql: "t.name",
        joins: "",
        search_sql: "t.name",
        order_sql: "t.position, t.id",
        process_sql: None,
        taggable: false,
    },
    Resource {
        name: "stages",
        entity: "stage",
        title: "Stages",
        table: "stage",
        fields: &[
            required(field("name", "Name", Text)),
            // 1: a column on the board; 0: inactive, its processes closed.
            defaulted(field("active", "Active", Number)),
            // 1: its cards folded into packs, until unfolded; 0: all shown.
            defaulted(field("folded", "Folded", Number)),
            // Its icon on an application's timeline, by name; none, a plain marker.
            field("icon", "Icon", Text),
            // The board's row it's in; none, the first.
            field(
                "swimlane_id",
                "Swimlane",
                Ref {
                    resource: "swimlanes",
                },
            ),
        ],
        label_sql: "t.name",
        joins: "",
        search_sql: "t.name",
        order_sql: "t.position, t.id",
        process_sql: None,
        taggable: false,
    },
    Resource {
        name: "lanes",
        entity: "lane",
        title: "Sub stages",
        table: "lane",
        fields: &[
            required(readonly(field(
                "stage_id",
                "Stage",
                Ref { resource: "stages" },
            ))),
            required(hint(field("name", "Sub stage", Text), "e.g. Accepted")),
            // hunt's code for what it stands for, as a reason for closing
            // (rejected, accepted …); none for a lane added since.
            readonly(field("value", "Code", Text)),
            // 1: its cards folded into a pack, until unfolded; 0: all shown;
            // none: as its stage's.
            field("folded", "Folded", Number),
            // 1: its stage's default, where a process going into the stage
            // goes when no lane is said (one a stage, at most).
            defaulted(field("is_default", "Default", Number)),
        ],
        label_sql: "t.name",
        joins: "",
        search_sql: "t.name",
        order_sql: "t.stage_id, t.position, t.id",
        process_sql: None,
        taggable: false,
    },
    Resource {
        name: "companies",
        entity: "company",
        title: "Companies",
        table: "company",
        fields: &[
            required(field("name", "Name", Text)),
            defaulted(field(
                "kind",
                "Kind",
                Enum {
                    options: COMPANY_KINDS,
                },
            )),
            hint(field("website", "Website", Url), "https://acme.com"),
            hint(
                field("linkedin", "LinkedIn", Url),
                "https://www.linkedin.com/company/acme",
            ),
            hint(
                suggest(field("industry", "Industry", Text)),
                "e.g. Software Development",
            ),
            hint(field("size", "Size", Text), "e.g. 51–200 employees"),
            hint(
                suggest(field("headquarters", "Headquarters", Text)),
                "e.g. London, UK",
            ),
            hint(field("founded", "Founded", Text), "e.g. 2015"),
            field("description", "About", LongText),
            hint(
                field("email_domains", "Email domains", Text),
                "e.g. acme.io, acmecorp.com (the website's is used too)",
            ),
            field("note", "Note", LongText),
        ],
        label_sql: "t.name",
        joins: "",
        search_sql: "t.name",
        order_sql: "t.name COLLATE NOCASE",
        process_sql: None,
        taggable: true,
    },
    Resource {
        name: "people",
        entity: "person",
        title: "People",
        table: "person",
        fields: &[
            required(field("name", "Name", Text)),
            field(
                "company_id",
                "Company",
                Ref {
                    resource: "companies",
                },
            ),
            hint(
                field("title", "Job title", Text),
                "e.g. Technical Recruiter",
            ),
            hint(
                field("linkedin", "LinkedIn", Url),
                "https://www.linkedin.com/in/…",
            ),
            hint(field("email", "Email", Email), "name@acme.com"),
            field("phone", "Phone", Text),
            hint(
                suggest(field("location", "Location", Text)),
                "e.g. London, UK",
            ),
            hint(
                field("link", "Other link", Url),
                "a website, GitHub, a talk…",
            ),
            field("about", "About", LongText),
            field("note", "Note", LongText),
        ],
        label_sql: "t.name || coalesce(' (' || c.name || ')', '')",
        joins: "LEFT JOIN company c ON c.id = t.company_id",
        search_sql: "t.name || ' ' || coalesce(c.name, '')",
        order_sql: "t.name COLLATE NOCASE",
        process_sql: None,
        taggable: true,
    },
    Resource {
        name: "applications",
        entity: "application",
        title: "Applications",
        table: "application",
        fields: &[
            required(field(
                "company_id",
                "Company",
                Ref {
                    resource: "companies",
                },
            )),
            hint(
                field("title", "Role", Text),
                "e.g. Senior Platform Engineer",
            ),
            hint(
                suggest(field("source", "Source", Text)),
                "referral, LinkedIn, recruiter…",
            ),
            hint(field("url", "Posting URL", Url), "https://…"),
            field("url_label", "Posting link name", Text),
            // The employer's own name for the role: tells same-titled ones apart.
            hint(field("reference", "Role ID", Text), "Req-1234, JR0042…"),
            hint(
                suggest(field("location", "Location", Text)),
                "City, or Remote",
            ),
            field(
                "work_mode",
                "Work mode",
                Enum {
                    options: WORK_MODES,
                },
            ),
            field(
                "employment",
                "Employment",
                Enum {
                    options: EMPLOYMENT,
                },
            ),
            grouped(
                hint(field("salary_min", "Salary from", Number), "e.g. 150k"),
                "Salary",
                "From",
            ),
            grouped(
                hint(field("salary_max", "Salary to", Number), "e.g. 180k"),
                "Salary",
                "To",
            ),
            grouped(
                hint(suggest(field("currency", "Currency", Text)), "GBP"),
                "Salary",
                "Currency",
            ),
            grouped(
                field(
                    "pay_period",
                    "Paid",
                    Enum {
                        options: PAY_PERIODS,
                    },
                ),
                "Salary",
                "Per",
            ),
            hint(field("bonus", "Bonus", Text), "e.g. 15% target"),
            hint(
                field("equity", "Equity", Text),
                "e.g. £200k RSUs over 4 years",
            ),
            hint(
                field("comp", "Pay notes", LongText),
                "Benefits, negotiation…",
            ),
            grouped(field("posted_on", "Posted on", Date), "Dates", "Posted"),
            grouped(
                field("closes_on", "Applications close", Date),
                "Dates",
                "Applications close",
            ),
            field(
                "via_id",
                "Came through",
                Ref {
                    resource: "applications",
                },
            ),
            field("description", "Posting text", LongText),
            field("note", "Note", LongText),
        ],
        label_sql: APPLICATION_LABEL,
        joins: "JOIN company c ON c.id = t.company_id",
        search_sql: "c.name || ' ' || coalesce(t.title, '') || ' ' || coalesce(t.reference, '')",
        order_sql: "t.created_at DESC, t.id DESC",
        process_sql: None,
        taggable: true,
    },
    Resource {
        name: "processes",
        entity: "process",
        title: "Processes",
        table: "process",
        fields: &[
            required(readonly(field(
                "application_id",
                "Application",
                Ref {
                    resource: "applications",
                },
            ))),
            defaulted(field("stage_id", "Stage", Ref { resource: "stages" })),
            // One of its stage's lanes, when the column is divided.
            field("lane_id", "Sub stage", Ref { resource: "lanes" }),
            defaulted(field("status", "Status", Enum { options: STATUSES })),
            // Kept from its stage and lane: closed (archived) in an inactive
            // stage, its lane's code being why. Saying either closes or
            // reopens it (see Db::settle_process).
            field(
                "archive_reason",
                "Why it's closed",
                Choice { resource: "lanes" },
            ),
            field("archive_note", "Closing note", Text),
            // The last active stage it was in: how far a closed one got.
            readonly(field(
                "reached_stage_id",
                "Got to",
                Ref { resource: "stages" },
            )),
            // The cycle (job search) it's part of: the latest running one
            // unless it says.
            defaulted(field("cycle_id", "Cycle", Ref { resource: "cycles" })),
            field("applied_on", "Applied on", Date),
            field("note", "Note", LongText),
            hint(
                field("mail_query", "Gmail search", Text),
                "Leave empty to use the one hunt builds",
            ),
        ],
        label_sql: PROCESS_LABEL,
        joins: "JOIN application a ON a.id = t.application_id JOIN company c ON c.id = a.company_id",
        search_sql: "c.name || ' ' || coalesce(a.title, '') || ' ' || coalesce(a.reference, '')",
        order_sql: "t.position, t.id",
        process_sql: Some("t.id"),
        taggable: false,
    },
    Resource {
        name: "postings",
        entity: "posting",
        title: "Postings",
        table: "posting",
        fields: &[
            required(readonly(field(
                "application_id",
                "Application",
                Ref {
                    resource: "applications",
                },
            ))),
            required(hint(
                field("url", "Link", Url),
                "https://www.linkedin.com/jobs/view/…",
            )),
            field("label", "Name", Text),
            field("platform", "Where", Text),
            hint(field("reference", "Role ID", Text), "Its ID on that site"),
            field("description", "Posting text", LongText),
            field("read_at", "Last read", DateTime),
        ],
        label_sql: "t.url",
        joins: "",
        search_sql: "t.url || ' ' || coalesce(t.reference, '') || ' ' || coalesce(t.description, '')",
        order_sql: "t.created_at, t.id",
        process_sql: None,
        taggable: false,
    },
    Resource {
        name: "steps",
        entity: "step",
        title: "Interview steps",
        table: "step",
        fields: &[
            required(readonly(field(
                "process_id",
                "Process",
                Ref {
                    resource: "processes",
                },
            ))),
            required(hint(
                field("title", "Step", Text),
                "e.g. System design interview",
            )),
            field("at", "When", DateTime),
            defaulted(field(
                "status",
                "Status",
                Enum {
                    options: STEP_STATUSES,
                },
            )),
            hint(field("format", "Format", Text), "e.g. video call, on-site"),
            hint(
                field("attendees", "With", Text),
                "e.g. Sam Lee, hiring manager",
            ),
            hint(field("minutes", "Length (minutes)", Number), "e.g. 45"),
            hint(
                field("place", "Joining link or address", Text),
                "meet.example/… or an office address",
            ),
            hint(
                field("prep_note", "What to prepare", LongText),
                "Topics they mentioned, things to bring",
            ),
            field(
                "remind",
                "Remind me",
                Enum {
                    options: STEP_REMINDERS,
                },
            ),
            field("note", "Note", LongText),
        ],
        label_sql: "t.title",
        joins: "",
        search_sql: "t.title",
        order_sql: "coalesce(t.at, t.created_at), t.id",
        process_sql: Some("t.process_id"),
        taggable: false,
    },
    Resource {
        name: "notes",
        entity: "note",
        title: "Notes",
        table: "note",
        fields: &[
            required(readonly(field(
                "process_id",
                "Process",
                Ref {
                    resource: "processes",
                },
            ))),
            required(field("body", "Note", LongText)),
            field("happened_on", "On", Date),
        ],
        // Made plain, and cut to 60 characters, by Db::list.
        label_sql: "substr(t.body, 1, 400)",
        joins: "",
        search_sql: "t.body",
        order_sql: "t.created_at DESC, t.id DESC",
        process_sql: Some("t.process_id"),
        taggable: false,
    },
    Resource {
        name: "documents",
        entity: "document",
        title: "Files",
        table: "document",
        fields: &[
            required(field("name", "Name", Text)),
            defaulted(field(
                "kind",
                "Kind",
                Enum {
                    options: DOCUMENT_KINDS,
                },
            )),
            field("description", "Description", LongText),
        ],
        label_sql: "t.name",
        joins: "",
        search_sql: "t.name || ' ' || coalesce(t.description, '')",
        order_sql: "t.name COLLATE NOCASE",
        process_sql: None,
        taggable: true,
    },
    // Made by uploading a file to a document; only the tag and note change.
    Resource {
        name: "versions",
        entity: "version",
        title: "Versions",
        table: "version",
        fields: &[
            required(readonly(field(
                "document_id",
                "Document",
                Ref {
                    resource: "documents",
                },
            ))),
            field("tag", "Tag", Text),
            field("note", "Note", LongText),
        ],
        label_sql: "d.name || ' v' || t.number || coalesce(' (' || t.tag || ')', '')",
        joins: "JOIN document d ON d.id = t.document_id",
        search_sql: "d.name || ' ' || coalesce(t.tag, '') || ' ' || t.filename",
        order_sql: "d.name COLLATE NOCASE, t.number DESC",
        process_sql: None,
        taggable: false,
    },
    // General notes: about the search, not one application.
    Resource {
        name: "memos",
        entity: "memo",
        title: "General notes",
        table: "memo",
        fields: &[
            hint(
                field("title", "Title", Text),
                "Optional, e.g. What I want next",
            ),
            required(hint(field("body", "Note", LongText), "Write anything…")),
        ],
        label_sql: "coalesce(t.title, substr(t.body, 1, 400))",
        joins: "",
        search_sql: "coalesce(t.title, '') || ' ' || t.body",
        order_sql: "t.updated_at DESC, t.id DESC",
        process_sql: None,
        taggable: true,
    },
    Resource {
        name: "tags",
        entity: "tag",
        title: "Tags",
        table: "tag",
        fields: &[
            required(hint(field("name", "Tag", Text), "e.g. dream job")),
            field(
                "color",
                "Colour",
                Enum {
                    options: TAG_COLORS,
                },
            ),
        ],
        label_sql: "t.name",
        joins: "",
        search_sql: "t.name",
        order_sql: "t.name COLLATE NOCASE",
        process_sql: None,
        taggable: false,
    },
    // A job search: several can run at once. One that has ended
    // (`ended_on`) keeps its board as it was.
    Resource {
        name: "cycles",
        entity: "cycle",
        title: "Cycles",
        table: "cycle",
        fields: &[
            required(hint(field("name", "Name", Text), "e.g. Autumn 2026")),
            hint(
                field("description", "Description", LongText),
                "What this cycle is for: a place, an industry, a kind of role",
            ),
            defaulted(field("started_on", "Started", Date)),
            field("ended_on", "Ended", Date),
            // One of these, or in your own words (earlier ones suggested).
            suggest(field(
                "outcome",
                "How it ended",
                Enum {
                    options: CYCLE_OUTCOMES,
                },
            )),
            field("outcome_note", "What happened", Text),
        ],
        label_sql: "t.name",
        joins: "",
        search_sql: "t.name",
        order_sql: "CASE WHEN t.ended_on IS NULL THEN 0 ELSE 1 END, coalesce(t.ended_on, t.started_on) DESC, t.id DESC",
        process_sql: None,
        taggable: false,
    },
    // Something to do for a process by a date; done once `done_at` is set.
    Resource {
        name: "reminders",
        entity: "reminder",
        title: "Reminders",
        table: "reminder",
        fields: &[
            required(readonly(field(
                "process_id",
                "Process",
                Ref {
                    resource: "processes",
                },
            ))),
            required(hint(
                field("title", "Remind me to", Text),
                "e.g. Ask Dana for feedback",
            )),
            field("due_at", "When", DateTime),
            field("done_at", "Done", DateTime),
        ],
        label_sql: "t.title",
        joins: "",
        search_sql: "t.title",
        order_sql: "CASE WHEN t.done_at IS NULL THEN 0 ELSE 1 END, coalesce(t.due_at, '9'), t.id",
        process_sql: Some("t.process_id"),
        taggable: false,
    },
    // Links kept with an application: a candidate portal, prep material.
    Resource {
        name: "links",
        entity: "link",
        title: "Links",
        table: "link",
        fields: &[
            required(readonly(field(
                "application_id",
                "Application",
                Ref {
                    resource: "applications",
                },
            ))),
            required(hint(field("url", "Link", Url), "https://")),
            hint(field("label", "Name", Text), "e.g. Candidate portal"),
            defaulted(field(
                "kind",
                "Kind",
                Enum {
                    options: LINK_KINDS,
                },
            )),
        ],
        label_sql: "coalesce(t.label, t.url)",
        joins: "",
        search_sql: "coalesce(t.label, '') || ' ' || t.url",
        order_sql: "t.created_at, t.id",
        process_sql: None,
        taggable: false,
    },
    // Something to read, practise or rehearse: for a process (one of its
    // steps, even), or in general.
    Resource {
        name: "prep",
        entity: "prep",
        title: "Prep",
        table: "prep_item",
        fields: &[
            required(hint(
                field("title", "What to do", Text),
                "e.g. Practise designing a rate limiter",
            )),
            hint(
                field("description", "Description", LongText),
                "What to cover, how, and why",
            ),
            hint(field("url", "Link", Url), "Article, video, exercise or doc"),
            defaulted(field(
                "kind",
                "Kind",
                Enum {
                    options: PREP_KINDS,
                },
            )),
            field(
                "process_id",
                "For",
                Ref {
                    resource: "processes",
                },
            ),
            field("step_id", "Step", Ref { resource: "steps" }),
            defaulted(field(
                "priority",
                "Priority",
                Enum {
                    options: PRIORITIES,
                },
            )),
            defaulted(field(
                "status",
                "Status",
                Enum {
                    options: PREP_STATUSES,
                },
            )),
            field("minutes", "Takes about (minutes)", Number),
            field("due_on", "Do by", Date),
            field(
                "repeats",
                "Repeats",
                Enum {
                    options: PREP_REPEATS,
                },
            ),
            field(
                "confidence",
                "How solid it feels",
                Enum {
                    options: CONFIDENCE,
                },
            ),
        ],
        label_sql: "t.title",
        joins: "",
        search_sql: "t.title || ' ' || coalesce(t.description, '')",
        order_sql: "coalesce(t.due_on, '9'), t.id",
        process_sql: Some("t.process_id"),
        taggable: false,
    },
    // A story from work for behavioural questions, told across interviews.
    Resource {
        name: "stories",
        entity: "story",
        title: "Stories",
        table: "story",
        fields: &[
            required(hint(
                field("title", "Title", Text),
                "e.g. Cut p99 latency of the billing API by 60%",
            )),
            hint(
                field("situation", "Situation", LongText),
                "What was going on",
            ),
            hint(field("task", "Task", LongText), "What you had to do"),
            hint(field("action", "Action", LongText), "What you did"),
            hint(field("result", "Result", LongText), "How it turned out"),
            hint(field("themes", "Themes", Text), "e.g. Leadership, Conflict"),
            hint(field("told", "Told at", Text), "e.g. Quillnote, Fernwise"),
        ],
        label_sql: "t.title",
        joins: "",
        search_sql: "t.title || ' ' || coalesce(t.themes, '')",
        order_sql: "t.created_at, t.id",
        process_sql: None,
        taggable: false,
    },
];

/// How a cycle ended.
pub const CYCLE_OUTCOMES: &[(&str, &str)] = &[
    ("offer", "Accepted an offer"),
    ("break", "Taking a break"),
    ("stopped", "Stopped looking"),
    ("other", "Ended"),
];

/// When a step reminds you of itself.
pub const STEP_REMINDERS: &[(&str, &str)] =
    &[("hour", "An hour before"), ("day", "The day before")];

pub const LINK_KINDS: &[(&str, &str)] = &[
    ("portal", "Candidate portal"),
    ("prep", "Prep material"),
    ("invite", "Interview invite"),
    ("company", "Company page"),
    ("other", "Other"),
];

pub const PREP_KINDS: &[(&str, &str)] = &[
    ("read", "Read"),
    ("watch", "Watch"),
    ("practise", "Practise"),
    ("exercise", "Exercise"),
    ("mock", "Mock interview"),
    ("questions", "Questions to ask"),
];

pub const PRIORITIES: &[(&str, &str)] = &[("high", "High"), ("normal", "Normal"), ("low", "Low")];

/// Closed: its process's cycle ended before it was done.
pub const PREP_STATUSES: &[(&str, &str)] = &[
    ("todo", "To do"),
    ("doing", "In progress"),
    ("done", "Done"),
    ("closed", "Closed"),
];

pub const PREP_REPEATS: &[(&str, &str)] = &[("daily", "Every day")];

pub const CONFIDENCE: &[(&str, &str)] = &[("shaky", "Shaky"), ("ok", "OK"), ("solid", "Solid")];

/// A tag's colours: each hue in four shades, pale, light (the hue's own
/// name, as tags were first coloured), bold and deep (`-pale`, `-bold`,
/// `-deep`), hue by hue round the wheel, then the earthy ones and grey.
macro_rules! tag_colors {
    ($(($hue:literal, $name:literal, $alone:literal)),* $(,)?) => {
        &[$(
            (concat!($hue, "-pale"), concat!("Pale ", $name)),
            ($hue, concat!("Light ", $name)),
            (concat!($hue, "-bold"), $alone),
            (concat!($hue, "-deep"), concat!("Deep ", $name)),
        )*]
    };
}

/// Colours a tag can be (style.css draws each hue).
pub const TAG_COLORS: &[(&str, &str)] = tag_colors![
    ("red", "red", "Red"),
    ("coral", "coral", "Coral"),
    ("orange", "orange", "Orange"),
    ("amber", "amber", "Amber"),
    ("yellow", "yellow", "Yellow"),
    ("lime", "lime", "Lime"),
    ("green", "green", "Green"),
    ("emerald", "emerald", "Emerald"),
    ("teal", "teal", "Teal"),
    ("cyan", "cyan", "Cyan"),
    ("sky", "sky", "Sky"),
    ("blue", "blue", "Blue"),
    ("indigo", "indigo", "Indigo"),
    ("violet", "violet", "Violet"),
    ("purple", "purple", "Purple"),
    ("magenta", "magenta", "Magenta"),
    ("pink", "pink", "Pink"),
    ("rose", "rose", "Rose"),
    ("brown", "brown", "Brown"),
    ("olive", "olive", "Olive"),
    ("slate", "slate", "Slate"),
    ("grey", "grey", "Grey"),
];

/// A resource by its API name (`companies`) or its entity (`company`).
pub fn resource(name: &str) -> Option<&'static Resource> {
    RESOURCES
        .iter()
        .find(|r| r.name == name || r.entity == name)
}

pub fn option_label(options: &[(&str, &'static str)], value: &str) -> Option<&'static str> {
    options.iter().find(|(v, _)| *v == value).map(|(_, l)| *l)
}
