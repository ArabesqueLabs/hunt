-- Schema 14 to 15 (SQLite): several people, one database. Every row someone
-- keeps carries its owner (an account), and what had to be unique is unique
-- per owner (two people can both have a company called Acme). What was here
-- is the first account's: owner 1. Accounts are kept in `account`.

CREATE TABLE account (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT,
    provider      TEXT,
    reason        TEXT,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'rejected', 'disabled')),
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    service_token TEXT UNIQUE,
    requested_at  TEXT NOT NULL,
    decided_at    TEXT,
    decided_by    TEXT,
    note          TEXT,
    last_seen     TEXT
);

-- Tables whose names (or codes) were unique: rebuilt, unique per owner.
CREATE TABLE stage_new (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL DEFAULT 1,
    name       TEXT NOT NULL COLLATE NOCASE,
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (owner_id, name)
);
INSERT INTO stage_new (id, name, position, created_at, updated_at)
    SELECT id, name, position, created_at, updated_at FROM stage;
DROP TABLE stage;
ALTER TABLE stage_new RENAME TO stage;

CREATE TABLE company_new (
    id           INTEGER PRIMARY KEY,
    owner_id     INTEGER NOT NULL DEFAULT 1,
    name         TEXT NOT NULL COLLATE NOCASE,
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
    logo         TEXT REFERENCES stored_file(sha256),
    logo_type    TEXT,
    email_domains TEXT,
    UNIQUE (owner_id, name)
);
INSERT INTO company_new (id, name, kind, website, note, created_at, updated_at, linkedin, description,
                         industry, size, headquarters, founded, logo, logo_type, email_domains)
    SELECT id, name, kind, website, note, created_at, updated_at, linkedin, description,
           industry, size, headquarters, founded, logo, logo_type, email_domains FROM company;
DROP TABLE company;
ALTER TABLE company_new RENAME TO company;

CREATE TABLE archive_reason_new (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL DEFAULT 1,
    value      TEXT NOT NULL,
    name       TEXT NOT NULL COLLATE NOCASE,
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (owner_id, value),
    UNIQUE (owner_id, name)
);
INSERT INTO archive_reason_new (id, value, name, position, created_at, updated_at)
    SELECT id, value, name, position, created_at, updated_at FROM archive_reason;
DROP TABLE archive_reason;
ALTER TABLE archive_reason_new RENAME TO archive_reason;

-- A process's archive reason is its owner's.
CREATE TABLE process_new (
    id             INTEGER PRIMARY KEY,
    owner_id       INTEGER NOT NULL DEFAULT 1,
    application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
    stage_id       INTEGER NOT NULL REFERENCES stage(id),
    position       INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    archive_reason TEXT,
    archive_note   TEXT,
    next_action    TEXT,
    next_due       TEXT,
    applied_on     TEXT,
    note           TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    mail_query     TEXT,
    mail_label     TEXT,
    lane_id        INTEGER REFERENCES lane(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id, archive_reason) REFERENCES archive_reason(owner_id, value)
);
INSERT INTO process_new (id, application_id, stage_id, position, status, archive_reason, archive_note,
                         next_action, next_due, applied_on, note, created_at, updated_at, mail_query,
                         mail_label, lane_id)
    SELECT id, application_id, stage_id, position, status, archive_reason, archive_note,
           next_action, next_due, applied_on, note, created_at, updated_at, mail_query,
           mail_label, lane_id FROM process;
DROP TABLE process;
ALTER TABLE process_new RENAME TO process;
CREATE INDEX process_by_column ON process (owner_id, status, stage_id, position);

CREATE TABLE document_new (
    id          INTEGER PRIMARY KEY,
    owner_id    INTEGER NOT NULL DEFAULT 1,
    name        TEXT NOT NULL COLLATE NOCASE,
    kind        TEXT NOT NULL DEFAULT 'resume'
                CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'screenshot', 'offer',
                              'contract', 'candidate-resource', 'feedback', 'other')),
    description TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (owner_id, name)
);
INSERT INTO document_new (id, name, kind, description, created_at, updated_at)
    SELECT id, name, kind, description, created_at, updated_at FROM document;
