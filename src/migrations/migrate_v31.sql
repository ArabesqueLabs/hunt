-- Schema 30 to 31 (SQLite): the stash, and email triage gone.
--
-- Mail that waited in triage is kept as ignored (seen, about no process),
-- and the senders ignored from there go with it. `email.suggestions` is
-- no longer written; it stays, so older backups still fit.
UPDATE email SET status = 'ignored' WHERE status = 'triage';
UPDATE email SET suggestions = NULL;
DROP TABLE mail_ignore;

-- Anything kept to sort later: a link, some text, a file, an email. Sorted,
-- it becomes something in hunt (`result_entity`, `result_id`), or is
-- dismissed.
CREATE TABLE stash_item (
    id            INTEGER PRIMARY KEY,
    owner_id      INTEGER NOT NULL DEFAULT 1,
    kind          TEXT NOT NULL CHECK (kind IN ('link', 'text', 'file', 'email')),
    url           TEXT,
    title         TEXT,
    body          TEXT,
    file_sha256   TEXT REFERENCES stored_file(sha256),
    filename      TEXT,
    content_type  TEXT,
    source        TEXT NOT NULL DEFAULT 'app'
                  CHECK (source IN ('app', 'bookmarklet', 'share', 'shortcut', 'email', 'extension', 'cli', 'api')),
    meta          TEXT,
    suggestion    TEXT,
    status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done', 'dismissed')),
    result_entity TEXT,
    result_id     INTEGER,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    done_at       TEXT
);
CREATE INDEX stash_item_by_owner ON stash_item (owner_id, status);
