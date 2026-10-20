-- hunt schema, version 14. See docs/design.md.
--
-- Every table is an ordinary, editable record. What changed, and when, is
-- kept in `activity`, which the service writes on every create, update,
-- move and delete. It has no foreign keys, so the log outlives what it
-- describes.
--
-- Dates are 'YYYY-MM-DD'; datetimes are local 'YYYY-MM-DDTHH:MM'; stamps
-- (created_at, updated_at, activity.at) are local 'YYYY-MM-DDTHH:MM:SS'.
-- All sort as text.

-- The board's columns, left to right by position.
CREATE TABLE stage (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- A stage's column divided by outcome (Offer: accepted, shortlisted,
-- rejected): its lanes, top to bottom. A process may be in one of its
-- stage's lanes; none is the column's undivided top.
CREATE TABLE lane (
    id         INTEGER PRIMARY KEY,
    stage_id   INTEGER NOT NULL REFERENCES stage(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX lane_by_stage ON lane (stage_id, position);

-- A company. Most of what describes it can be imported from its website
-- or its LinkedIn page.
CREATE TABLE company (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind         TEXT NOT NULL DEFAULT 'employer' CHECK (kind IN ('employer', 'agency')),
    website      TEXT,
    note         TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    linkedin     TEXT,
    description  TEXT,
    industry     TEXT,
    size         TEXT,
    headquarters TEXT,
    founded      TEXT,
    -- The logo, as a file in `stored_file`, and its type.
    logo         TEXT REFERENCES stored_file(sha256),
    logo_type    TEXT,
    -- Email domains besides the website's (acme.io, acmecorp.com).
    email_domains TEXT
);

-- A recruiter, hiring manager, interviewer or referrer. Much of this can
-- be imported from their LinkedIn profile.
CREATE TABLE person (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    company_id INTEGER REFERENCES company(id) ON DELETE SET NULL,
    title      TEXT,
    email      TEXT,
    phone      TEXT,
    link       TEXT,
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    linkedin   TEXT,
    location   TEXT,
    about      TEXT,
    -- Their photo, as a file in `stored_file`, and its type.
    photo      TEXT REFERENCES stored_file(sha256),
    photo_type TEXT
);

-- An opening I'm applying to, or might: a role at a company, with its
-- posting. `via` points at the application it came through (a recruiter's
-- may bring several). The posting fields follow schema.org JobPosting:
-- employmentType, baseSalary, datePosted, validThrough.
CREATE TABLE application (
    id          INTEGER PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    title       TEXT,
    source      TEXT,
    url         TEXT,
    location    TEXT,
    work_mode   TEXT CHECK (work_mode IN ('remote', 'hybrid', 'onsite')),
    employment  TEXT CHECK (employment IN ('full-time', 'part-time', 'contract', 'temporary', 'internship')),
    salary_min  INTEGER,
    salary_max  INTEGER,
    currency    TEXT,
    pay_period  TEXT CHECK (pay_period IN ('year', 'month', 'day', 'hour')),
    comp        TEXT,
    posted_on   TEXT,
    closes_on   TEXT,
    via_id      INTEGER REFERENCES application(id) ON DELETE SET NULL,
    description TEXT,
    note        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    -- The pay range in GBP, converted when the pay or currency was set,
    -- at `gbp_rate` (GBP per unit of `currency`) on `gbp_rate_on`.
    salary_min_gbp INTEGER,
    salary_max_gbp INTEGER,
    gbp_rate       REAL,
    gbp_rate_on    TEXT,
    bonus          TEXT,
    equity         TEXT
);

-- The same job posted elsewhere (LinkedIn, a careers page, an agency): an
-- application's other postings, each with what it says. Its own `url` and
-- `description` are its main posting.
CREATE TABLE posting (
    id             INTEGER PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
    url            TEXT NOT NULL,
    platform       TEXT,
    description    TEXT,
    read_at        TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX posting_by_application ON posting (application_id);

-- Why a process is archived: a list to edit. `value` is the code processes
-- store, fixed once made; `name` is what people see.
CREATE TABLE archive_reason (
    id         INTEGER PRIMARY KEY,
    value      TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Pursuing an application: a card on the board. Usually one per
-- application; another if I apply again later. An archived process (on
-- hold, or over) keeps the stage it got to.
CREATE TABLE process (
    id             INTEGER PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
    stage_id       INTEGER NOT NULL REFERENCES stage(id),
    position       INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    -- Why it's archived: a code from `archive_reason`.
    archive_reason TEXT REFERENCES archive_reason(value),
    archive_note   TEXT,
    next_action    TEXT,
    next_due       TEXT,
    applied_on     TEXT,
    note           TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    -- Its own Gmail search, replacing the one hunt builds; and its Gmail label.
    mail_query     TEXT,
    mail_label     TEXT,
    -- Which of its stage's lanes it's in, if the column is divided.
    lane_id        INTEGER REFERENCES lane(id) ON DELETE SET NULL
);

CREATE INDEX process_by_column ON process (status, stage_id, position);

-- Who is involved in a process, and as what.
CREATE TABLE process_person (
    process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
    person_id  INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    role       TEXT CHECK (role IN ('recruiter', 'hiring-manager', 'interviewer', 'referrer', 'other')),
    PRIMARY KEY (process_id, person_id)
);

-- An interview step: a screen, a take-home, an on-site.
CREATE TABLE step (
    id         INTEGER PRIMARY KEY,
    process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    at         TEXT,
    status     TEXT NOT NULL DEFAULT 'scheduled'
               CHECK (status IN ('scheduled', 'done', 'passed', 'failed', 'cancelled')),
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    format         TEXT,
    attendees      TEXT
);

-- Free-form notes on a process.
CREATE TABLE note (
    id         INTEGER PRIMARY KEY,
    process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    happened_on    TEXT
);

-- Who an interview step is with.
CREATE TABLE step_person (
    step_id   BIGINT NOT NULL,
    person_id BIGINT NOT NULL,
    PRIMARY KEY (step_id, person_id),
    FOREIGN KEY (step_id) REFERENCES step(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE CASCADE
);
CREATE INDEX step_person_by_person ON step_person (person_id);

-- Documents kept over time: resumes, cover letters, portfolios, offers,
-- contracts, feedback …
CREATE TABLE document (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind        TEXT NOT NULL DEFAULT 'resume'
                CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'screenshot', 'offer',
                              'contract', 'candidate-resource', 'feedback', 'other')),
    description TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- File contents, by hash, so the same file uploaded twice is stored once.
CREATE TABLE stored_file (
    sha256 TEXT PRIMARY KEY,
    data   BLOB NOT NULL
);

-- A version of a document: an uploaded file. The file never changes; its
-- tag and note can. Numbered 1, 2, 3… within the document.
CREATE TABLE version (
    id           INTEGER PRIMARY KEY,
    document_id  INTEGER NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    number       INTEGER NOT NULL,
    tag          TEXT,
    note         TEXT,
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size         INTEGER NOT NULL,
    sha256       TEXT NOT NULL REFERENCES stored_file(sha256),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (document_id, number)
);

-- Which versions went with which process. A version that was sent can't
-- be deleted until it's taken off.
CREATE TABLE process_file (
    process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
    version_id INTEGER NOT NULL REFERENCES version(id),
    added_at   TEXT NOT NULL,
    PRIMARY KEY (process_id, version_id)
);

-- Today's rate to GBP, per currency, so a conversion fetches it at most once a day.
CREATE TABLE fx_rate (
    currency   TEXT PRIMARY KEY,
    rate       REAL NOT NULL,
    rate_on    TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);

-- Tags, and what carries them: applications, companies, people, documents.
-- `tagging` names its record by entity and id, so any of them can be tagged.
CREATE TABLE tag (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE tagging (
    tag_id    INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    entity    TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    PRIMARY KEY (tag_id, entity, entity_id)
);
CREATE INDEX tagging_by_entity ON tagging (entity, entity_id);

-- Email from Gmail (or dropped .eml files), linked to a process, waiting
-- in triage for one, or ignored (kept so it isn't fetched again).
CREATE TABLE email (
    id          INTEGER PRIMARY KEY,
    process_id  INTEGER REFERENCES process(id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (status IN ('linked', 'triage', 'ignored')),
    message_id  TEXT,
    gm_msgid    TEXT UNIQUE,
    gm_thrid    TEXT,
    from_addr   TEXT,
    from_name   TEXT,
    to_addrs    TEXT,
    cc_addrs    TEXT,
    subject     TEXT,
    snippet     TEXT,
    body        TEXT,
    sent_at     TEXT NOT NULL,
    outgoing    INTEGER NOT NULL DEFAULT 0,
    labels      TEXT,
    matched_by  TEXT,
    suggestions TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX email_by_process ON email (process_id, sent_at);
CREATE INDEX email_by_thread ON email (gm_thrid);
CREATE UNIQUE INDEX email_by_message_id ON email (message_id) WHERE message_id IS NOT NULL;

CREATE TABLE mail_ignore (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('sender', 'domain')),
    value      TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE (kind, value)
);

CREATE TABLE setting (
    name  TEXT PRIMARY KEY,
    value TEXT
);

-- General notes: about the search, not one application.
CREATE TABLE memo (
    id         INTEGER PRIMARY KEY,
    title      TEXT,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);


-- The log of changes. `changes` is JSON: {"field": [old, new], ...}.
-- `process_id` ties a change to the process timelines it belongs on.
CREATE TABLE activity (
    id         INTEGER PRIMARY KEY,
    at         TEXT NOT NULL,
    entity     TEXT NOT NULL,
    entity_id  INTEGER NOT NULL,
    process_id INTEGER,
    action     TEXT NOT NULL CHECK (action IN ('created', 'updated', 'moved', 'deleted')),
    summary    TEXT NOT NULL,
    changes    TEXT
);

CREATE INDEX activity_by_entity ON activity (entity, entity_id);
CREATE INDEX activity_by_process ON activity (process_id);
