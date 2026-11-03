-- Schema 5 to 6: archive reasons become a list to edit, and tags.
-- Run with foreign keys off, in a transaction.
--
-- A process still stores its archive reason as a short code ("role-filled");
-- the codes and their labels now live in `archive_reason`, so the process
-- table loses its fixed CHECK list (which means rebuilding it).

CREATE TABLE archive_reason (
    id         INTEGER PRIMARY KEY,
    value      TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO archive_reason (value, name, position, created_at, updated_at) VALUES
    ('on-hold', 'On hold', 0, datetime('now', 'localtime'), datetime('now', 'localtime')),
    ('rejected', 'They rejected me', 1, datetime('now', 'localtime'), datetime('now', 'localtime')),
    ('role-filled', 'Role filled', 2, datetime('now', 'localtime'), datetime('now', 'localtime')),
    ('role-closed', 'Role closed or pulled', 3, datetime('now', 'localtime'), datetime('now', 'localtime')),
    ('withdrew', 'I withdrew', 4, datetime('now', 'localtime'), datetime('now', 'localtime')),
    ('declined', 'I declined the offer', 5, datetime('now', 'localtime'), datetime('now', 'localtime')),
    ('accepted', 'I accepted the offer', 6, datetime('now', 'localtime'), datetime('now', 'localtime')),
    ('no-response', 'No response', 7, datetime('now', 'localtime'), datetime('now', 'localtime')),
    ('other', 'Other', 8, datetime('now', 'localtime'), datetime('now', 'localtime'));

CREATE TABLE process_v6 (
    id             INTEGER PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
    stage_id       INTEGER NOT NULL REFERENCES stage(id),
    position       INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    archive_reason TEXT REFERENCES archive_reason(value),
    archive_note   TEXT,
    next_action    TEXT,
    next_due       TEXT,
    applied_on     TEXT,
    note           TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
INSERT INTO process_v6 SELECT id, application_id, stage_id, position, status, archive_reason, archive_note,
    next_action, next_due, applied_on, note, created_at, updated_at FROM process;
DROP TABLE process;
ALTER TABLE process_v6 RENAME TO process;
CREATE INDEX process_by_column ON process (status, stage_id, position);

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
