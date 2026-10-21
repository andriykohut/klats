package store

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"

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

	err = s.Q().UpdateTest(ctx, db.UpdateTestParams{ID: "t1", Title: "Хімія", Doc: `{}`, UpdatedAt: 2000})
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

	if err := s.Q().DeleteTest(ctx, "t1"); err != nil {
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

	if err := s.Q().DeleteClass(ctx, "c1"); err != nil {
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
