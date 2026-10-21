package store

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"time"
)

// Snapshot writes a consistent copy of the database (VACUUM INTO) to
// <dir>/snapshots/klats-YYYYMMDD-HHMMSS-<nanoseconds>.db, then deletes the
// oldest snapshots so that at most keep remain. File names are UTC and
// zero-padded, so name order is chronological; a name that already exists is
// bumped by a nanosecond, which keeps rapid snapshots distinct and ordered.
func (s *Store) Snapshot(dir string, keep int) error {
	snaps := filepath.Join(dir, "snapshots")
	if err := os.MkdirAll(snaps, 0o700); err != nil {
		return err
	}
	now := time.Now().UTC()
	var path string
	for {
		path = filepath.Join(snaps, fmt.Sprintf("klats-%s-%09d.db", now.Format("20060102-150405"), now.Nanosecond()))
		if _, err := os.Lstat(path); errors.Is(err, fs.ErrNotExist) {
			break
		}
		now = now.Add(time.Nanosecond)
	}
	if _, err := s.conn.ExecContext(context.Background(), "VACUUM INTO ?", path); err != nil {
		return fmt.Errorf("store: snapshot: %w", err)
	}

	files, err := filepath.Glob(filepath.Join(snaps, "klats-*.db"))
	if err != nil {
		return err
	}
	slices.Sort(files)
	for len(files) > keep {
		if err := os.Remove(files[0]); err != nil {
			return err
		}
		files = files[1:]
	}
	return nil
}
