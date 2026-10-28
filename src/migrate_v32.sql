-- Schema 31 to 32 (SQLite): personal access tokens.
--
-- A token lets something outside the browser act as an account: the
-- browser extension, an iOS Shortcut, a script. Only its SHA-256 is kept;
-- the token itself is shown once, when it's made. `scope` is what it may
-- do: 'stash', only add to the stash; 'full', what the account can (but
-- never manage tokens, or the admin centre).
CREATE TABLE api_token (
    id           INTEGER PRIMARY KEY,
    account_id   INTEGER NOT NULL REFERENCES account(id),
    name         TEXT NOT NULL,
    token_sha256 TEXT NOT NULL UNIQUE,
    hint         TEXT NOT NULL,
    scope        TEXT NOT NULL DEFAULT 'stash' CHECK (scope IN ('stash', 'full')),
    created_at   TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at   TEXT
);
CREATE INDEX api_token_by_account ON api_token (account_id);
