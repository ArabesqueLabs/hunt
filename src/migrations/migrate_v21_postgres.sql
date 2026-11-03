-- Schema 20 to 21 (PostgreSQL): folded swimlanes. See migrate_v21.sql.
ALTER TABLE swimlane ADD COLUMN folded BIGINT NOT NULL DEFAULT 0;
