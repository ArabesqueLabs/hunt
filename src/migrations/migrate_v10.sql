-- Schema 9 to 10, for every database: who an interview step is with, as
-- people (the step's free-text `attendees` stays, for what was written
-- before).
CREATE TABLE step_person (
    step_id   BIGINT NOT NULL,
    person_id BIGINT NOT NULL,
    PRIMARY KEY (step_id, person_id),
    FOREIGN KEY (step_id) REFERENCES step(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE CASCADE
);
CREATE INDEX step_person_by_person ON step_person (person_id);
