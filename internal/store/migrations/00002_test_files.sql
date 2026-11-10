-- +goose Up
-- The SHA-256 of each .klats file a test was opened from or exported to, so
-- opening such a file again finds the test instead of copying it.
CREATE TABLE test_files (
    sha256  BLOB PRIMARY KEY,
    test_id TEXT NOT NULL REFERENCES tests (id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE test_files;
