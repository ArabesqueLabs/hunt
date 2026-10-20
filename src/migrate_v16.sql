-- Schema 15 to 16 (SQLite): more kinds of document (certificate, job
-- description, take-home assignment, NDA, background check, right to work).
-- SQLite can't change a CHECK in place, so the table is rebuilt, as in
-- migrate_v12.sql; versions keep referring to it by name.
CREATE TABLE document_new (
    id          INTEGER PRIMARY KEY,
    owner_id    INTEGER NOT NULL DEFAULT 1,
    name        TEXT NOT NULL COLLATE NOCASE,
    kind        TEXT NOT NULL DEFAULT 'resume'
                CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'certificate',
                              'screenshot', 'job-description', 'assignment', 'offer', 'contract',
                              'nda', 'background-check', 'right-to-work', 'candidate-resource',
                              'feedback', 'other')),
    description TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (owner_id, name)
);
INSERT INTO document_new (id, owner_id, name, kind, description, created_at, updated_at)
    SELECT id, owner_id, name, kind, description, created_at, updated_at FROM document;
DROP TABLE document;
ALTER TABLE document_new RENAME TO document;
CREATE INDEX document_by_owner ON document (owner_id);
