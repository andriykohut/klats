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
