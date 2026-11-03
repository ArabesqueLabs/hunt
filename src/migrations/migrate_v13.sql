-- Schema 12 to 13 (SQLite): an application's other postings. Its own `url`
-- and `description` stay its main posting; the same job posted elsewhere
-- (LinkedIn, a careers page, an agency) is a row here, with what it says.
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
