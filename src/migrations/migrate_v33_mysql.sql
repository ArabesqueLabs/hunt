-- Schema 32 to 33 (MySQL): an interview's links, its phone and address. See migrate_v33.sql.
CREATE TABLE step_link (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id   BIGINT NOT NULL DEFAULT 1,
    step_id    BIGINT NOT NULL,
    label      LONGTEXT,
    url        LONGTEXT NOT NULL,
    position   BIGINT NOT NULL DEFAULT 0,
    FOREIGN KEY (step_id) REFERENCES step(id) ON DELETE CASCADE
);
CREATE INDEX step_link_by_step ON step_link (step_id, position);

-- And beside its joining link, a number to call (a dial-in, or a call's
-- backup) and an address to go to; an address written as its joining link
-- before is moved to `address` as the interview is next saved.
ALTER TABLE step ADD COLUMN phone LONGTEXT NULL;
ALTER TABLE step ADD COLUMN address LONGTEXT NULL;
