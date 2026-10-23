-- name: InsertAssignment :exec
INSERT INTO assignments (id, test_id, test_snapshot, class_id, class_name, created_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: GetAssignment :one
SELECT * FROM assignments WHERE id = ?;

-- name: InsertSitting :exec
INSERT INTO sittings (id, assignment_id, join_code, started_at) VALUES (?, ?, ?, ?);

-- The latest sitting is the last inserted: rowid order can't be upset by a
-- clock change or two starts in one millisecond.
-- name: GetLatestSitting :one
SELECT * FROM sittings ORDER BY rowid DESC LIMIT 1;

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

-- name: AddParticipantMove :exec
UPDATE participants SET moves = moves + 1 WHERE id = ?;

-- name: InsertMovedDevice :exec
INSERT OR IGNORE INTO moved_devices (device_token, participant_id) VALUES (?, ?);

-- name: ListMovedDevices :many
SELECT m.* FROM moved_devices m JOIN participants p ON p.id = m.participant_id
WHERE p.sitting_id = ?
ORDER BY p.joined_at, p.id, m.device_token;

-- name: InsertEvent :exec
INSERT INTO events (id, sitting_id, kind, params, created_at, pinned) VALUES (?, ?, ?, ?, ?, ?);

-- name: ListOpenClashes :many
SELECT * FROM events
WHERE sitting_id = ? AND kind = 'name_clash' AND pinned = 1 AND resolved_at IS NULL
ORDER BY created_at, id;

-- name: ResolveEvent :exec
UPDATE events SET resolved_at = ? WHERE id = ?;

-- name: GetSitting :one
SELECT * FROM sittings WHERE id = ?;

-- name: ListAssignmentSittings :many
SELECT * FROM sittings WHERE assignment_id = ? ORDER BY started_at, id;

-- name: EndSitting :exec
UPDATE sittings SET ended_at = ? WHERE id = ?;

-- name: GetParticipant :one
SELECT * FROM participants WHERE id = ?;

-- name: FinishParticipant :exec
UPDATE participants SET state = 'finished', finished_by = ?, finished_at = ? WHERE id = ?;

-- name: SetFinishedBy :exec
UPDATE participants SET finished_by = ? WHERE id = ?;

-- name: SetWindowSwitches :exec
UPDATE participants SET window_switches = ? WHERE id = ?;

-- name: ListDeviceLabels :many
SELECT DISTINCT d.token, d.label FROM devices d JOIN participants p ON p.device_token = d.token
WHERE p.sitting_id = ?;

-- name: ChangeSeen :one
SELECT EXISTS (SELECT 1 FROM answers WHERE change_id = ?);

-- UpsertAnswer stores the answer unless one with an equal or higher seq is
-- stored; it then affects no row.
-- name: UpsertAnswer :execrows
INSERT INTO answers (participant_id, question_id, value, seq, change_id, received_at, late)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (participant_id, question_id) DO UPDATE SET
    value = excluded.value, seq = excluded.seq, change_id = excluded.change_id,
    received_at = excluded.received_at, late = excluded.late
WHERE excluded.seq > answers.seq;

-- name: ListAnswers :many
SELECT a.* FROM answers a JOIN participants p ON p.id = a.participant_id
WHERE p.sitting_id = ?
ORDER BY a.participant_id, a.question_id;

-- name: ListParticipantAnswers :many
SELECT * FROM answers WHERE participant_id = ?
ORDER BY question_id;

-- name: ListOverrides :many
SELECT o.* FROM overrides o JOIN participants p ON p.id = o.participant_id
WHERE p.sitting_id = ?;

-- name: UpsertOverride :exec
INSERT INTO overrides (assignment_id, participant_id, question_id, points) VALUES (?, ?, ?, ?)
ON CONFLICT (assignment_id, participant_id, question_id) DO UPDATE SET points = excluded.points;

-- name: DeleteOverride :exec
DELETE FROM overrides WHERE assignment_id = ? AND participant_id = ? AND question_id = ?;

-- name: SetExportStale :exec
UPDATE assignments SET export_stale = 1, results_rev = results_rev + 1 WHERE id = ?;

-- Events of one millisecond keep their insertion order by rowid.
-- name: ListOpenPinnedEvents :many
SELECT * FROM events WHERE sitting_id = ? AND pinned = 1 AND resolved_at IS NULL
ORDER BY created_at DESC, rowid DESC;

-- name: ListRecentEvents :many
SELECT * FROM events WHERE sitting_id = ? AND NOT (pinned = 1 AND resolved_at IS NULL)
ORDER BY created_at DESC, rowid DESC
LIMIT 20;

-- ListAssignments counts the participants who are not kicked, across all
-- sittings of each assignment.
-- name: ListAssignments :many
SELECT a.id,
       CAST(json_extract(a.test_snapshot, '$.title') AS TEXT) AS test_title,
       COALESCE(a.class_name, '') AS class_name,
       a.created_at,
       a.export_stale,
       (SELECT count(*) FROM participants p JOIN sittings s ON s.id = p.sitting_id
        WHERE s.assignment_id = a.id AND p.state <> 'kicked') AS participants
FROM assignments a
ORDER BY a.created_at DESC, a.rowid DESC;

-- ClearExportStale records a finished export at exported_at and clears the
-- flag only if no result changed since the export read results_rev, so a
-- change made while the file was written stays stale.
-- name: ClearExportStale :exec
UPDATE assignments
SET exported_at  = sqlc.arg(exported_at),
    export_stale = CASE WHEN results_rev = sqlc.arg(results_rev) THEN 0 ELSE export_stale END
WHERE id = sqlc.arg(id);
