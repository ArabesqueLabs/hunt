-- Schema 11 to 12: more kinds of document (screenshot, offer, contract,
-- candidate resource, feedback). SQLite can't change a CHECK in place, so
-- the table is rebuilt; versions keep referring to it by name.
CREATE TABLE document_new (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind        TEXT NOT NULL DEFAULT 'resume'
                CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'screenshot', 'offer',
                              'contract', 'candidate-resource', 'feedback', 'other')),
    description TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
INSERT INTO document_new (id, name, kind, description, created_at, updated_at)
    SELECT id, name, kind, description, created_at, updated_at FROM document;
DROP TABLE document;
ALTER TABLE document_new RENAME TO document;
