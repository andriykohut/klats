package store

import (
	"path/filepath"
	"testing"
)

func TestMigrationConvertsOptionIDs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "klats.db")
	v1, _ := migrationSets(t)
	old, err := openWith(path, v1)
	if err != nil {
		t.Fatal(err)
	}
	seedParticipant(t, old)
	mustExec(t, old, `INSERT INTO answers (participant_id, question_id, option_ids, seq, change_id, received_at)
		VALUES ('p1', 'q1', '["a","b"]', 1, 'c1', 1)`)
	_ = old.Close()

	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s.Close() }()
	var value string
	if err := s.conn.QueryRow(`SELECT value FROM answers WHERE question_id = 'q1'`).Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != `{"items":["a","b"]}` {
		t.Fatalf("value = %s", value)
	}
}
