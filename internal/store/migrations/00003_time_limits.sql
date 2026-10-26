-- +goose Up
ALTER TABLE sittings ADD COLUMN ends_at INTEGER;
ALTER TABLE participants ADD COLUMN extra_ms INTEGER NOT NULL DEFAULT 0;
-- +goose Down
ALTER TABLE participants DROP COLUMN extra_ms;
ALTER TABLE sittings DROP COLUMN ends_at;
