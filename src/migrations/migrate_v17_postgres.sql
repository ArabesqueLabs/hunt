-- Schema 16 to 17 (PostgreSQL): a step can be done with nothing to wait
-- for. See migrate_v17.sql.
ALTER TABLE step DROP CONSTRAINT IF EXISTS step_status_check;
ALTER TABLE step ADD CONSTRAINT step_status_check
    CHECK (status IN ('scheduled', 'done', 'completed', 'passed', 'failed', 'cancelled'));
