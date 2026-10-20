-- Schema 21 to 22 (PostgreSQL): folded sub stages. See migrate_v22.sql.
ALTER TABLE lane ADD COLUMN folded BIGINT;
