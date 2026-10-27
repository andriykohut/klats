package teacherapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"klats/internal/backup"
	"klats/internal/httpx"
	"klats/internal/store"
)

// backup sends a backup of all the data through [api.deliver], named
// «Клац — резервна копія — YYYY-MM-DD.klatsbackup» after today's local date.
func (a *api) backup(w http.ResponseWriter, r *http.Request) {
	name := "Клац — резервна копія — " + time.Now().Format(time.DateOnly) + ".klatsbackup"
	a.deliver(w, r, name, "application/octet-stream", func(w io.Writer) error {
		return backup.Write(w, a.st, a.media, a.tmpDir)
	}, nil)
}

// restore replaces every test, class and result with those of the backup in
// the request body, after snapshotting the database, and replies 204. The
// body is capped at 2 GiB (413 "too_large") and spooled to the temp folder
// (see [api.spool]). A running sitting gets a 409 "sitting_active", a file
// that is not a valid backup a 422 "file_damaged", and one from a newer
// version a 422 "backup_too_new". The media of a refused backup may still be
// stored.
func (a *api) restore(w http.ResponseWriter, r *http.Request) {
	tmp, _, ok := a.spool(w, r, maxBackupBytes)
	if !ok {
		return
	}
	defer removeTemp(tmp)
	// Prepare reads and checks the whole file, so it runs before the engine
	// is locked.
	p, err := backup.Prepare(tmp.Name(), a.media, a.tmpDir)
	switch {
	case errors.Is(err, backup.ErrDamaged):
		httpx.Error(w, http.StatusUnprocessableEntity, "file_damaged")
		return
	case errors.Is(err, backup.ErrTooNew):
		httpx.Error(w, http.StatusUnprocessableEntity, "backup_too_new")
		return
	case err != nil:
		fail(w, r, err)
		return
	}
	defer func() {
		if err := p.Close(); err != nil {
			slog.Warn("teacherapi: restore files not removed", "err", err)
		}
	}()
	noContent(w, r, a.eng.Restore(func() error {
		if err := a.st.Snapshot(a.dataDir, store.SnapshotsKeep); err != nil {
			return err
		}
		return p.Apply(a.st)
	}))
}
