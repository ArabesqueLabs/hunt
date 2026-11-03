-- Schema 14 to 15 (MySQL): several people, one database. See
-- migrate_v15.sql: every row someone keeps carries its owner (an account),
-- and what had to be unique is unique per owner. What was here is owner 1's.

CREATE TABLE account (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    name          LONGTEXT,
    provider      LONGTEXT,
    reason        LONGTEXT,
    status        VARCHAR(255) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'rejected', 'disabled')),
    role          VARCHAR(255) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    service_token VARCHAR(255) UNIQUE,
    requested_at  LONGTEXT NOT NULL,
    decided_at    LONGTEXT,
    decided_by    LONGTEXT,
    note          LONGTEXT,
    last_seen     LONGTEXT
);

ALTER TABLE stage ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE lane ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE company ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE person ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE application ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE posting ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE archive_reason ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE process ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE process_person ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE step ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE note ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE step_person ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE document ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE version ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE process_file ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE tag ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE tagging ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE email ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE mail_ignore ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE setting ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE memo ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE activity ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 1;

-- Unique per owner. The process → archive reason key is named by MySQL, and
-- differently by how the database was made: found by what it joins.
SET @fk = (SELECT constraint_name FROM information_schema.key_column_usage
           WHERE table_schema = DATABASE() AND table_name = 'process'
             AND column_name = 'archive_reason' AND referenced_table_name = 'archive_reason' LIMIT 1);
SET @drop = CONCAT('ALTER TABLE process DROP FOREIGN KEY ', @fk);
PREPARE drop_fk FROM @drop;
EXECUTE drop_fk;
DEALLOCATE PREPARE drop_fk;
DROP INDEX stage_name ON stage;
CREATE UNIQUE INDEX stage_name ON stage (owner_id, name);
DROP INDEX company_name ON company;
CREATE UNIQUE INDEX company_name ON company (owner_id, name);
DROP INDEX value ON archive_reason;
CREATE UNIQUE INDEX archive_reason_value ON archive_reason (owner_id, value);
ALTER TABLE process ADD CONSTRAINT process_archive_reason
    FOREIGN KEY (owner_id, archive_reason) REFERENCES archive_reason (owner_id, value);
DROP INDEX archive_reason_name ON archive_reason;
CREATE UNIQUE INDEX archive_reason_name ON archive_reason (owner_id, name);
DROP INDEX document_name ON document;
CREATE UNIQUE INDEX document_name ON document (owner_id, name);
DROP INDEX tag_name ON tag;
CREATE UNIQUE INDEX tag_name ON tag (owner_id, name);
DROP INDEX gm_msgid ON email;
CREATE UNIQUE INDEX email_gm_msgid ON email (owner_id, gm_msgid);
DROP INDEX email_by_message_id ON email;
CREATE UNIQUE INDEX email_by_message_id ON email (owner_id, message_id);
DROP INDEX mail_ignore_value ON mail_ignore;
CREATE UNIQUE INDEX mail_ignore_value ON mail_ignore (owner_id, kind, value);
ALTER TABLE setting DROP PRIMARY KEY, ADD PRIMARY KEY (owner_id, name);

-- Each owner's rows, found quickly.
CREATE INDEX stage_by_owner ON stage (owner_id);
CREATE INDEX lane_by_owner ON lane (owner_id);
CREATE INDEX company_by_owner ON company (owner_id);
CREATE INDEX person_by_owner ON person (owner_id);
CREATE INDEX application_by_owner ON application (owner_id);
CREATE INDEX posting_by_owner ON posting (owner_id);
CREATE INDEX step_by_owner ON step (owner_id);
CREATE INDEX note_by_owner ON note (owner_id);
CREATE INDEX document_by_owner ON document (owner_id);
CREATE INDEX version_by_owner ON version (owner_id);
CREATE INDEX tag_by_owner ON tag (owner_id);
CREATE INDEX tagging_by_owner ON tagging (owner_id);
CREATE INDEX email_by_owner ON email (owner_id);
CREATE INDEX memo_by_owner ON memo (owner_id);
CREATE INDEX process_by_owner ON process (owner_id, status, stage_id, position);
CREATE INDEX activity_by_owner ON activity (owner_id);
