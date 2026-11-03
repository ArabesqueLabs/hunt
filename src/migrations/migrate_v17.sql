-- Schema 16 to 17 (SQLite): a step can be done with nothing to wait for
-- ('completed', "Done"), as well as done and waiting to hear ('done').
-- SQLite can't change a CHECK in place, so the table is rebuilt; its people
-- (step_person) keep referring to it by name.
CREATE TABLE step_new (
    id         INTEGER PRIMARY KEY,
    process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    at         TEXT,
    status     TEXT NOT NULL DEFAULT 'scheduled'
               CHECK (status IN ('scheduled', 'done', 'completed', 'passed', 'failed', 'cancelled')),
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    format     TEXT,
    attendees  TEXT,
    owner_id   INTEGER NOT NULL DEFAULT 1
);
INSERT INTO step_new (id, process_id, title, at, status, note, created_at, updated_at, format,
                      attendees, owner_id)
    SELECT id, process_id, title, at, status, note, created_at, updated_at, format, attendees,
           owner_id FROM step;
DROP TABLE step;
ALTER TABLE step_new RENAME TO step;
CREATE INDEX step_by_owner ON step (owner_id);
