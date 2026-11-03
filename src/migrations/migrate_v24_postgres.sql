-- Schema 23 to 24 (PostgreSQL): how a cycle ended can be in your own words.
-- See migrate_v24.sql.
ALTER TABLE cycle DROP CONSTRAINT IF EXISTS cycle_outcome_check;
