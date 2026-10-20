-- hunt schema. See docs/design.md.
--
-- Every table is an ordinary, editable record. What changed, and when, is
-- kept in `activity`, which the service writes on every create, update,
-- move and delete. It has no foreign keys, so the log outlives what it
-- describes.
--
-- Dates are 'YYYY-MM-DD'; datetimes are local 'YYYY-MM-DDTHH:MM'; stamps
-- (created_at, updated_at, activity.at) are local 'YYYY-MM-DDTHH:MM:SS'.
-- All sort as text.

-- A wave of looking for a job: post-FB, post-Neon, post-Databricks.
CREATE TABLE hunt (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    started_on TEXT NOT NULL,
    ended_on   TEXT,
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- The board's columns, left to right by position.
CREATE TABLE stage (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE company (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind       TEXT NOT NULL DEFAULT 'employer' CHECK (kind IN ('employer', 'agency')),
    website    TEXT,
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

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
    updated_at TEXT NOT NULL
);

-- An opening (a job posting), or a way in: a role at a company, or a recruiter who may
-- bring several (`via` points at the lead something came through).
CREATE TABLE lead (
    id          INTEGER PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    title       TEXT,
    source      TEXT,
    url         TEXT,
    location    TEXT,
    work_mode   TEXT CHECK (work_mode IN ('remote', 'hybrid', 'onsite')),
    -- After schema.org JobPosting: employmentType, baseSalary, datePosted, validThrough.
    employment  TEXT CHECK (employment IN ('full-time', 'part-time', 'contract', 'temporary', 'internship')),
    salary_min  INTEGER,
    salary_max  INTEGER,
    currency    TEXT,
    pay_period  TEXT CHECK (pay_period IN ('year', 'month', 'day', 'hour')),
    comp        TEXT,
    posted_on   TEXT,
    closes_on   TEXT,
    via_id      INTEGER REFERENCES lead(id) ON DELETE SET NULL,
    description TEXT,
    note        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Pursuing a lead in a hunt: a card on the board. A paused or stopped
-- process keeps the stage it got to.
CREATE TABLE process (
    id          INTEGER PRIMARY KEY,
    hunt_id     INTEGER NOT NULL REFERENCES hunt(id),
    lead_id     INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
    stage_id    INTEGER NOT NULL REFERENCES stage(id),
    position    INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'stopped')),
    stop_reason TEXT CHECK (stop_reason IN ('rejected', 'role-filled', 'role-closed', 'withdrew',
                                            'declined', 'accepted', 'no-response', 'other')),
    status_note TEXT,
    next_action TEXT,
    next_due    TEXT,
    applied_on  TEXT,
    resume      TEXT,
    note        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX process_by_column ON process (hunt_id, status, stage_id, position);

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
    updated_at TEXT NOT NULL
);

-- Free-form notes on a process.
CREATE TABLE note (
    id         INTEGER PRIMARY KEY,
    process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
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
