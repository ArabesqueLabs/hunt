-- Schema 6 to 7: email, matched to processes.

-- More of a company's email domains than its website's (acme.io, acmecorp.com).
ALTER TABLE company ADD COLUMN email_domains TEXT;
-- A process's own Gmail search, replacing the one hunt builds; and its label.
ALTER TABLE process ADD COLUMN mail_query TEXT;
ALTER TABLE process ADD COLUMN mail_label TEXT;

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
    key   TEXT PRIMARY KEY,
    value TEXT
);
