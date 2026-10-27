-- Schema 27 to 28 (PostgreSQL): a prep item's description, and the lists
-- admins can change checked by hunt, not the database. See migrate_v28.sql.
ALTER TABLE prep_item ADD COLUMN description TEXT;
ALTER TABLE application DROP CONSTRAINT IF EXISTS application_work_mode_check;
ALTER TABLE application DROP CONSTRAINT IF EXISTS application_employment_check;
ALTER TABLE step DROP CONSTRAINT IF EXISTS step_status_check;
ALTER TABLE process_person DROP CONSTRAINT IF EXISTS process_person_role_check;
ALTER TABLE document DROP CONSTRAINT IF EXISTS document_kind_check;
