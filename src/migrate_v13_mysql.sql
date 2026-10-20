-- Schema 12 to 13 (MySQL): an application's other postings. See
-- migrate_v13.sql.
CREATE TABLE posting (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NOT NULL,
    url            LONGTEXT NOT NULL,
    platform       LONGTEXT,
    description    LONGTEXT,
    read_at        LONGTEXT,
    created_at     LONGTEXT NOT NULL,
    updated_at     LONGTEXT NOT NULL,
    FOREIGN KEY (application_id) REFERENCES application(id) ON DELETE CASCADE
);
CREATE INDEX posting_by_application ON posting (application_id);
