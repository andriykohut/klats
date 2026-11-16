package store

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/andriykohut/klats/internal/roster"
	"github.com/andriykohut/klats/internal/store/db"
)

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "klats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestTxRollsBack(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	errBoom := os.ErrInvalid
	err := s.Tx(ctx, func(q *db.Queries) error {
		if err := q.InsertClass(ctx, db.InsertClassParams{ID: "c1", Name: "7-А", CreatedAt: 1}); err != nil {
			return err
		}
		return errBoom
	})
	if err != errBoom {
		t.Fatalf("got %v", err)
	}
	if classes, _ := s.Q().ListClasses(ctx); len(classes) != 0 {
		t.Fatalf("rollback left %+v", classes)
	}
}

func TestSnapshotKeepsNewest(t *testing.T) {
	s := openTemp(t)
	dir := t.TempDir()
	for range 12 {
		if err := s.Snapshot(dir, 10); err != nil {
			t.Fatal(err)
		}
	}
	files, err := filepath.Glob(filepath.Join(dir, "snapshots", "klats-*.db"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 10 {
		t.Fatalf("got %d snapshots, want 10", len(files))
	}

	// The newest snapshot survives pruning and is a usable database.
	if err := s.Q().InsertClass(context.Background(), db.InsertClassParams{ID: "c1", Name: "7-А", CreatedAt: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.Snapshot(dir, 10); err != nil {
		t.Fatal(err)
	}
	files, _ = filepath.Glob(filepath.Join(dir, "snapshots", "klats-*.db"))
	if len(files) != 10 {
		t.Fatalf("got %d snapshots, want 10", len(files))
	}
	newest, err := Open(files[len(files)-1])
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = newest.Close() }()
	if classes, _ := newest.Q().ListClasses(context.Background()); len(classes) != 1 {
		t.Fatalf("newest snapshot lacks the latest write: %+v", classes)
	}
}

// An old snapshot that cannot be deleted, as one an antivirus holds open on
// Windows, is logged, and the new snapshot still counts as taken.
func TestSnapshotPastStuckOldOnes(t *testing.T) {
	s := openTemp(t)
	dir := t.TempDir()
	// A non-empty folder under a snapshot's name fails os.Remove.
	for i := range SnapshotsKeep {
		stuck := filepath.Join(dir, "snapshots", fmt.Sprintf("klats-00000000-000000-%09d.db", i), "x")
		if err := os.MkdirAll(stuck, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Snapshot(dir, SnapshotsKeep); err != nil {
		t.Fatalf("Snapshot = %v, want nil despite the stuck snapshots", err)
	}
	if files := snapshotFiles(t, filepath.Join(dir, "klats.db")); len(files) != SnapshotsKeep+1 {
		t.Errorf("got %d snapshots, want the %d stuck ones and the new one", len(files), SnapshotsKeep)
	}
}

// migrationSets returns the embedded migrations alone (v1) and extended with a
// second migration (v2), to simulate a database one release behind.
func migrationSets(t *testing.T) (v1, v2 fs.FS) {
	t.Helper()
	initSQL, err := fs.ReadFile(migrationsFS, "migrations/00001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	extra := []byte("-- +goose Up\nCREATE TABLE extra (id INTEGER);\n-- +goose Down\nDROP TABLE extra;\n")
	v1 = fstest.MapFS{"00001_init.sql": {Data: initSQL}}
	v2 = fstest.MapFS{"00001_init.sql": {Data: initSQL}, "00002_extra.sql": {Data: extra}}
	return v1, v2
}

func snapshotFiles(t *testing.T, dbPath string) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(filepath.Dir(dbPath), "snapshots", "klats-*.db"))
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func TestOpenSnapshotsBeforePendingMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "klats.db")
	v1, v2 := migrationSets(t)
	old, err := openWith(path, v1)
	if err != nil {
		t.Fatal(err)
	}
	if err := old.Q().InsertClass(context.Background(), db.InsertClassParams{ID: "c1", Name: "7-А", CreatedAt: 1}); err != nil {
		t.Fatal(err)
	}
	_ = old.Close()
	if n := len(snapshotFiles(t, path)); n != 0 {
		t.Fatalf("fresh database took %d snapshots", n)
	}

	s, err := openWith(path, v2)
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	files := snapshotFiles(t, path)
	if len(files) != 1 {
		t.Fatalf("got %d snapshots, want 1", len(files))
	}

	// The snapshot is the pre-migration state: it has the data but not the new table.
	snap, err := openWith(files[0], v1)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = snap.Close() }()
	var extra int
	_ = snap.conn.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name = 'extra'`).Scan(&extra)
	if classes, _ := snap.Q().ListClasses(context.Background()); len(classes) != 1 || extra != 0 {
		t.Fatalf("snapshot is not the pre-migration state: classes=%v extra=%d", classes, extra)
	}
}

func TestOpenMigratesWhenOldSnapshotsCannotBeDeleted(t *testing.T) {
	path := filepath.Join(t.TempDir(), "klats.db")
	v1, v2 := migrationSets(t)
	old, err := openWith(path, v1)
	if err != nil {
		t.Fatal(err)
	}
	_ = old.Close()
	// A non-empty folder under a snapshot's name fails os.Remove, as a file an
	// antivirus holds open does on Windows.
	for i := range SnapshotsKeep {
		stuck := filepath.Join(filepath.Dir(path), "snapshots", fmt.Sprintf("klats-00000000-000000-%09d.db", i), "x")
		if err := os.MkdirAll(stuck, 0o700); err != nil {
			t.Fatal(err)
		}
	}

	s, err := openWith(path, v2)
	if err != nil {
		t.Fatalf("Open = %v, want the migration despite the stuck snapshots", err)
	}
	defer func() { _ = s.Close() }()
	var extra int
	if err := s.conn.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name = 'extra'`).Scan(&extra); err != nil || extra != 1 {
		t.Fatalf("the migration did not run: extra=%d, %v", extra, err)
	}
}

func TestOpenFreshDBTakesNoSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "klats.db")
	for range 2 { // second Open is an existing, up-to-date database
		s, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		_ = s.Close()
	}
	if n := len(snapshotFiles(t, path)); n != 0 {
		t.Fatalf("got %d snapshots, want 0", n)
	}
}

func TestOpenRejectsNewerSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "klats.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.conn.Exec(`INSERT INTO goose_db_version (version_id, is_applied) VALUES (99, 1)`); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := Open(path); !errors.Is(err, ErrSchemaTooNew) {
		t.Fatalf("got %v, want ErrSchemaTooNew", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("database file changed")
	}
	if n := len(snapshotFiles(t, path)); n != 0 {
		t.Fatalf("got %d snapshots, want 0", n)
	}
}

func mustExec(t *testing.T, s *Store, query string, args ...any) {
	t.Helper()
	if _, err := s.conn.Exec(query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

// seedParticipant inserts a test, a class, a student, an assignment of the
// test to class c1, a sitting, a device and a participant picked from the
// class list.
func seedParticipant(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	if err := s.Q().InsertTest(ctx, db.InsertTestParams{ID: "t1", Title: "Фізика", Doc: `{}`, CreatedAt: 1, UpdatedAt: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.Q().InsertClass(ctx, db.InsertClassParams{ID: "c1", Name: "7-А", CreatedAt: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.Q().InsertStudent(ctx, db.InsertStudentParams{ID: "s1", ClassID: "c1", Name: "Бойко Андрій", SortKey: roster.SortKey("Бойко Андрій")}); err != nil {
		t.Fatal(err)
	}
	mustExec(t, s, `INSERT INTO assignments (id, test_id, test_snapshot, class_id, class_name, created_at) VALUES ('a1', 't1', '{"title":"Фізика"}', 'c1', '7-А', 1)`)
	mustExec(t, s, `INSERT INTO sittings (id, assignment_id, join_code, started_at) VALUES ('si1', 'a1', '1234', 1)`)
	mustExec(t, s, `INSERT INTO devices (token, last_seen_at) VALUES ('d1', 1)`)
	mustExec(t, s, `INSERT INTO participants (id, sitting_id, student_id, display_name, device_token, state, joined_at)
		VALUES ('p1', 'si1', 's1', 'Бойко Андрій', 'd1', 'writing', 1)`)
}

// Deleting a test, a student or a class keeps the results of their sittings
// listed with the test's title, the class's name and the student's name.
func TestDeleteKeepsResults(t *testing.T) {
	ctx := context.Background()
	for name, del := range map[string]func(q *db.Queries) error{
		"test": func(q *db.Queries) error {
			_, err := q.DeleteTest(ctx, "t1")
			return err
		},
		"student": func(q *db.Queries) error { return q.DeleteStudent(ctx, "s1") },
		"class": func(q *db.Queries) error {
			_, err := q.DeleteClass(ctx, "c1")
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			s := openTemp(t)
			seedParticipant(t, s)
			if err := del(s.Q()); err != nil {
				t.Fatal(err)
			}
			list, err := s.Q().ListAssignments(ctx)
			if err != nil || len(list) != 1 || list[0].TestTitle != "Фізика" || list[0].ClassName != "7-А" || list[0].Participants != 1 {
				t.Errorf("assignments = %+v, %v", list, err)
			}
			ps, err := s.Q().ListParticipants(ctx, "si1")
			if err != nil || len(ps) != 1 || ps[0].DisplayName != "Бойко Андрій" {
				t.Errorf("participants = %+v, %v", ps, err)
			}
		})
	}
}

// contents returns the titles of the tests and the names of the classes in s.
func contents(t *testing.T, s *Store) string {
	t.Helper()
	var got string
	err := s.conn.QueryRow(`SELECT (SELECT coalesce(group_concat(title), '') FROM tests) || ' / ' ||
		(SELECT coalesce(group_concat(name), '') FROM classes)`).Scan(&got)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// gooseRows returns the rows of s's goose_db_version as one string.
func gooseRows(t *testing.T, s *Store) string {
	t.Helper()
	var got string
	if err := s.conn.QueryRow(`SELECT group_concat(id || ',' || version_id || ',' || tstamp, ';') FROM goose_db_version`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	return got
}

// source returns the path of a copy of a database holding seedParticipant's
// rows, after the statements in edit have run on it.
func source(t *testing.T, edit ...string) string {
	t.Helper()
	s := openTemp(t)
	seedParticipant(t, s)
	for _, q := range edit {
		mustExec(t, s, q)
	}
	path := filepath.Join(t.TempDir(), "source.db")
	if err := s.CopyTo(path); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestReplaceFrom(t *testing.T) {
	dst := openTemp(t)
	ctx := context.Background()
	if err := dst.Q().InsertTest(ctx, db.InsertTestParams{ID: "t9", Title: "Хімія", Doc: `{}`}); err != nil {
		t.Fatal(err)
	}
	if err := dst.Q().InsertClass(ctx, db.InsertClassParams{ID: "c9", Name: "9-Б"}); err != nil {
		t.Fatal(err)
	}
	goose := gooseRows(t, dst)
	if err := dst.ReplaceFrom(source(t)); err != nil {
		t.Fatal(err)
	}
	if got := contents(t, dst); got != "Фізика / 7-А" {
		t.Errorf("after the replace: %s, want Фізика / 7-А", got)
	}
	if ps, err := dst.Q().ListParticipants(ctx, "si1"); err != nil || len(ps) != 1 || ps[0].DisplayName != "Бойко Андрій" {
		t.Errorf("participants = %+v, %v", ps, err)
	}
	if got := gooseRows(t, dst); got != goose {
		t.Errorf("goose_db_version = %s, want %s", got, goose)
	}

	mustExec(t, dst, `UPDATE classes SET name = '7-В'`)
	for name, edit := range map[string][]string{
		// The DELETEs have run by the time the INSERT finds the table missing.
		"no classes table": {`DROP TABLE classes`},
		// Caught only by the deferred check at commit.
		"a student of no class": {`PRAGMA foreign_keys = OFF`, `INSERT INTO students (id, class_id, name, sort_key) VALUES ('s2', 'nope', 'Я', 'я')`},
		"an older schema":       {`DELETE FROM goose_db_version WHERE version_id = (SELECT max(version_id) FROM goose_db_version)`},
	} {
		t.Run(name, func(t *testing.T) {
			if err := dst.ReplaceFrom(source(t, edit...)); err == nil {
				t.Error("ReplaceFrom = nil, want an error")
			}
			if got := contents(t, dst); got != "Фізика / 7-В" {
				t.Errorf("the destination changed to %s", got)
			}
		})
	}
	// A failed replace leaves the connection usable: a later one still works.
	if err := dst.ReplaceFrom(source(t)); err != nil {
		t.Fatal(err)
	}
	if got := contents(t, dst); got != "Фізика / 7-А" {
		t.Errorf("after a second replace: %s", got)
	}
}