DROP TABLE document;
ALTER TABLE document_new RENAME TO document;

CREATE TABLE tag_new (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL DEFAULT 1,
    name       TEXT NOT NULL COLLATE NOCASE,
    color      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (owner_id, name)
);
INSERT INTO tag_new (id, name, color, created_at, updated_at)
    SELECT id, name, color, created_at, updated_at FROM tag;
DROP TABLE tag;
ALTER TABLE tag_new RENAME TO tag;

CREATE TABLE email_new (
    id          INTEGER PRIMARY KEY,
    owner_id    INTEGER NOT NULL DEFAULT 1,
    process_id  INTEGER REFERENCES process(id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (status IN ('linked', 'triage', 'ignored')),
    message_id  TEXT,
    gm_msgid    TEXT,
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
    updated_at  TEXT NOT NULL,
    UNIQUE (owner_id, gm_msgid)
);
INSERT INTO email_new (id, process_id, status, message_id, gm_msgid, gm_thrid, from_addr, from_name, to_addrs,
                       cc_addrs, subject, snippet, body, sent_at, outgoing, labels, matched_by, suggestions,
                       created_at, updated_at)
    SELECT id, process_id, status, message_id, gm_msgid, gm_thrid, from_addr, from_name, to_addrs,
           cc_addrs, subject, snippet, body, sent_at, outgoing, labels, matched_by, suggestions,
           created_at, updated_at FROM email;
DROP TABLE email;
ALTER TABLE email_new RENAME TO email;
CREATE INDEX email_by_process ON email (process_id, sent_at);
CREATE INDEX email_by_thread ON email (gm_thrid);
CREATE UNIQUE INDEX email_by_message_id ON email (owner_id, message_id) WHERE message_id IS NOT NULL;

CREATE TABLE mail_ignore_new (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL DEFAULT 1,
    kind       TEXT NOT NULL CHECK (kind IN ('sender', 'domain')),
    value      TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE (owner_id, kind, value)
);
INSERT INTO mail_ignore_new (id, kind, value, created_at) SELECT id, kind, value, created_at FROM mail_ignore;
DROP TABLE mail_ignore;
ALTER TABLE mail_ignore_new RENAME TO mail_ignore;

CREATE TABLE setting_new (
    owner_id INTEGER NOT NULL DEFAULT 1,
    name     TEXT NOT NULL,
    value    TEXT,
    PRIMARY KEY (owner_id, name)
);
INSERT INTO setting_new (name, value) SELECT name, value FROM setting;
DROP TABLE setting;
ALTER TABLE setting_new RENAME TO setting;

-- The rest: their owner, added.
ALTER TABLE lane ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE person ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE application ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE posting ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE process_person ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE step ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE note ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE step_person ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE version ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE process_file ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tagging ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memo ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE activity ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1;

-- Each owner's rows, found quickly.
CREATE INDEX stage_by_owner ON stage (owner_id);
CREATE INDEX lane_by_owner ON lane (owner_id);
CREATE INDEX company_by_owner ON company (owner_id);
CREATE INDEX person_by_owner ON person (owner_id);
CREATE INDEX application_by_owner ON application (owner_id);
CREATE INDEX posting_by_owner ON posting (owner_id);
CREATE INDEX step_by_owner ON step (owner_id);
CREATE INDEX note_by_owner ON note (owner_id);
CREATE INDEX document_by_owner ON document (owner_id);
CREATE INDEX version_by_owner ON version (owner_id);
CREATE INDEX tag_by_owner ON tag (owner_id);
CREATE INDEX tagging_by_owner ON tagging (owner_id);
CREATE INDEX email_by_owner ON email (owner_id);
CREATE INDEX memo_by_owner ON memo (owner_id);
CREATE INDEX activity_by_owner ON activity (owner_id, at);
