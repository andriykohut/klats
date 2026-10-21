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
	"fmt"
	"io/fs"
	"net/url"
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

// Open opens (creating if needed) the database at path with WAL, foreign keys
// and a 5 s busy timeout, then applies any pending migrations.
func Open(path string) (*Store, error) {
	// The pragmas travel in the DSN so that they apply to every connection the
	// pool opens. busy_timeout comes first so later pragmas can wait on locks.
	q := url.Values{"_pragma": {"busy_timeout(5000)", "journal_mode(WAL)", "foreign_keys(1)"}}
	conn, err := sql.Open("sqlite", path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1)

	sub, err := fs.Sub(migrationsFS, "migrations")
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, conn, sub)
	if err == nil {
		_, err = provider.Up(context.Background())
	}
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("store: migrate %s: %w", path, err)
	}
	return &Store{conn: conn, q: db.New(conn)}, nil
}

// Close checkpoints and closes the database.
func (s *Store) Close() error { return s.conn.Close() }

// Q returns the queries bound to the database.
func (s *Store) Q() *db.Queries { return s.q }

// Tx runs fn in a transaction, committing if it returns nil and rolling back
// otherwise.
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
