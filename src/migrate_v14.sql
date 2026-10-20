-- Schema 13 to 14 (SQLite): lanes, a stage's column divided by outcome
-- (Offer: accepted, shortlisted, rejected). A process may be in one of its
-- stage's lanes; none means the column's top, undivided part.
CREATE TABLE lane (
    id         INTEGER PRIMARY KEY,
    stage_id   INTEGER NOT NULL REFERENCES stage(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX lane_by_stage ON lane (stage_id, position);
ALTER TABLE process ADD COLUMN lane_id INTEGER REFERENCES lane(id) ON DELETE SET NULL;
