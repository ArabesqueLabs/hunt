-- Schema 1 to 2. Run with foreign keys off, in a transaction.
--
-- - Leads are now applications: the table, and process.lead_id.
-- - Hunts are gone; the board holds every process, and dates tell them
--   apart. Cards from different hunts in the same column are renumbered.
-- - "paused" and "stopped" become "archived" with a reason; paused is
--   "on-hold".
-- - The free-text "resume" field moves into the note; documents and their
--   versions take over.

ALTER TABLE lead RENAME TO application;

CREATE TABLE process_v2 (
    id             INTEGER PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
    stage_id       INTEGER NOT NULL REFERENCES stage(id),
    position       INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    archive_reason TEXT CHECK (archive_reason IN ('on-hold', 'rejected', 'role-filled', 'role-closed',
                                                  'withdrew', 'declined', 'accepted', 'no-response', 'other')),
    archive_note   TEXT,
    next_action    TEXT,
    next_due       TEXT,
    applied_on     TEXT,
    note           TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

INSERT INTO process_v2 (id, application_id, stage_id, position, status, archive_reason, archive_note,
                        next_action, next_due, applied_on, note, created_at, updated_at)
SELECT id, lead_id, stage_id,
       row_number() OVER (PARTITION BY stage_id ORDER BY hunt_id, position, id) - 1,
       CASE status WHEN 'active' THEN 'active' ELSE 'archived' END,
       CASE status WHEN 'paused' THEN 'on-hold' WHEN 'stopped' THEN coalesce(stop_reason, 'other') END,
       status_note, next_action, next_due, applied_on,
       CASE WHEN resume IS NULL THEN note
            WHEN note IS NULL THEN 'Resume sent: ' || resume
            ELSE note || char(10) || 'Resume sent: ' || resume END,
       created_at, updated_at
FROM process;

DROP TABLE process;
ALTER TABLE process_v2 RENAME TO process;
CREATE INDEX process_by_column ON process (status, stage_id, position);

DROP TABLE hunt;

UPDATE activity SET entity = 'application' WHERE entity = 'lead';

CREATE TABLE document (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind        TEXT NOT NULL DEFAULT 'resume'
                CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'other')),
    description TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE blob (
    sha256 TEXT PRIMARY KEY,
    data   BLOB NOT NULL
);

CREATE TABLE version (
    id           INTEGER PRIMARY KEY,
    document_id  INTEGER NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    number       INTEGER NOT NULL,
    tag          TEXT,
    note         TEXT,
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size         INTEGER NOT NULL,
    sha256       TEXT NOT NULL REFERENCES blob(sha256),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (document_id, number)
);

CREATE TABLE process_file (
    process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
    version_id INTEGER NOT NULL REFERENCES version(id),
    added_at   TEXT NOT NULL,
    PRIMARY KEY (process_id, version_id)
);
