-- Schema 28 to 29 (PostgreSQL): a posting link's name. See migrate_v29.sql.
ALTER TABLE application ADD COLUMN url_label TEXT;
ALTER TABLE posting ADD COLUMN label TEXT;
