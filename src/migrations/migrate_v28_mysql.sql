-- Schema 27 to 28 (MySQL): a prep item's description, and the lists admins
-- can change checked by hunt, not the database. See migrate_v28.sql. Each
-- CHECK is found by what it checks, as in migrate_v17_mysql.sql: MySQL named
-- some of them itself. One already gone does nothing (DO 0).
ALTER TABLE prep_item ADD COLUMN description TEXT;
SET @drop_application_work_mode = (SELECT concat('ALTER TABLE application DROP CHECK `', c.constraint_name, '`')
    FROM information_schema.table_constraints t
    JOIN information_schema.check_constraints c
      ON c.constraint_schema = t.constraint_schema AND c.constraint_name = t.constraint_name
    WHERE t.table_schema = DATABASE() AND t.table_name = 'application' AND t.constraint_type = 'CHECK'
      AND c.check_clause LIKE '%work_mode%'
    LIMIT 1);
SET @drop_application_work_mode = coalesce(@drop_application_work_mode, 'DO 0');
PREPARE drop_application_work_mode FROM @drop_application_work_mode;
EXECUTE drop_application_work_mode;
DEALLOCATE PREPARE drop_application_work_mode;
SET @drop_application_employment = (SELECT concat('ALTER TABLE application DROP CHECK `', c.constraint_name, '`')
    FROM information_schema.table_constraints t
    JOIN information_schema.check_constraints c
      ON c.constraint_schema = t.constraint_schema AND c.constraint_name = t.constraint_name
    WHERE t.table_schema = DATABASE() AND t.table_name = 'application' AND t.constraint_type = 'CHECK'
      AND c.check_clause LIKE '%employment%'
    LIMIT 1);
SET @drop_application_employment = coalesce(@drop_application_employment, 'DO 0');
PREPARE drop_application_employment FROM @drop_application_employment;
EXECUTE drop_application_employment;
DEALLOCATE PREPARE drop_application_employment;
SET @drop_step_status = (SELECT concat('ALTER TABLE step DROP CHECK `', c.constraint_name, '`')
    FROM information_schema.table_constraints t
    JOIN information_schema.check_constraints c
      ON c.constraint_schema = t.constraint_schema AND c.constraint_name = t.constraint_name
    WHERE t.table_schema = DATABASE() AND t.table_name = 'step' AND t.constraint_type = 'CHECK'
      AND c.check_clause LIKE '%scheduled%'
    LIMIT 1);
SET @drop_step_status = coalesce(@drop_step_status, 'DO 0');
PREPARE drop_step_status FROM @drop_step_status;
EXECUTE drop_step_status;
DEALLOCATE PREPARE drop_step_status;
SET @drop_process_person_role = (SELECT concat('ALTER TABLE process_person DROP CHECK `', c.constraint_name, '`')
    FROM information_schema.table_constraints t
    JOIN information_schema.check_constraints c
      ON c.constraint_schema = t.constraint_schema AND c.constraint_name = t.constraint_name
    WHERE t.table_schema = DATABASE() AND t.table_name = 'process_person' AND t.constraint_type = 'CHECK'
      AND c.check_clause LIKE '%recruiter%'
    LIMIT 1);
SET @drop_process_person_role = coalesce(@drop_process_person_role, 'DO 0');
PREPARE drop_process_person_role FROM @drop_process_person_role;
EXECUTE drop_process_person_role;
DEALLOCATE PREPARE drop_process_person_role;
SET @drop_document_kind = (SELECT concat('ALTER TABLE document DROP CHECK `', c.constraint_name, '`')
    FROM information_schema.table_constraints t
    JOIN information_schema.check_constraints c
      ON c.constraint_schema = t.constraint_schema AND c.constraint_name = t.constraint_name
    WHERE t.table_schema = DATABASE() AND t.table_name = 'document' AND t.constraint_type = 'CHECK'
      AND c.check_clause LIKE '%resume%'
    LIMIT 1);
SET @drop_document_kind = coalesce(@drop_document_kind, 'DO 0');
PREPARE drop_document_kind FROM @drop_document_kind;
EXECUTE drop_document_kind;
DEALLOCATE PREPARE drop_document_kind;
