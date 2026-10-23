-- +goose Up
ALTER TABLE answers RENAME COLUMN option_ids TO value;
UPDATE answers SET value = json_object('items', json(value));
-- +goose Down
UPDATE answers SET value = coalesce(json_extract(value, '$.items'), '[]');
ALTER TABLE answers RENAME COLUMN value TO option_ids;
