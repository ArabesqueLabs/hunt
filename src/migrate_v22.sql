-- Schema 21 to 22 (SQLite): how a sub stage's (a lane's) cards start on the
-- board: 1, folded into a pack; 0, all of them; none, as its stage's do.
ALTER TABLE lane ADD COLUMN folded INTEGER;
