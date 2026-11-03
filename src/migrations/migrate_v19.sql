-- Schema 18 to 19 (SQLite): closing is a stage.
--
-- A stage is active (a column on the board) or not; a process in an
-- inactive stage is closed, and the lane it's in says why. Each account's
-- reasons for closing become the lanes of three new inactive stages (My
-- Decision, Their Decision, Paused / Stopped), and its closed processes move
-- there, into their reason's lane. Every process keeps the last active stage
-- it reached, so how far a closed one got is still known.
ALTER TABLE stage ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
-- What a lane stands for when it's a reason for closing: a code (rejected,
-- accepted …), kept from the reason it was. hunt's own codes mean something
-- (accepted: the job started); a lane added since has none.
ALTER TABLE lane ADD COLUMN value TEXT;

INSERT INTO stage (owner_id, name, position, active, created_at, updated_at)
    SELECT s.owner_id,
           CASE WHEN EXISTS (SELECT 1 FROM stage t WHERE t.owner_id = s.owner_id AND t.name = 'My Decision')
                THEN 'My Decision (closed)' ELSE 'My Decision' END,
           max(s.position) + 1, 0, min(s.created_at), min(s.created_at)
    FROM stage s GROUP BY s.owner_id;
INSERT INTO stage (owner_id, name, position, active, created_at, updated_at)
    SELECT s.owner_id,
           CASE WHEN EXISTS (SELECT 1 FROM stage t WHERE t.owner_id = s.owner_id AND t.name = 'Their Decision')
                THEN 'Their Decision (closed)' ELSE 'Their Decision' END,
           max(s.position) + 1, 0, min(s.created_at), min(s.created_at)
    FROM stage s GROUP BY s.owner_id;
INSERT INTO stage (owner_id, name, position, active, created_at, updated_at)
    SELECT s.owner_id,
           CASE WHEN EXISTS (SELECT 1 FROM stage t WHERE t.owner_id = s.owner_id AND t.name = 'Paused / Stopped')
                THEN 'Paused / Stopped (closed)' ELSE 'Paused / Stopped' END,
           max(s.position) + 1, 0, min(s.created_at), min(s.created_at)
    FROM stage s GROUP BY s.owner_id;
-- Each reason a lane of the stage it belongs with; one of the account's own
-- (no code of hunt's) with Paused / Stopped.
INSERT INTO lane (owner_id, stage_id, name, value, position, created_at, updated_at)
    SELECT r.owner_id,
           (SELECT s.id FROM stage s WHERE s.owner_id = r.owner_id AND s.active = 0 AND s.name LIKE
                CASE WHEN r.value IN ('withdrew', 'declined', 'reneged', 'accepted') THEN 'My Decision%'
                     WHEN r.value IN ('rejected', 'role-filled', 'role-closed', 'rescinded', 'failed-checks') THEN 'Their Decision%'
                     ELSE 'Paused / Stopped%' END),
           r.name, r.value, r.position, r.created_at, r.updated_at
    FROM archive_reason r;
INSERT INTO lane (owner_id, stage_id, name, value, position, created_at, updated_at)
    SELECT s.owner_id, s.id, 'On hold', 'paused', -1, s.created_at, s.created_at
    FROM stage s
    WHERE s.active = 0 AND s.name LIKE 'Paused / Stopped%'
      AND NOT EXISTS (SELECT 1 FROM archive_reason r WHERE r.owner_id = s.owner_id AND r.value = 'paused');

-- A process's reason is its lane's code now, not a row of archive_reason:
-- the table is rebuilt without that reference, with the stage reached.
CREATE TABLE process_new (
    id               INTEGER PRIMARY KEY,
    owner_id         INTEGER NOT NULL DEFAULT 1,
    application_id   INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
    stage_id         INTEGER NOT NULL REFERENCES stage(id),
    position         INTEGER NOT NULL DEFAULT 0,
    -- Kept by hunt from the stage: archived (closed) in an inactive one.
    status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    -- Kept by hunt from the lane, while closed: its code.
    archive_reason   TEXT,
    archive_note     TEXT,
    next_action      TEXT,
    next_due         TEXT,
    applied_on       TEXT,
    note             TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    mail_query       TEXT,
    mail_label       TEXT,
    lane_id          INTEGER REFERENCES lane(id) ON DELETE SET NULL,
    cycle_id         INTEGER REFERENCES cycle(id),
    -- The last active stage it was in: how far a closed one got.
    reached_stage_id INTEGER REFERENCES stage(id) ON DELETE SET NULL
);
INSERT INTO process_new (id, owner_id, application_id, stage_id, position, status, archive_reason,
                         archive_note, next_action, next_due, applied_on, note, created_at, updated_at,
                         mail_query, mail_label, lane_id, cycle_id, reached_stage_id)
    SELECT id, owner_id, application_id, stage_id, position, status, archive_reason,
           archive_note, next_action, next_due, applied_on, note, created_at, updated_at,
           mail_query, mail_label, lane_id, cycle_id, stage_id
    FROM process;
DROP TABLE process;
ALTER TABLE process_new RENAME TO process;
CREATE INDEX process_by_column ON process (owner_id, status, stage_id, position);
CREATE INDEX process_by_cycle ON process (cycle_id);

UPDATE process SET
    lane_id = (SELECT l.id FROM lane l JOIN stage s ON s.id = l.stage_id
               WHERE s.owner_id = process.owner_id AND s.active = 0 AND l.value = process.archive_reason)
WHERE status = 'archived';
UPDATE process SET
    stage_id = coalesce((SELECT l.stage_id FROM lane l WHERE l.id = process.lane_id),
                        (SELECT s.id FROM stage s WHERE s.owner_id = process.owner_id
                         AND s.active = 0 AND s.name LIKE 'Paused / Stopped%'))
WHERE status = 'archived';

DROP TABLE archive_reason;

