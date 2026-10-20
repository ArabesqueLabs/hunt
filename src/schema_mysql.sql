-- hunt schema for MySQL (8.0.16 or later), version 11: the same tables as
-- schema.sql (SQLite), which explains them. Differences: ids count up by
-- themselves, files are LONGBLOB, text that is a key or unique is VARCHAR,
-- and the default collation (utf8mb4, case-insensitive) makes names unique
-- regardless of case.

CREATE TABLE hunt_meta (
    name  VARCHAR(255) PRIMARY KEY,
    value LONGTEXT
);

CREATE TABLE stage (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    position   BIGINT NOT NULL,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL
);
CREATE UNIQUE INDEX stage_name ON stage (name);

-- A stage's column divided by outcome (Offer: accepted, shortlisted,
-- rejected): its lanes, top to bottom. A process may be in one of its
-- stage's lanes; none is the column's undivided top.
CREATE TABLE lane (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    stage_id   BIGINT NOT NULL,
    name       LONGTEXT NOT NULL,
    position   BIGINT NOT NULL DEFAULT 0,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL,
    FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
);
CREATE INDEX lane_by_stage ON lane (stage_id, position);

CREATE TABLE stored_file (
    sha256 VARCHAR(255) PRIMARY KEY,
    data   LONGBLOB NOT NULL
);

CREATE TABLE company (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    kind          VARCHAR(255) NOT NULL DEFAULT 'employer' CHECK (kind IN ('employer', 'agency')),
    website       LONGTEXT,
    note          LONGTEXT,
    created_at    LONGTEXT NOT NULL,
    updated_at    LONGTEXT NOT NULL,
    linkedin      LONGTEXT,
    description   LONGTEXT,
    industry      LONGTEXT,
    size          LONGTEXT,
    headquarters  LONGTEXT,
    founded       LONGTEXT,
    logo          VARCHAR(255),
    logo_type     VARCHAR(255),
    email_domains LONGTEXT,
    FOREIGN KEY (logo) REFERENCES stored_file(sha256)
);
CREATE UNIQUE INDEX company_name ON company (name);

CREATE TABLE person (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    name       LONGTEXT NOT NULL,
    company_id BIGINT,
    title      LONGTEXT,
    email      LONGTEXT,
    phone      LONGTEXT,
    link       LONGTEXT,
    note       LONGTEXT,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL,
    linkedin   LONGTEXT,
    location   LONGTEXT,
    about      LONGTEXT,
    photo      VARCHAR(255),
    photo_type VARCHAR(255),
    FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE SET NULL,
    FOREIGN KEY (photo) REFERENCES stored_file(sha256)
);

CREATE TABLE application (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    company_id     BIGINT NOT NULL,
    title          LONGTEXT,
    source         LONGTEXT,
    url            LONGTEXT,
    location       LONGTEXT,
    work_mode      VARCHAR(255) CHECK (work_mode IN ('remote', 'hybrid', 'onsite')),
    employment     VARCHAR(255) CHECK (employment IN ('full-time', 'part-time', 'contract', 'temporary', 'internship')),
    salary_min     BIGINT,
    salary_max     BIGINT,
    currency       VARCHAR(255),
    pay_period     VARCHAR(255) CHECK (pay_period IN ('year', 'month', 'day', 'hour')),
    comp           LONGTEXT,
    posted_on      LONGTEXT,
    closes_on      LONGTEXT,
    via_id         BIGINT,
    description    LONGTEXT,
    note           LONGTEXT,
    created_at     LONGTEXT NOT NULL,
    updated_at     LONGTEXT NOT NULL,
    salary_min_gbp BIGINT,
    salary_max_gbp BIGINT,
    gbp_rate       DOUBLE,
    gbp_rate_on    LONGTEXT,
    bonus          LONGTEXT,
    equity         LONGTEXT,
    FOREIGN KEY (company_id) REFERENCES company(id),
    FOREIGN KEY (via_id) REFERENCES application(id) ON DELETE SET NULL
);

-- The same job posted elsewhere (LinkedIn, a careers page, an agency): an
-- application's other postings, each with what it says. Its own `url` and
-- `description` are its main posting.
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

CREATE TABLE archive_reason (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    value      VARCHAR(255) NOT NULL UNIQUE,
    name       VARCHAR(255) NOT NULL,
    position   BIGINT NOT NULL,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL
);
CREATE UNIQUE INDEX archive_reason_name ON archive_reason (name);

CREATE TABLE process (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NOT NULL,
    stage_id       BIGINT NOT NULL,
    position       BIGINT NOT NULL DEFAULT 0,
    status         VARCHAR(255) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    archive_reason VARCHAR(255),
    archive_note   LONGTEXT,
    next_action    LONGTEXT,
    next_due       LONGTEXT,
    applied_on     LONGTEXT,
    note           LONGTEXT,
    created_at     LONGTEXT NOT NULL,
    updated_at     LONGTEXT NOT NULL,
    mail_query     LONGTEXT,
    mail_label     LONGTEXT,
    lane_id        BIGINT NULL,
    FOREIGN KEY (application_id) REFERENCES application(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_id) REFERENCES stage(id),
    FOREIGN KEY (lane_id) REFERENCES lane(id) ON DELETE SET NULL,
    FOREIGN KEY (archive_reason) REFERENCES archive_reason(value)
);
CREATE INDEX process_by_column ON process (status, stage_id, position);

