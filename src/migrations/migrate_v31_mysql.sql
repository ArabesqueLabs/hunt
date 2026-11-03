-- Schema 30 to 31 (MySQL): the stash, and email triage gone. See
-- migrate_v31.sql.
UPDATE email SET status = 'ignored' WHERE status = 'triage';
UPDATE email SET suggestions = NULL;
DROP TABLE mail_ignore;

CREATE TABLE stash_item (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id      BIGINT NOT NULL DEFAULT 1,
    kind          VARCHAR(255) NOT NULL CHECK (kind IN ('link', 'text', 'file', 'email')),
    url           LONGTEXT,
    title         LONGTEXT,
    body          LONGTEXT,
    file_sha256   VARCHAR(255),
    filename      LONGTEXT,
    content_type  LONGTEXT,
    source        VARCHAR(255) NOT NULL DEFAULT 'app'
                  CHECK (source IN ('app', 'bookmarklet', 'share', 'shortcut', 'email', 'extension', 'cli', 'api')),
    meta          LONGTEXT,
    suggestion    LONGTEXT,
    status        VARCHAR(255) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done', 'dismissed')),
    result_entity VARCHAR(255),
    result_id     BIGINT,
    created_at    LONGTEXT NOT NULL,
    updated_at    LONGTEXT NOT NULL,
    done_at       LONGTEXT,
    FOREIGN KEY (file_sha256) REFERENCES stored_file(sha256)
);
CREATE INDEX stash_item_by_owner ON stash_item (owner_id, status);
