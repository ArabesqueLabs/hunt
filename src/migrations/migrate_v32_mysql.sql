-- Schema 31 to 32 (MySQL): personal access tokens. See migrate_v32.sql.
CREATE TABLE api_token (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    account_id   BIGINT NOT NULL,
    name         LONGTEXT NOT NULL,
    token_sha256 VARCHAR(64) NOT NULL UNIQUE,
    hint         VARCHAR(255) NOT NULL,
    scope        VARCHAR(255) NOT NULL DEFAULT 'stash' CHECK (scope IN ('stash', 'full')),
    created_at   LONGTEXT NOT NULL,
    last_used_at LONGTEXT,
    revoked_at   LONGTEXT,
    FOREIGN KEY (account_id) REFERENCES account(id)
);
CREATE INDEX api_token_by_account ON api_token (account_id);
