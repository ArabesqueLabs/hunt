-- Schema 8 to 9, for every database (the same SQL runs on SQLite,
-- PostgreSQL and MySQL): more about pay, interview steps and timeline
-- entries, for the application page.
ALTER TABLE application ADD COLUMN bonus TEXT;
ALTER TABLE application ADD COLUMN equity TEXT;
ALTER TABLE step ADD COLUMN format TEXT;
ALTER TABLE step ADD COLUMN attendees TEXT;
ALTER TABLE note ADD COLUMN happened_on TEXT;
