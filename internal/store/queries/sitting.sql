-- name: InsertAssignment :exec
INSERT INTO assignments (id, test_id, test_snapshot, class_id, class_name, created_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: GetAssignment :one
SELECT * FROM assignments WHERE id = ?;

-- name: InsertSitting :exec
INSERT INTO sittings (id, assignment_id, join_code, started_at) VALUES (?, ?, ?, ?);

-- name: GetActiveSitting :one
SELECT * FROM sittings WHERE ended_at IS NULL ORDER BY started_at DESC, id LIMIT 1;

-- name: RecentJoinCodes :many
SELECT join_code FROM sittings ORDER BY started_at DESC, id LIMIT 20;

-- name: UpsertDevice :exec
INSERT INTO devices (token, label, last_ip, last_seen_at) VALUES (?, ?, ?, ?)
ON CONFLICT (token) DO UPDATE SET last_ip = excluded.last_ip, last_seen_at = excluded.last_seen_at;

-- name: GetDevice :one
SELECT * FROM devices WHERE token = ?;

-- name: RenameDevice :execrows
UPDATE devices SET label = ? WHERE token = ?;

-- name: InsertParticipant :exec
INSERT INTO participants (id, sitting_id, student_id, display_name, typed_name, typed_class, device_token, state, joined_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: ListParticipants :many
SELECT * FROM participants WHERE sitting_id = ? ORDER BY joined_at, id;

-- name: SetParticipantState :exec
UPDATE participants SET state = ? WHERE id = ?;

-- name: SetParticipantDevice :exec
UPDATE participants SET device_token = ? WHERE id = ?;

-- name: InsertMovedDevice :exec
INSERT OR IGNORE INTO moved_devices (device_token, participant_id) VALUES (?, ?);

-- name: ListMovedDevices :many
SELECT m.* FROM moved_devices m JOIN participants p ON p.id = m.participant_id
WHERE p.sitting_id = ?;

-- name: InsertEvent :exec
INSERT INTO events (id, sitting_id, kind, params, created_at, pinned) VALUES (?, ?, ?, ?, ?, ?);

-- name: ListOpenClashes :many
SELECT * FROM events
WHERE sitting_id = ? AND kind = 'name_clash' AND pinned = 1 AND resolved_at IS NULL
ORDER BY created_at, id;

-- name: ResolveEvent :exec
UPDATE events SET resolved_at = ? WHERE id = ?;
