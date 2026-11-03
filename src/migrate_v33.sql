-- Schema 32 to 33 (SQLite): an interview's links, its phone and address.
-- Its links, beyond the one to join by: a coding pad, a take-home's brief,
-- a candidate portal. Each has a name and a URL, in the order they were
-- written.
CREATE TABLE step_link (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL DEFAULT 1,
    step_id    INTEGER NOT NULL REFERENCES step(id) ON DELETE CASCADE,
    label      TEXT,
    url        TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX step_link_by_step ON step_link (step_id, position);

-- And beside its joining link, a number to call (a dial-in, or a call's
-- backup) and an address to go to; an address written as its joining link
-- before is moved to `address` as the interview is next saved.
ALTER TABLE step ADD COLUMN phone TEXT;
ALTER TABLE step ADD COLUMN address TEXT;
