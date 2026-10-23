// Package store is the teacher program's SQLite database: connection setup,
// embedded goose migrations, transactions and snapshots. Query code lives in
// the sqlc-generated package [db].
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/base32"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite" // registers the "sqlite" driver

	"klats/internal/store/db"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Store wraps the database with a single connection (SetMaxOpenConns(1)), so
// writers never contend for SQLite's lock and every statement sees the pragmas.
type Store struct {
	conn *sql.DB
	q    *db.Queries
}

// NewID returns a random 128-bit id as 26 lowercase base32 characters.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand does not fail on supported platforms
	}
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:]))
}

// SnapshotsKeep is how many snapshots the data folder keeps. Those taken
// before a migration, each day and at the end of a sitting share one folder,
// so every caller of [Store.Snapshot] passes it.
const SnapshotsKeep = 10

// ErrSchemaTooNew is returned by [Open] when the database was migrated by a
// newer version of the program than this one.
var ErrSchemaTooNew = errors.New("store: database schema is newer than this program")

// Open opens (creating if needed) the database at path with WAL, foreign keys
// and a 5 s busy timeout, then applies any pending migrations.
//
// Before migrating an existing database it takes a [Store.Snapshot] into
// snapshots/ in the directory holding the database file (the data folder, as
// the database lives directly in it). Old snapshots it fails to delete are
// logged, and the migration goes ahead. A fresh or up-to-date database takes
// no snapshot. If the database is at a schema version above the newest
// embedded migration, Open returns [ErrSchemaTooNew] without modifying the
// file.
func Open(path string) (*Store, error) {
	sub, err := fs.Sub(migrationsFS, "migrations")
	if err != nil {
		return nil, err
	}
	return openWith(path, sub)
}

func openWith(path string, migrations fs.FS) (*Store, error) {
	// The pragmas travel in the DSN so that they apply to every connection the
	// pool opens. busy_timeout comes first so later pragmas can wait on locks.
	q := url.Values{"_pragma": {"busy_timeout(5000)", "journal_mode(WAL)", "foreign_keys(1)"}}
	conn, err := sql.Open("sqlite", path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1)
	s := &Store{conn: conn, q: db.New(conn)}
	if err := s.migrate(path, migrations); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("store: migrate %s: %w", path, err)
	}
	return s, nil
}

func (s *Store) migrate(path string, migrations fs.FS) error {
	ctx := context.Background()
	provider, err := goose.NewProvider(goose.DialectSQLite3, s.conn, migrations)
	if err != nil {
		return err
	}
	sources := provider.ListSources()
	var latest int64
	if len(sources) > 0 {
		latest = sources[len(sources)-1].Version
	}

	// Read the version directly: the provider's own lookup creates the
	// version table, which would modify a database we may be refusing.
	var current int64
	var hasTable int
	if err := s.conn.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE name = 'goose_db_version'`).Scan(&hasTable); err != nil {
		return err
	}
	if hasTable > 0 {
		if err := s.conn.QueryRowContext(ctx, `SELECT coalesce(max(version_id), 0) FROM goose_db_version WHERE is_applied`).Scan(&current); err != nil {
			return err
		}
	}
	if current > latest {
		return fmt.Errorf("%w (database version %d, program version %d)", ErrSchemaTooNew, current, latest)
	}
	if current > 0 && current < latest {
		dir := filepath.Dir(path)
		if err := s.snapshot(dir); err != nil {
			return err
		}
		// An old snapshot that cannot be deleted, such as one an antivirus
		// holds open, must not keep the program from starting.
		if err := prune(dir, SnapshotsKeep); err != nil {
			slog.Error("store: old snapshots not pruned", "err", err)
		}
	}
	_, err = provider.Up(ctx)
	return err
}

// Close checkpoints and closes the database.
func (s *Store) Close() error { return s.conn.Close() }

// Q returns the queries bound to the database.
func (s *Store) Q() *db.Queries { return s.q }

// Tx runs fn in a transaction, committing if it returns nil and rolling back
// otherwise. Inside fn, use the queries it is given: calling [Store.Q] there
// deadlocks, because the transaction holds the only connection.
func (s *Store) Tx(ctx context.Context, fn func(*db.Queries) error) error {
	tx, err := s.conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(s.q.WithTx(tx)); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
