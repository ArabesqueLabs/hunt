-- Schema 16 to 17 (MySQL): a step can be done with nothing to wait for.
-- See migrate_v17.sql. The status's CHECK was named by MySQL, so it's found
-- by what it checks, as in migrate_v16_mysql.sql.
SET @drop_statuses = (SELECT concat('ALTER TABLE step DROP CHECK `', c.constraint_name, '`')
    FROM information_schema.table_constraints t
    JOIN information_schema.check_constraints c
      ON c.constraint_schema = t.constraint_schema AND c.constraint_name = t.constraint_name
    WHERE t.table_schema = DATABASE() AND t.table_name = 'step' AND t.constraint_type = 'CHECK'
      AND c.check_clause LIKE '%scheduled%'
    LIMIT 1);
PREPARE drop_statuses FROM @drop_statuses;
EXECUTE drop_statuses;
DEALLOCATE PREPARE drop_statuses;
ALTER TABLE step ADD CONSTRAINT step_status_check
    CHECK (status IN ('scheduled', 'done', 'completed', 'passed', 'failed', 'cancelled'));
