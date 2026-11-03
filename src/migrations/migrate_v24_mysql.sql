-- Schema 23 to 24 (MySQL): how a cycle ended can be in your own words. See
-- migrate_v24.sql. The outcome's CHECK was named by MySQL, so it's found by
-- what it checks, as in migrate_v17_mysql.sql.
SET @drop_outcomes = (SELECT concat('ALTER TABLE cycle DROP CHECK `', c.constraint_name, '`')
    FROM information_schema.table_constraints t
    JOIN information_schema.check_constraints c
      ON c.constraint_schema = t.constraint_schema AND c.constraint_name = t.constraint_name
    WHERE t.table_schema = DATABASE() AND t.table_name = 'cycle' AND t.constraint_type = 'CHECK'
      AND c.check_clause LIKE '%stopped%'
    LIMIT 1);
PREPARE drop_outcomes FROM @drop_outcomes;
EXECUTE drop_outcomes;
DEALLOCATE PREPARE drop_outcomes;
