-- Schema 29 to 30 (MySQL): a stage's name is unique in its swimlane, which
-- hunt checks. See migrate_v30.sql.
DROP INDEX stage_name ON stage;
