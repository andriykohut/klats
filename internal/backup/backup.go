// Package backup writes all of a teacher's data to one .klatsbackup file and
// restores it. The file is a zip of klats.db, a copy of the database, and
// media/<name> for each media file that a test or an assignment's snapshot
// uses (the layout of [mediazip]). [Prepare] is the trust boundary for
// restores: it caps every size itself, allows no other entry, and checks the
// database and every test document in it before it stores any media, and
// before the program's own database changes. Beyond those checks a backup is
// trusted as the teacher's own file.
package backup

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"

	"github.com/andriykohut/klats/internal/media"
	"github.com/andriykohut/klats/internal/mediazip"
	"github.com/andriykohut/klats/internal/store"
	"github.com/andriykohut/klats/internal/testfmt"
)

// MaxBytes is the largest backup file: a restore takes no larger one, so
// [Write] refuses to write one.
const MaxBytes = 2 << 30

const (
	dbEntry = "klats.db"

	maxEntries = 50_000
	// maxDirBytes caps what zip.NewReader reads: the central directory and its
	// end record. 50,000 entries with the longest media names and 40 bytes of
	// extra fields each fit in it.
	maxDirBytes = 8 << 20
	maxDBBytes  = 2 << 30
	// maxMediaBytes is the media store's largest cap, the one for audio.
	maxMediaBytes = 10 << 20
	// maxMediaTotal caps the bytes that the media of a small, deflated file
	// can inflate to on disk. Write stores media uncompressed and stops at
	// MaxBytes, so a backup it wrote stays under it.
	maxMediaTotal = 2 << 30
)

var (
	// ErrDamaged is returned by [Prepare] for a file that is not a valid
	// backup.
	ErrDamaged = errors.New("backup: damaged")
	// ErrTooNew is returned by [Prepare] for a backup that a newer version of
	// the program made.
	ErrTooNew = errors.New("backup: made by a newer version")
	// ErrTooLarge is returned by [Write] for a backup over [MaxBytes].
	ErrTooLarge = errors.New("backup: over the largest backup a restore takes")
)

// diskFaults are the SQLite result codes that blame the computer rather than
// the database file.
var diskFaults = []int{sqlite3.SQLITE_IOERR, sqlite3.SQLITE_FULL, sqlite3.SQLITE_CANTOPEN, sqlite3.SQLITE_NOMEM, sqlite3.SQLITE_READONLY}

// Write writes a backup of st and ms to w: klats.db, a consistent copy of the
// database, deflated, and media/<name>, uncompressed, for each file that a
// test or an assignment's snapshot in that copy uses. A used file missing from
// ms is logged and left out. The copy is made in a temporary folder in tmpDir,
// removed before Write returns. Write stops with an error wrapping
// [ErrTooLarge] once the file passes [MaxBytes]. w may hold part of the file
// when Write fails.
func Write(w io.Writer, st *store.Store, ms *media.Store, tmpDir string) error {
	dir, err := os.MkdirTemp(tmpDir, "backup-*")
	if err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	defer func() { _ = os.RemoveAll(dir) }()
	path := filepath.Join(dir, dbEntry)
	if err := st.CopyTo(path); err != nil {
		return err
	}
	names, err := readDB(path)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(&capped{w: w, left: MaxBytes})
	if err := addDB(zw, path); err != nil {
		return err
	}
	for _, name := range names {
		err := mediazip.Add(zw, ms, name)
		if errors.Is(err, media.ErrNotFound) {
			slog.Warn("backup: a media file in use is missing and left out", "name", name)
			continue
		}
		if err != nil {
			return fmt.Errorf("backup: %w", err)
		}
	}
	if err := zw.Close(); err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	return nil
}

// capped passes writes on to w until they come to more than left bytes in
// all, and from then on fails them with [ErrTooLarge].
type capped struct {
	w    io.Writer
	left int64
}

func (c *capped) Write(p []byte) (int, error) {
	if c.left -= int64(len(p)); c.left < 0 {
		return 0, ErrTooLarge
	}
	return c.w.Write(p)
}

// addDB writes the database file at path to zw as klats.db, deflated.
func addDB(zw *zip.Writer, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	defer func() { _ = f.Close() }()
	fw, err := zw.Create(dbEntry)
	if err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	if _, err := io.Copy(fw, f); err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	return nil
}

// Prepared is a checked backup, ready to replace the program's data.
type Prepared struct {
	dir string // the temporary folder holding the backup's database
}

