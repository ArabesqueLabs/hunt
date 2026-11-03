-- Schema 27 to 28 (SQLite): a prep item's description, beside its title;
-- and the lists admins can change (work modes, kinds of employment, a
-- step's statuses, people's roles, kinds of file) checked by hunt rather
-- than by the database, so they can grow. SQLite can't drop a CHECK in
-- place, so those tables are rebuilt, as in migrate_v16.sql; what refers
-- to them keeps doing so by name.
ALTER TABLE prep_item ADD COLUMN description TEXT;

CREATE TABLE application_new (
    id          INTEGER PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    title       TEXT,
    source      TEXT,
    url         TEXT,
    location    TEXT,
    work_mode   TEXT,
    employment  TEXT,
    salary_min  INTEGER,
    salary_max  INTEGER,
    currency    TEXT,
    pay_period  TEXT CHECK (pay_period IN ('year', 'month', 'day', 'hour')),
    comp        TEXT,
    posted_on   TEXT,
    closes_on   TEXT,
    via_id      INTEGER REFERENCES application(id) ON DELETE SET NULL,
    description TEXT,
    note        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    -- The pay range in GBP, converted when the pay or currency was set,
    -- at `gbp_rate` (GBP per unit of `currency`) on `gbp_rate_on`.
    salary_min_gbp INTEGER,
    salary_max_gbp INTEGER,
    gbp_rate       REAL,
    gbp_rate_on    TEXT,
    bonus          TEXT,
    equity         TEXT,
    owner_id    INTEGER NOT NULL DEFAULT 1,
    reference   TEXT
);
INSERT INTO application_new SELECT id, company_id, title, source, url, location, work_mode,
    employment, salary_min, salary_max, currency, pay_period, comp, posted_on, closes_on, via_id,
    description, note, created_at, updated_at, salary_min_gbp, salary_max_gbp, gbp_rate,
    gbp_rate_on, bonus, equity, owner_id, reference FROM application;
DROP TABLE application;
ALTER TABLE application_new RENAME TO application;
CREATE INDEX application_by_owner ON application (owner_id);

CREATE TABLE step_new (
    id         INTEGER PRIMARY KEY,
    process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    at         TEXT,
    status     TEXT NOT NULL DEFAULT 'scheduled',
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    format     TEXT,
    attendees  TEXT,
    owner_id   INTEGER NOT NULL DEFAULT 1,
    minutes    INTEGER,
    place      TEXT,
    prep_note  TEXT,
    remind     TEXT CHECK (remind IN ('hour', 'day'))
);
INSERT INTO step_new SELECT id, process_id, title, at, status, note, created_at, updated_at,
    format, attendees, owner_id, minutes, place, prep_note, remind FROM step;
DROP TABLE step;
ALTER TABLE step_new RENAME TO step;
CREATE INDEX step_by_owner ON step (owner_id);

CREATE TABLE process_person_new (
    process_id INTEGER NOT NULL REFERENCES process(id) ON DELETE CASCADE,
    person_id  INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    role       TEXT,
    owner_id   INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (process_id, person_id)
);
INSERT INTO process_person_new SELECT process_id, person_id, role, owner_id FROM process_person;
DROP TABLE process_person;
ALTER TABLE process_person_new RENAME TO process_person;

CREATE TABLE document_new (
    id          INTEGER PRIMARY KEY,
    owner_id    INTEGER NOT NULL DEFAULT 1,
    name        TEXT NOT NULL COLLATE NOCASE,
    kind        TEXT NOT NULL DEFAULT 'resume',
    description TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (owner_id, name)
);
INSERT INTO document_new SELECT id, owner_id, name, kind, description, created_at, updated_at
    FROM document;
DROP TABLE document;
ALTER TABLE document_new RENAME TO document;
CREATE INDEX document_by_owner ON document (owner_id);
