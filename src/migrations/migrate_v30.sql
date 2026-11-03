-- Schema 29 to 30 (SQLite): a stage's name is unique in its swimlane, not
-- across the board; two swimlanes can each have an Offer. hunt checks it
-- (a stage in no swimlane is in the first), so the table is rebuilt without
-- its UNIQUE (owner_id, name).
CREATE TABLE stage_new (
    id          INTEGER PRIMARY KEY,
    owner_id    INTEGER NOT NULL DEFAULT 1,
    name        TEXT NOT NULL COLLATE NOCASE,
    position    INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    folded      INTEGER NOT NULL DEFAULT 0,
    swimlane_id INTEGER REFERENCES swimlane(id) ON DELETE SET NULL,
    icon        TEXT
);
INSERT INTO stage_new (id, owner_id, name, position, created_at, updated_at, active, folded, swimlane_id, icon)
    SELECT id, owner_id, name, position, created_at, updated_at, active, folded, swimlane_id, icon FROM stage;
DROP TABLE stage;
ALTER TABLE stage_new RENAME TO stage;
CREATE INDEX stage_by_owner ON stage (owner_id);
