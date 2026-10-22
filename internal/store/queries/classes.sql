-- name: InsertClass :exec
INSERT INTO classes (id, name, created_at) VALUES (?, ?, ?);

-- name: GetClass :one
SELECT * FROM classes WHERE id = ?;

-- name: ListClasses :many
SELECT * FROM classes ORDER BY created_at, id;

-- name: ListClassSummaries :many
SELECT c.id, c.name, count(s.id) AS student_count
FROM classes c LEFT JOIN students s ON s.class_id = c.id
GROUP BY c.id
ORDER BY c.created_at, c.id;

-- name: RenameClass :exec
UPDATE classes SET name = ? WHERE id = ?;

-- name: DeleteClass :execrows
DELETE FROM classes WHERE id = ?;

-- name: InsertStudent :exec
INSERT INTO students (id, class_id, name, sort_key) VALUES (?, ?, ?, ?);

-- name: GetStudent :one
SELECT * FROM students WHERE id = ?;

-- name: ListStudents :many
SELECT * FROM students WHERE class_id = ? ORDER BY sort_key, id;

-- name: UpdateStudent :exec
UPDATE students SET name = ?, sort_key = ? WHERE id = ?;

-- name: DeleteStudent :exec
DELETE FROM students WHERE id = ?;
