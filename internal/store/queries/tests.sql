-- name: InsertTest :exec
INSERT INTO tests (id, title, doc, created_at, updated_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetTest :one
SELECT * FROM tests WHERE id = ?;

-- name: ListTests :many
SELECT * FROM tests ORDER BY updated_at DESC, id;

-- name: UpdateTest :execrows
UPDATE tests SET title = ?, doc = ?, updated_at = ? WHERE id = ?;

-- name: DeleteTest :execrows
DELETE FROM tests WHERE id = ?;

-- name: GetTestByFile :one
SELECT tests.* FROM tests JOIN test_files ON test_files.test_id = tests.id
WHERE test_files.sha256 = ?;

-- name: SetTestFile :exec
INSERT INTO test_files (sha256, test_id) VALUES (?, ?)
ON CONFLICT (sha256) DO UPDATE SET test_id = excluded.test_id;
