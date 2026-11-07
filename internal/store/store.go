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

	"github.com/andriykohut/klats/internal/store/db"
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
// before a migration or a restore, each day and at the end of a sitting share
// one folder, so every caller of [Store.Snapshot] passes it.
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
		if err := s.Snapshot(filepath.Dir(path), SnapshotsKeep); err != nil {
			return err
		}
	}
	_, err = provider.Up(ctx)
	return err
}

// Close checkpoints and closes the database.
func (s *Store) Close() error { return s.conn.Close() }

// Q returns the queries bound to the database.
func (s *Store) Q() *db.Queries { return s.q }

// ErrCorrupt is returned by [Store.IntegrityCheck] for a database that SQLite
// finds damaged.
var ErrCorrupt = errors.New("store: database is damaged")

// IntegrityCheck runs PRAGMA integrity_check over the whole database. Unless
// the check finds nothing wrong, it returns an error wrapping [ErrCorrupt]
// with the first problem found.
func (s *Store) IntegrityCheck() error {
	var res string
	if err := s.conn.QueryRow("PRAGMA integrity_check").Scan(&res); err != nil {
		return fmt.Errorf("store: integrity check: %w", err)
	}
	if res != "ok" {
		return fmt.Errorf("%w: %s", ErrCorrupt, res)
	}
	return nil
}

// ReplaceFrom replaces the rows of every table but goose_db_version with those
// of the database at path, which must be at this program's schema version. It
// works on one connection: it attaches the file, empties and refills every
// table in one transaction whose foreign keys are checked at the commit, and
// detaches it. On an error nothing changes.
func (s *Store) ReplaceFrom(path string) error {
	ctx := context.Background()
	conn, err := s.conn.Conn(ctx)
	if err != nil {
		return fmt.Errorf("store: replace: %w", err)
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.ExecContext(ctx, "ATTACH DATABASE ? AS src", path); err != nil {
		return fmt.Errorf("store: replace: %w", err)
	}
	defer func() {
		if _, err := conn.ExecContext(ctx, "DETACH DATABASE src"); err != nil {
			slog.Error("store: the replaced-from database stays attached", "err", err)
		}
	}()
	if err := replaceRows(ctx, conn); err != nil {
		return fmt.Errorf("store: replace from %s: %w", path, err)
	}
	return nil
}

// replaceRows is [Store.ReplaceFrom] on conn, with the source attached as src.
func replaceRows(ctx context.Context, conn *sql.Conn) error {
	var same bool
	err := conn.QueryRowContext(ctx, `SELECT (SELECT max(version_id) FROM src.goose_db_version WHERE is_applied)
		IS (SELECT max(version_id) FROM main.goose_db_version WHERE is_applied)`).Scan(&same)
	if err != nil {
		return err
	}
	if !same {
		return errors.New("the schema versions differ")
	}
	tables, err := tableColumns(ctx, conn)
	if err != nil {
		return err
	}
	stmts := []string{"PRAGMA defer_foreign_keys = ON"}
	// Children are emptied first, so a deleted parent row has nothing left to
	// cascade to.
	for i := len(tables) - 1; i >= 0; i-- {
		stmts = append(stmts, "DELETE FROM main."+tables[i].name)
	}
	// Columns go by name, as the queries that checked the source read them.
	// The rowid keeps the insertion order that GetLatestSitting relies on.
	for _, t := range tables {
		cols := strings.Join(t.cols, ", ")
		stmts = append(stmts, fmt.Sprintf("INSERT INTO main.%s (rowid, %s) SELECT rowid, %s FROM src.%s", t.name, cols, cols, t.name))
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, q := range stmts {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// table is a table of the main database and its columns, quoted.
type table struct {
	name string
	cols []string
}

// tableColumns returns the tables of the main database in the order they were
// created, leaving out goose_db_version and SQLite's own.
func tableColumns(ctx context.Context, conn *sql.Conn) ([]table, error) {
	rows, err := conn.QueryContext(ctx, `SELECT m.name, c.name FROM main.sqlite_master m, pragma_table_info(m.name, 'main') c
		WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\_%' ESCAPE '\' AND m.name <> 'goose_db_version'
		ORDER BY m.rowid, c.cid`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []table
	for rows.Next() {
		var name, col string
		if err := rows.Scan(&name, &col); err != nil {
			return nil, err
		}
		if len(out) == 0 || out[len(out)-1].name != quote(name) {
			out = append(out, table{name: quote(name)})
		}
		out[len(out)-1].cols = append(out[len(out)-1].cols, quote(col))
	}
	return out, rows.Err()
}

// quote returns id as an SQL identifier.
func quote(id string) string { return `"` + strings.ReplaceAll(id, `"`, `""`) + `"` }

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
