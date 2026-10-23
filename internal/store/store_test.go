package store

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"testing/fstest"

	"klats/internal/roster"
	"klats/internal/store/db"
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

func TestOpenMigratesFreshDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "klats.db")
	for range 2 {
		s, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		var n int
		err = s.conn.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN
			('tests','classes','students','assignments','sittings','devices','participants','moved_devices','answers','overrides','events')`).Scan(&n)
		if err != nil {
			t.Fatal(err)
		}
		if n != 11 {
			t.Fatalf("got %d tables, want 11", n)
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOpenAppliesPragmas(t *testing.T) {
	s := openTemp(t)
	var fk, timeout int
	var mode string
	if err := s.conn.QueryRow(`PRAGMA foreign_keys`).Scan(&fk); err != nil {
		t.Fatal(err)
	}
	if err := s.conn.QueryRow(`PRAGMA busy_timeout`).Scan(&timeout); err != nil {
		t.Fatal(err)
	}
	if err := s.conn.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if fk != 1 || timeout != 5000 || mode != "wal" {
		t.Fatalf("foreign_keys=%d busy_timeout=%d journal_mode=%s", fk, timeout, mode)
	}
}

func TestNewID(t *testing.T) {
	a, b := NewID(), NewID()
	if len(a) != 26 || a == b {
		t.Fatalf("got %q and %q", a, b)
	}
}

func TestTestRoundTrip(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	doc := `{"id":"t1","title":"Фізика","questions":[]}`
	err := s.Q().InsertTest(ctx, db.InsertTestParams{ID: "t1", Title: "Фізика", Doc: doc, CreatedAt: 1000, UpdatedAt: 1000})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Q().GetTest(ctx, "t1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Doc != doc || got.Title != "Фізика" || got.CreatedAt != 1000 {
		t.Fatalf("got %+v", got)
	}

	_, err = s.Q().UpdateTest(ctx, db.UpdateTestParams{ID: "t1", Title: "Хімія", Doc: `{}`, UpdatedAt: 2000})
	if err != nil {
		t.Fatal(err)
	}
	list, err := s.Q().ListTests(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Title != "Хімія" || list[0].UpdatedAt != 2000 {
		t.Fatalf("got %+v", list)
	}

	if _, err := s.Q().DeleteTest(ctx, "t1"); err != nil {
		t.Fatal(err)
	}
	list, _ = s.Q().ListTests(ctx)
	if len(list) != 0 {
		t.Fatalf("got %+v after delete", list)
	}
}

func TestClassStudentsSortedByKey(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	if err := s.Q().InsertClass(ctx, db.InsertClassParams{ID: "c1", Name: "7-А", CreatedAt: 1}); err != nil {
		t.Fatal(err)
	}
	names := []string{"Яременко Оля", "Бойко Андрій", "Їжак Марко", "Іваненко Софія", "Гнатюк Ірина", "Ґудзь Пилип"}
	for _, n := range names {
		err := s.Q().InsertStudent(ctx, db.InsertStudentParams{ID: NewID(), ClassID: "c1", Name: n, SortKey: roster.SortKey(n)})
		if err != nil {
			t.Fatal(err)
		}
	}
	rows, err := s.Q().ListStudents(ctx, "c1")
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, r := range rows {
		got = append(got, r.Name)
	}
	want := []string{"Бойко Андрій", "Гнатюк Ірина", "Ґудзь Пилип", "Іваненко Софія", "Їжак Марко", "Яременко Оля"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}

	if _, err := s.Q().DeleteClass(ctx, "c1"); err != nil {
		t.Fatal(err)
	}
	if rows, _ = s.Q().ListStudents(ctx, "c1"); len(rows) != 0 {
		t.Fatalf("students outlived their class: %+v", rows)
	}
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

func TestDeleteTestKeepsAssignment(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	if err := s.Q().InsertTest(ctx, db.InsertTestParams{ID: "t1", Title: "Фізика", Doc: `{}`, CreatedAt: 1, UpdatedAt: 1}); err != nil {
		t.Fatal(err)
	}
	mustExec(t, s, `INSERT INTO assignments (id, test_id, test_snapshot, created_at) VALUES ('a1', 't1', '{"title":"Фізика"}', 1)`)

	if _, err := s.Q().DeleteTest(ctx, "t1"); err != nil {
		t.Fatal(err)
	}
	var testID *string
	var snapshot string
	if err := s.conn.QueryRow(`SELECT test_id, test_snapshot FROM assignments WHERE id = 'a1'`).Scan(&testID, &snapshot); err != nil {
		t.Fatal(err)
	}
	if testID != nil || snapshot != `{"title":"Фізика"}` {
		t.Fatalf("test_id=%v snapshot=%s", testID, snapshot)
	}
}

// seedParticipant inserts a class, a student, an assignment of class c1, a
// sitting, a device and a participant picked from the class list.
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
	mustExec(t, s, `INSERT INTO assignments (id, test_id, test_snapshot, class_id, class_name, created_at) VALUES ('a1', 't1', '{}', 'c1', '7-А', 1)`)
	mustExec(t, s, `INSERT INTO sittings (id, assignment_id, join_code, started_at) VALUES ('si1', 'a1', '1234', 1)`)
	mustExec(t, s, `INSERT INTO devices (token, last_seen_at) VALUES ('d1', 1)`)
	mustExec(t, s, `INSERT INTO participants (id, sitting_id, student_id, display_name, device_token, state, joined_at)
		VALUES ('p1', 'si1', 's1', 'Бойко Андрій', 'd1', 'writing', 1)`)
}

func TestDeleteStudentKeepsParticipant(t *testing.T) {
	s := openTemp(t)
	seedParticipant(t, s)

	if err := s.Q().DeleteStudent(context.Background(), "s1"); err != nil {
		t.Fatal(err)
	}
	var studentID *string
	var name string
	if err := s.conn.QueryRow(`SELECT student_id, display_name FROM participants WHERE id = 'p1'`).Scan(&studentID, &name); err != nil {
		t.Fatal(err)
	}
	if studentID != nil || name != "Бойко Андрій" {
		t.Fatalf("student_id=%v display_name=%q", studentID, name)
	}
}

func TestDeleteClassKeepsAssignmentClassName(t *testing.T) {
	s := openTemp(t)
	seedParticipant(t, s)

	if _, err := s.Q().DeleteClass(context.Background(), "c1"); err != nil {
		t.Fatal(err)
	}
	var classID, className *string
	if err := s.conn.QueryRow(`SELECT class_id, class_name FROM assignments WHERE id = 'a1'`).Scan(&classID, &className); err != nil {
		t.Fatal(err)
	}
	if classID != nil || className == nil || *className != "7-А" {
		t.Fatalf("class_id=%v class_name=%v", classID, className)
	}
	// The class's students are gone, but the participant keeps its name.
	var studentID *string
	var name string
	if err := s.conn.QueryRow(`SELECT student_id, display_name FROM participants WHERE id = 'p1'`).Scan(&studentID, &name); err != nil {
		t.Fatal(err)
	}
	if studentID != nil || name != "Бойко Андрій" {
		t.Fatalf("student_id=%v display_name=%q", studentID, name)
	}
}