CREATE TABLE process_person (
    process_id BIGINT NOT NULL,
    person_id  BIGINT NOT NULL,
    role       VARCHAR(255) CHECK (role IN ('recruiter', 'hiring-manager', 'interviewer', 'referrer', 'other')),
    PRIMARY KEY (process_id, person_id),
    FOREIGN KEY (process_id) REFERENCES process(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE CASCADE
);

CREATE TABLE step (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    process_id BIGINT NOT NULL,
    title      LONGTEXT NOT NULL,
    at         LONGTEXT,
    status     VARCHAR(255) NOT NULL DEFAULT 'scheduled'
               CHECK (status IN ('scheduled', 'done', 'passed', 'failed', 'cancelled')),
    note       LONGTEXT,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL,
    format         LONGTEXT,
    attendees      LONGTEXT,
    FOREIGN KEY (process_id) REFERENCES process(id) ON DELETE CASCADE
);

CREATE TABLE note (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    process_id BIGINT NOT NULL,
    body       LONGTEXT NOT NULL,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL,
    happened_on    LONGTEXT,
    FOREIGN KEY (process_id) REFERENCES process(id) ON DELETE CASCADE
);

-- Who an interview step is with.
CREATE TABLE step_person (
    step_id   BIGINT NOT NULL,
    person_id BIGINT NOT NULL,
    PRIMARY KEY (step_id, person_id),
    FOREIGN KEY (step_id) REFERENCES step(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE CASCADE
);
CREATE INDEX step_person_by_person ON step_person (person_id);

CREATE TABLE document (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    kind        VARCHAR(255) NOT NULL DEFAULT 'resume'
                CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'screenshot', 'offer',
                              'contract', 'candidate-resource', 'feedback', 'other')),
    description LONGTEXT,
    created_at  LONGTEXT NOT NULL,
    updated_at  LONGTEXT NOT NULL
);
CREATE UNIQUE INDEX document_name ON document (name);

CREATE TABLE version (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    document_id  BIGINT NOT NULL,
    number       BIGINT NOT NULL,
    tag          LONGTEXT,
    note         LONGTEXT,
    filename     LONGTEXT NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    size         BIGINT NOT NULL,
    sha256       VARCHAR(255) NOT NULL,
    created_at   LONGTEXT NOT NULL,
    updated_at   LONGTEXT NOT NULL,
    UNIQUE (document_id, number),
    FOREIGN KEY (document_id) REFERENCES document(id) ON DELETE CASCADE,
    FOREIGN KEY (sha256) REFERENCES stored_file(sha256)
);

CREATE TABLE process_file (
    process_id BIGINT NOT NULL,
    version_id BIGINT NOT NULL,
    added_at   LONGTEXT NOT NULL,
    PRIMARY KEY (process_id, version_id),
    FOREIGN KEY (process_id) REFERENCES process(id) ON DELETE CASCADE,
    FOREIGN KEY (version_id) REFERENCES version(id)
);

CREATE TABLE fx_rate (
    currency   VARCHAR(255) PRIMARY KEY,
    rate       DOUBLE NOT NULL,
    rate_on    LONGTEXT NOT NULL,
    fetched_at LONGTEXT NOT NULL
);

CREATE TABLE tag (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    color      VARCHAR(255),
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL
);
CREATE UNIQUE INDEX tag_name ON tag (name);

CREATE TABLE tagging (
    tag_id    BIGINT NOT NULL,
    entity    VARCHAR(255) NOT NULL,
    entity_id BIGINT NOT NULL,
    PRIMARY KEY (tag_id, entity, entity_id),
    FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
);
CREATE INDEX tagging_by_entity ON tagging (entity, entity_id);

CREATE TABLE email (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    process_id  BIGINT,
    status      VARCHAR(255) NOT NULL CHECK (status IN ('linked', 'triage', 'ignored')),
    message_id  VARCHAR(700),
    gm_msgid    VARCHAR(255) UNIQUE,
    gm_thrid    VARCHAR(255),
    from_addr   LONGTEXT,
    from_name   LONGTEXT,
    to_addrs    LONGTEXT,
    cc_addrs    LONGTEXT,
    subject     LONGTEXT,
    snippet     LONGTEXT,
    body        LONGTEXT,
    sent_at     VARCHAR(255) NOT NULL,
    outgoing    BIGINT NOT NULL DEFAULT 0,
    labels      LONGTEXT,
    matched_by  VARCHAR(255),
    suggestions LONGTEXT,
    created_at  LONGTEXT NOT NULL,
    updated_at  LONGTEXT NOT NULL,
    FOREIGN KEY (process_id) REFERENCES process(id) ON DELETE CASCADE
);
CREATE INDEX email_by_process ON email (process_id, sent_at);
CREATE INDEX email_by_thread ON email (gm_thrid);
CREATE UNIQUE INDEX email_by_message_id ON email (message_id);

CREATE TABLE mail_ignore (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    kind       VARCHAR(255) NOT NULL CHECK (kind IN ('sender', 'domain')),
    value      VARCHAR(255) NOT NULL,
    created_at LONGTEXT NOT NULL
);
CREATE UNIQUE INDEX mail_ignore_value ON mail_ignore (kind, value);

CREATE TABLE setting (
    name  VARCHAR(255) PRIMARY KEY,
    value LONGTEXT
);

-- General notes: about the search, not one application.
CREATE TABLE memo (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    title      LONGTEXT,
    body       LONGTEXT NOT NULL,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL
);


CREATE TABLE activity (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    at         LONGTEXT NOT NULL,
    entity     VARCHAR(255) NOT NULL,
    entity_id  BIGINT NOT NULL,
    process_id BIGINT,
    action     VARCHAR(255) NOT NULL CHECK (action IN ('created', 'updated', 'moved', 'deleted')),
    summary    LONGTEXT NOT NULL,
    changes    LONGTEXT
);
CREATE INDEX activity_by_entity ON activity (entity, entity_id);
CREATE INDEX activity_by_process ON activity (process_id);
