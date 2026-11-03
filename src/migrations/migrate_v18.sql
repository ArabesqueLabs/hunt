-- Schema 17 to 18 (SQLite): cycles, reminders, links, prep and stories.
--
-- A cycle is one job search: Autumn 2026, or Remote, Europe. Several can run
-- at once; one that has ended keeps its board as it was. Every process is in
-- one. What's here becomes one cycle per account, started when its first
-- process was added.
CREATE TABLE cycle (
    id           INTEGER PRIMARY KEY,
    owner_id     INTEGER NOT NULL DEFAULT 1,
    name         TEXT NOT NULL,
    description  TEXT,
    started_on   TEXT NOT NULL,
    -- Set when it ends, with how it ended.
    ended_on     TEXT,
    outcome      TEXT CHECK (outcome IN ('offer', 'break', 'stopped', 'other')),
    outcome_note TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX cycle_by_owner ON cycle (owner_id);
INSERT INTO cycle (owner_id, name, started_on, created_at, updated_at)
    SELECT s.owner_id, 'My job search',
           substr(coalesce((SELECT min(p.created_at) FROM process p WHERE p.owner_id = s.owner_id),
                           min(s.created_at)), 1, 10),
           min(s.created_at), min(s.created_at)
    FROM stage s GROUP BY s.owner_id;
ALTER TABLE process ADD COLUMN cycle_id INTEGER REFERENCES cycle(id);
UPDATE process SET cycle_id = (SELECT c.id FROM cycle c WHERE c.owner_id = process.owner_id);
CREATE INDEX process_by_cycle ON process (cycle_id);

-- Something to do for a process, by a date: chase, send references. Done
-- when `done_at` is set. A process's next action becomes one.
CREATE TABLE reminder (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL DEFAULT 1,
    process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    due_at     TEXT,
    done_at    TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX reminder_by_owner ON reminder (owner_id);
CREATE INDEX reminder_by_process ON reminder (process_id);
INSERT INTO reminder (owner_id, process_id, title, due_at, created_at, updated_at)
    SELECT owner_id, id, coalesce(nullif(trim(next_action), ''), 'Next action'), next_due,
           updated_at, updated_at
    FROM process
    WHERE nullif(trim(next_action), '') IS NOT NULL OR next_due IS NOT NULL;
UPDATE process SET next_action = NULL, next_due = NULL;

-- Links kept with an application: its candidate portal, prep material, an
-- interview's invite.
CREATE TABLE link (
    id             INTEGER PRIMARY KEY,
    owner_id       INTEGER NOT NULL DEFAULT 1,
    application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
    url            TEXT NOT NULL,
    label          TEXT,
    kind           TEXT NOT NULL DEFAULT 'other'
                   CHECK (kind IN ('portal', 'prep', 'invite', 'company', 'other')),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX link_by_owner ON link (owner_id);
CREATE INDEX link_by_application ON link (application_id);

-- An interview step's length, where it is (a joining link or an address),
-- what to prepare, and when to be reminded.
ALTER TABLE step ADD COLUMN minutes INTEGER;
ALTER TABLE step ADD COLUMN place TEXT;
ALTER TABLE step ADD COLUMN prep_note TEXT;
ALTER TABLE step ADD COLUMN remind TEXT CHECK (remind IN ('hour', 'day'));

-- Something to read, practise or rehearse: for a process (an interview
-- step of it, even), or in general. A daily one keeps a streak.
CREATE TABLE prep_item (
    id           INTEGER PRIMARY KEY,
    owner_id     INTEGER NOT NULL DEFAULT 1,
    title        TEXT NOT NULL,
    url          TEXT,
    kind         TEXT NOT NULL DEFAULT 'read'
                 CHECK (kind IN ('read', 'watch', 'practise', 'exercise', 'mock', 'questions')),
    process_id   INTEGER REFERENCES process(id) ON DELETE CASCADE,
    step_id      INTEGER REFERENCES step(id) ON DELETE SET NULL,
    priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
    -- Closed: its process's cycle ended before it was done.
    status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'closed')),
    minutes      INTEGER,
    due_on       TEXT,
    repeats      TEXT CHECK (repeats IN ('daily')),
    streak       INTEGER NOT NULL DEFAULT 0,
    last_done_on TEXT,
    confidence   TEXT CHECK (confidence IN ('shaky', 'ok', 'solid')),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX prep_item_by_owner ON prep_item (owner_id);
CREATE INDEX prep_item_by_process ON prep_item (process_id);

-- A story from work, for behavioural questions: situation, task, action
-- and result, written once and told again.
CREATE TABLE story (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL DEFAULT 1,
    title      TEXT NOT NULL,
    situation  TEXT,
    task       TEXT,
    action     TEXT,
    result     TEXT,
    themes     TEXT,
    told       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX story_by_owner ON story (owner_id);