// Prepare checks the backup file at path and stores in ms the media that its
// database uses, ready for [Prepared.Apply]. It extracts the database into a
// temporary folder in tmpDir, migrating it there if an older version made it;
// the caller calls [Prepared.Close] to remove the folder.
//
// Prepare returns an error wrapping [ErrTooNew] for a database or a test
// document from a newer version; it also wraps [store.ErrSchemaTooNew] or
// [testfmt.ErrTooNew]. It returns one wrapping [ErrDamaged] for a file that
// is not a zip, a central directory over 8 MiB, more than 50,000 entries, an
// entry other than klats.db and media/<media name>, a repeated entry, a
// klats.db that is missing, over 2 GiB, not an SQLite database or failing
// PRAGMA integrity_check, a test or snapshot refused by [testfmt.Decode], used
// media of over 2 GiB in all, and a used media entry over 10 MiB, whose bytes
// hash to another name, or that [media.Store.Put] refuses or names
// differently. A used media file the backup lacks is no error, since [Write]
// leaves out missing ones. A failure of ms or of the disk is returned wrapped
// instead of as ErrDamaged. Only media that Put refuses or names differently,
// and a failure of ms, can leave media of the file stored; every other error
// stores nothing.
func Prepare(path string, ms *media.Store, tmpDir string) (*Prepared, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("backup: %w", err)
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("backup: %w", err)
	}
	db, files, err := mediazip.Open(f, info.Size(), maxDirBytes, maxEntries, dbEntry)
	if err != nil {
		return nil, damaged("%v", err)
	}
	if db == nil {
		return nil, damaged("no %s", dbEntry)
	}
	dir, err := os.MkdirTemp(tmpDir, "restore-*")
	if err != nil {
		return nil, fmt.Errorf("backup: %w", err)
	}
	p := &Prepared{dir: dir}
	if err := p.fill(db, files, ms); err != nil {
		_ = p.Close()
		return nil, err
	}
	return p, nil
}

// fill extracts the database db into p's folder, checks it, and stores in ms
// the media it uses that files hold.
func (p *Prepared) fill(db *zip.File, files map[string]*zip.File, ms *media.Store) error {
	if err := extract(db, p.path()); err != nil {
		return err
	}
	names, err := readDB(p.path())
	if err != nil {
		return err
	}
	// Every check that needs no Put runs before the first one. Media stored
	// ahead of a later refusal does no harm: its name is its content hash.
	var bundled []string
	var total int64
	for _, name := range names {
		f := files[name]
		if f == nil {
			continue
		}
		n, err := mediazip.Check(f, name, maxMediaBytes)
		if err != nil {
			return damaged("%v", err)
		}
		if total += n; total > maxMediaTotal {
			return damaged("media over %d bytes in all", maxMediaTotal)
		}
		bundled = append(bundled, name)
	}
	for _, name := range bundled {
		err := mediazip.Put(ms, files[name], name)
		if errors.Is(err, mediazip.ErrInvalid) {
			return damaged("%v", err)
		}
		if err != nil {
			return fmt.Errorf("backup: %w", err)
		}
	}
	return nil
}

// Apply replaces the rows of st with the backup's (see
// [store.Store.ReplaceFrom]). On an error st is unchanged.
func (p *Prepared) Apply(st *store.Store) error { return st.ReplaceFrom(p.path()) }

// Close removes the temporary folder that holds the backup's database.
func (p *Prepared) Close() error { return os.RemoveAll(p.dir) }

func (p *Prepared) path() string { return filepath.Join(p.dir, dbEntry) }

// extract writes the contents of f, which may be at most 2 GiB, to a new file
// at path.
func extract(f *zip.File, path string) error {
	out, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	_, err = mediazip.Copy(out, f, maxDBBytes)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if errors.Is(err, mediazip.ErrInvalid) {
		return damaged("%v", err)
	}
	if err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	return nil
}

// readDB opens the database at path, migrating it if an older version made
// it, checks its integrity and returns the media that its tests and
// assignment snapshots use, sorted. Its errors are those of [dbError], or
// wrap ErrTooNew or ErrDamaged for a document that [testfmt.Decode] refuses.
func readDB(path string) ([]string, error) {
	st, err := store.Open(path)
	if err != nil {
		return nil, dbError(err)
	}
	names, err := usedMedia(st)
	if cerr := st.Close(); err == nil && cerr != nil {
		err = dbError(cerr)
	}
	return names, err
}

func usedMedia(st *store.Store) ([]string, error) {
	if err := st.IntegrityCheck(); err != nil {
		return nil, dbError(err)
	}
	ctx := context.Background()
	tests, err := st.Q().ListTests(ctx)
	if err != nil {
		return nil, dbError(err)
	}
	docs, err := st.Q().ListAssignmentSnapshots(ctx)
	if err != nil {
		return nil, dbError(err)
	}
	for _, t := range tests {
		docs = append(docs, t.Doc)
	}
	var names []string
	for _, doc := range docs {
		t, err := testfmt.Decode([]byte(doc))
		if errors.Is(err, testfmt.ErrTooNew) {
			return nil, fmt.Errorf("%w: %w", ErrTooNew, err)
		}
		if err != nil {
			return nil, damaged("%v", err)
		}
		names = append(names, t.Media()...)
	}
	slices.Sort(names)
	return slices.Compact(names), nil
}

// dbError returns err, from reading a database, wrapping ErrTooNew for a
// newer schema, wrapping ErrDamaged when SQLite blames the database itself,
// and wrapped as it is for a failure of the disk.
func dbError(err error) error {
	var se *sqlite.Error
	switch {
	case errors.Is(err, store.ErrSchemaTooNew):
		return fmt.Errorf("%w: %w", ErrTooNew, err)
	case errors.Is(err, store.ErrCorrupt),
		errors.As(err, &se) && !slices.Contains(diskFaults, se.Code()&0xff):
		return damaged("%v", err)
	}
	return fmt.Errorf("backup: %w", err)
}

// damaged returns an error wrapping [ErrDamaged] that gives the reason.
func damaged(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrDamaged, fmt.Sprintf(format, args...))
}
