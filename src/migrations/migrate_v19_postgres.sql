-- Schema 18 to 19 (PostgreSQL): closing is a stage. See migrate_v19.sql.
ALTER TABLE stage ADD COLUMN active BIGINT NOT NULL DEFAULT 1;
ALTER TABLE lane ADD COLUMN value TEXT;

INSERT INTO stage (owner_id, name, position, active, created_at, updated_at)
    SELECT s.owner_id,
           CASE WHEN EXISTS (SELECT 1 FROM stage t WHERE t.owner_id = s.owner_id AND lower(t.name) = 'my decision')
                THEN 'My Decision (closed)' ELSE 'My Decision' END,
           max(s.position) + 1, 0, min(s.created_at), min(s.created_at)
    FROM stage s GROUP BY s.owner_id;
INSERT INTO stage (owner_id, name, position, active, created_at, updated_at)
    SELECT s.owner_id,
           CASE WHEN EXISTS (SELECT 1 FROM stage t WHERE t.owner_id = s.owner_id AND lower(t.name) = 'their decision')
                THEN 'Their Decision (closed)' ELSE 'Their Decision' END,
           max(s.position) + 1, 0, min(s.created_at), min(s.created_at)
    FROM stage s GROUP BY s.owner_id;
INSERT INTO stage (owner_id, name, position, active, created_at, updated_at)
    SELECT s.owner_id,
           CASE WHEN EXISTS (SELECT 1 FROM stage t WHERE t.owner_id = s.owner_id AND lower(t.name) = 'paused / stopped')
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

-- A process's reason is its lane's code now, not a row of archive_reason.
ALTER TABLE process DROP CONSTRAINT process_archive_reason_fkey;
-- The last active stage it was in: how far a closed one got.
ALTER TABLE process ADD COLUMN reached_stage_id BIGINT REFERENCES stage(id) ON DELETE SET NULL;
UPDATE process SET reached_stage_id = stage_id;

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

