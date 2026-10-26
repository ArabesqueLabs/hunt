-- Schema 25 to 26 (MySQL): a stage's icon, chosen in the board's settings,
-- which marks it on an application's timeline; none, its plain marker.
ALTER TABLE stage ADD COLUMN icon TEXT;
