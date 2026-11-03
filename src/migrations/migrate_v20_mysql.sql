-- Schema 19 to 20 (MySQL): folded stages and swimlanes. See migrate_v20.sql.
ALTER TABLE stage ADD COLUMN folded BIGINT NOT NULL DEFAULT 0;
UPDATE stage SET folded = 1 WHERE active = 0;

-- The board's swimlanes. See migrate_v20.sql.
CREATE TABLE swimlane (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id   BIGINT NOT NULL DEFAULT 1,
    name       VARCHAR(255) NOT NULL,
    position   BIGINT NOT NULL DEFAULT 0,
    created_at LONGTEXT NOT NULL,
    updated_at LONGTEXT NOT NULL
);
CREATE UNIQUE INDEX swimlane_name ON swimlane (owner_id, name);
ALTER TABLE stage ADD COLUMN swimlane_id BIGINT NULL,
    ADD CONSTRAINT stage_swimlane FOREIGN KEY (swimlane_id) REFERENCES swimlane(id) ON DELETE SET NULL;
INSERT INTO swimlane (owner_id, name, position, created_at, updated_at)
    SELECT owner_id, 'Active Processes', 0, min(created_at), min(created_at) FROM stage GROUP BY owner_id;
INSERT INTO swimlane (owner_id, name, position, created_at, updated_at)
    SELECT owner_id, 'Terminated Processes', 1, min(created_at), min(created_at) FROM stage GROUP BY owner_id;
UPDATE stage SET swimlane_id = (SELECT w.id FROM swimlane w WHERE w.owner_id = stage.owner_id
                                AND w.position = CASE WHEN stage.active = 1 THEN 0 ELSE 1 END);
