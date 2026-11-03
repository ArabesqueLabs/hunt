-- Schema 17 to 18 (MySQL): cycles, reminders, links, prep and stories.
-- See migrate_v18.sql.
CREATE TABLE cycle (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id     BIGINT NOT NULL DEFAULT 1,
    name         LONGTEXT NOT NULL,
    description  LONGTEXT,
    started_on   LONGTEXT NOT NULL,
    ended_on     LONGTEXT,
    outcome      VARCHAR(255) CHECK (outcome IN ('offer', 'break', 'stopped', 'other')),
    outcome_note LONGTEXT,
    created_at   LONGTEXT NOT NULL,
    updated_at   LONGTEXT NOT NULL
);
CREATE INDEX cycle_by_owner ON cycle (owner_id);
INSERT INTO cycle (owner_id, name, started_on, created_at, updated_at)
    SELECT s.owner_id, 'My job search',
           substr(coalesce((SELECT min(p.created_at) FROM process p WHERE p.owner_id = s.owner_id),
                           min(s.created_at)), 1, 10),
           min(s.created_at), min(s.created_at)
    FROM stage s GROUP BY s.owner_id;
ALTER TABLE process ADD COLUMN cycle_id BIGINT NULL,
    ADD FOREIGN KEY (cycle_id) REFERENCES cycle(id);
UPDATE process SET cycle_id = (SELECT c.id FROM cycle c WHERE c.owner_id = process.owner_id);
CREATE INDEX process_by_cycle ON process (cycle_id);

CREATE TABLE reminder (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id   BIGINT NOT NULL DEFAULT 1,
    process_id BIGINT NOT NULL,
    title      LONGTEXT NOT NULL,
    due_at     LONGTEXT,
    done_at    LONGTEXT,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL,
    FOREIGN KEY (process_id) REFERENCES process(id) ON DELETE CASCADE
);
CREATE INDEX reminder_by_owner ON reminder (owner_id);
INSERT INTO reminder (owner_id, process_id, title, due_at, created_at, updated_at)
    SELECT owner_id, id, coalesce(nullif(trim(next_action), ''), 'Next action'), next_due,
           updated_at, updated_at
    FROM process
    WHERE nullif(trim(next_action), '') IS NOT NULL OR next_due IS NOT NULL;
UPDATE process SET next_action = NULL, next_due = NULL;

CREATE TABLE link (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id       BIGINT NOT NULL DEFAULT 1,
    application_id BIGINT NOT NULL,
    url            LONGTEXT NOT NULL,
    label          LONGTEXT,
    kind           VARCHAR(255) NOT NULL DEFAULT 'other'
                   CHECK (kind IN ('portal', 'prep', 'invite', 'company', 'other')),
    created_at     LONGTEXT NOT NULL,
    updated_at     LONGTEXT NOT NULL,
    FOREIGN KEY (application_id) REFERENCES application(id) ON DELETE CASCADE
);
CREATE INDEX link_by_owner ON link (owner_id);

ALTER TABLE step ADD COLUMN minutes BIGINT NULL,
    ADD COLUMN place LONGTEXT NULL,
    ADD COLUMN prep_note LONGTEXT NULL,
    ADD COLUMN remind VARCHAR(255) NULL,
    ADD CONSTRAINT step_remind_check CHECK (remind IN ('hour', 'day'));

CREATE TABLE prep_item (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id     BIGINT NOT NULL DEFAULT 1,
    title        LONGTEXT NOT NULL,
    url          LONGTEXT,
    kind         VARCHAR(255) NOT NULL DEFAULT 'read'
                 CHECK (kind IN ('read', 'watch', 'practise', 'exercise', 'mock', 'questions')),
    process_id   BIGINT NULL,
    step_id      BIGINT NULL,
    priority     VARCHAR(255) NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
    status       VARCHAR(255) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'closed')),
    minutes      BIGINT,
    due_on       LONGTEXT,
    repeats      VARCHAR(255) CHECK (repeats IN ('daily')),
    streak       BIGINT NOT NULL DEFAULT 0,
    last_done_on LONGTEXT,
    confidence   VARCHAR(255) CHECK (confidence IN ('shaky', 'ok', 'solid')),
    created_at   LONGTEXT NOT NULL,
    updated_at   LONGTEXT NOT NULL,
    FOREIGN KEY (process_id) REFERENCES process(id) ON DELETE CASCADE,
    FOREIGN KEY (step_id) REFERENCES step(id) ON DELETE SET NULL
);
CREATE INDEX prep_item_by_owner ON prep_item (owner_id);

CREATE TABLE story (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id   BIGINT NOT NULL DEFAULT 1,
    title      LONGTEXT NOT NULL,
    situation  LONGTEXT,
    task       LONGTEXT,
    action     LONGTEXT,
    result     LONGTEXT,
    themes     LONGTEXT,
    told       LONGTEXT,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL
);
CREATE INDEX story_by_owner ON story (owner_id);
