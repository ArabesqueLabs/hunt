-- Schema 19 to 20 (SQLite): how a stage's cards start, and the board's
-- swimlanes.
--
-- How a stage's cards show until folded or unfolded on the board: 1, folded
-- into packs (a card on the rest, per sub stage); 0, all of them. The
-- inactive (terminal) stages start folded.
ALTER TABLE stage ADD COLUMN folded INTEGER NOT NULL DEFAULT 0;
UPDATE stage SET folded = 1 WHERE active = 0;

-- The board's swimlanes: its rows, top to bottom, each with stages (its
-- columns) in it. Each account starts with two: its active stages in
-- Active Processes, its inactive (terminal) ones in Terminated Processes.
CREATE TABLE swimlane (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL DEFAULT 1,
    name       TEXT NOT NULL COLLATE NOCASE,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX swimlane_name ON swimlane (owner_id, name);
-- None: the first swimlane.
ALTER TABLE stage ADD COLUMN swimlane_id INTEGER REFERENCES swimlane(id) ON DELETE SET NULL;
INSERT INTO swimlane (owner_id, name, position, created_at, updated_at)
    SELECT owner_id, 'Active Processes', 0, min(created_at), min(created_at) FROM stage GROUP BY owner_id;
INSERT INTO swimlane (owner_id, name, position, created_at, updated_at)
    SELECT owner_id, 'Terminated Processes', 1, min(created_at), min(created_at) FROM stage GROUP BY owner_id;
UPDATE stage SET swimlane_id = (SELECT w.id FROM swimlane w WHERE w.owner_id = stage.owner_id
                                AND w.position = CASE WHEN stage.active = 1 THEN 0 ELSE 1 END);
