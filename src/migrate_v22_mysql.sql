-- Schema 21 to 22 (MySQL): folded sub stages. See migrate_v22.sql.
ALTER TABLE lane ADD COLUMN folded BIGINT NULL;
