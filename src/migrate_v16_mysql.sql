-- Schema 15 to 16 (MySQL): more kinds of document. See migrate_v16.sql. The
-- kind's CHECK is document_kind_check where migrate_v12_mysql.sql made it,
-- and named by MySQL (document_chk_1) where the database began at schema
-- 14, so it's found by what it checks.
SET @drop_kinds = (SELECT concat('ALTER TABLE document DROP CHECK `', c.constraint_name, '`')
    FROM information_schema.table_constraints t
    JOIN information_schema.check_constraints c
      ON c.constraint_schema = t.constraint_schema AND c.constraint_name = t.constraint_name
    WHERE t.table_schema = DATABASE() AND t.table_name = 'document' AND t.constraint_type = 'CHECK'
      AND c.check_clause LIKE '%cover-letter%'
    LIMIT 1);
PREPARE drop_kinds FROM @drop_kinds;
EXECUTE drop_kinds;
DEALLOCATE PREPARE drop_kinds;
ALTER TABLE document ADD CONSTRAINT document_kind_check
    CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'certificate',
                    'screenshot', 'job-description', 'assignment', 'offer', 'contract',
                    'nda', 'background-check', 'right-to-work', 'candidate-resource',
                    'feedback', 'other'));
