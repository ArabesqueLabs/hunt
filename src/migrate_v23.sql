-- Schema 22 to 23 (SQLite): a stage's default sub stage (lane), where a
-- process going into the stage goes when no sub stage is said: one a
-- stage, at most.
ALTER TABLE lane ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
