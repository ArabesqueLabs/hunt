-- Schema 22 to 23 (PostgreSQL): default sub stages. See migrate_v23.sql.
ALTER TABLE lane ADD COLUMN is_default BIGINT NOT NULL DEFAULT 0;
