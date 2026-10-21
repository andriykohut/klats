-- +goose Up
CREATE TABLE tests (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    doc        TEXT NOT NULL CHECK (json_valid(doc)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE classes (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE students (
    id       TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    sort_key TEXT NOT NULL
);
CREATE INDEX students_class_sort ON students (class_id, sort_key);

CREATE TABLE assignments (
    id            TEXT PRIMARY KEY,
    test_id       TEXT REFERENCES tests (id) ON DELETE SET NULL,
    test_snapshot TEXT NOT NULL CHECK (json_valid(test_snapshot)),
    class_id      TEXT REFERENCES classes (id) ON DELETE SET NULL,
    class_name    TEXT,
    created_at    INTEGER NOT NULL,
    export_stale  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sittings (
    id            TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
    join_code     TEXT NOT NULL,
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER
);

CREATE TABLE devices (
    token        TEXT PRIMARY KEY,
    label        TEXT NOT NULL DEFAULT '',
    last_ip      TEXT NOT NULL DEFAULT '',
    last_seen_at INTEGER NOT NULL
);

CREATE TABLE participants (
    id              TEXT PRIMARY KEY,
    sitting_id      TEXT NOT NULL REFERENCES sittings (id) ON DELETE CASCADE,
    student_id      TEXT REFERENCES students (id) ON DELETE SET NULL,
    display_name    TEXT NOT NULL,
    typed_name      TEXT,
    typed_class     TEXT,
    device_token    TEXT NOT NULL REFERENCES devices (token),
    state           TEXT NOT NULL CHECK (state IN ('writing', 'finished', 'kicked')),
    joined_at       INTEGER NOT NULL,
    finished_at     INTEGER,
    finished_by     TEXT CHECK (finished_by IN ('student', 'end')),
    window_switches INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX participants_sitting ON participants (sitting_id);

CREATE TABLE moved_devices (
    device_token   TEXT NOT NULL,
    participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
    PRIMARY KEY (device_token, participant_id)
);

CREATE TABLE answers (
    participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
    question_id    TEXT NOT NULL,
    option_ids     TEXT NOT NULL CHECK (json_valid(option_ids)),
    seq            INTEGER NOT NULL,
    change_id      TEXT NOT NULL UNIQUE,
    received_at    INTEGER NOT NULL,
    late           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (participant_id, question_id)
);

CREATE TABLE overrides (
    assignment_id  TEXT NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
    question_id    TEXT NOT NULL,
    points         REAL NOT NULL,
    PRIMARY KEY (assignment_id, participant_id, question_id)
);

CREATE TABLE events (
    id          TEXT PRIMARY KEY,
    sitting_id  TEXT NOT NULL REFERENCES sittings (id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    params      TEXT NOT NULL CHECK (json_valid(params)),
    created_at  INTEGER NOT NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    resolved_at INTEGER
);
CREATE INDEX events_sitting ON events (sitting_id, created_at);

-- +goose Down
DROP TABLE events;
DROP TABLE overrides;
DROP TABLE answers;
DROP TABLE moved_devices;
DROP TABLE participants;
DROP TABLE devices;
DROP TABLE sittings;
DROP TABLE assignments;
DROP TABLE students;
DROP TABLE classes;
DROP TABLE tests;
