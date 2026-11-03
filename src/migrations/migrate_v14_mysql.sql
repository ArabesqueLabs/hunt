-- Schema 13 to 14 (MySQL): lanes. See migrate_v14.sql.
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
ALTER TABLE process ADD COLUMN lane_id BIGINT NULL,
    ADD FOREIGN KEY (lane_id) REFERENCES lane(id) ON DELETE SET NULL;
