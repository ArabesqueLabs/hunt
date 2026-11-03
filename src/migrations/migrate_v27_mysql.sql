-- Schema 26 to 27 (MySQL): a role's own reference. See migrate_v27.sql.
ALTER TABLE application ADD COLUMN reference TEXT;
ALTER TABLE posting ADD COLUMN reference TEXT;
