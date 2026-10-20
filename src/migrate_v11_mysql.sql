-- Schema 10 to 11 (MySQL): general notes, about the search rather than one
-- application. See migrate_v11.sql.
CREATE TABLE memo (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    title      LONGTEXT,
    body       LONGTEXT NOT NULL,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL
);
