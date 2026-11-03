-- Schema 20 to 21 (SQLite): a swimlane folded to its heading on the board
-- (1) until opened there, or open (0, as they all start).
ALTER TABLE swimlane ADD COLUMN folded INTEGER NOT NULL DEFAULT 0;
