-- Schema 23 to 24 (SQLite): how a cycle ended can be in your own words, as
-- well as one of offer, break, stopped and other. SQLite can't drop a CHECK
-- in place, so the table is rebuilt; its processes keep referring to it by
-- name.
CREATE TABLE cycle_new (
    id           INTEGER PRIMARY KEY,
    owner_id     INTEGER NOT NULL DEFAULT 1,
    name         TEXT NOT NULL,
    description  TEXT,
    started_on   TEXT NOT NULL,
    -- Set when it ends, with how it ended.
    ended_on     TEXT,
    outcome      TEXT,
    outcome_note TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
INSERT INTO cycle_new (id, owner_id, name, description, started_on, ended_on, outcome,
                       outcome_note, created_at, updated_at)
    SELECT id, owner_id, name, description, started_on, ended_on, outcome, outcome_note,
           created_at, updated_at FROM cycle;
DROP TABLE cycle;
ALTER TABLE cycle_new RENAME TO cycle;
CREATE INDEX cycle_by_owner ON cycle (owner_id);
