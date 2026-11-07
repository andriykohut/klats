package teacherapi

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/andriykohut/klats/internal/backup"
	"github.com/andriykohut/klats/internal/httpx"
	"github.com/andriykohut/klats/internal/store/db"
	"github.com/andriykohut/klats/internal/wire"
	"github.com/andriykohut/klats/internal/xlsx"
)

func (a *api) listAssignments(w http.ResponseWriter, r *http.Request) {
	rows, err := a.st.Q().ListAssignments(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	out := make([]wire.AssignmentSummary, 0, len(rows))
	for _, row := range rows {
		s := wire.AssignmentSummary{
			ID: row.ID, TestTitle: row.TestTitle, ClassName: row.ClassName, CreatedAt: row.CreatedAt,
			Participants: int(row.Participants), ExportStale: row.ExportStale != 0,
		}
		// shortcut: every assignment is graded again on each list load; keep the
		// average with the assignment when the results list gets slow.
		res, err := a.eng.Results(row.ID)
		if err != nil {
			fail(w, r, err)
			return
		}
		s.Scale = res.Scale
		sum, n := 0, 0
		for _, rr := range res.Rows {
			if !rr.Writing && len(rr.PendingIDs) == 0 {
				sum, n = sum+rr.Grade, n+1
			}
		}
		if n > 0 {
			avg := float64(sum) / float64(n)
			s.AverageGrade = &avg
		}
		out = append(out, s)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) results(w http.ResponseWriter, r *http.Request) {
	res, err := a.eng.Results(r.PathValue("id"))
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (a *api) override(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req wire.OverrideRequest
	if !decode(w, r, &req) {
		return
	}
	if err := a.eng.SetOverride(id, req.ParticipantID, req.QuestionID, req.Points); err != nil {
		fail(w, r, err)
		return
	}
	a.results(w, r)
}

func (a *api) language() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.settings.Language
}

// export writes the assignment's results workbook through [api.deliver]. A
// finished export records exported_at, which sets
// [wire.AssignmentResults.Exported]. It also clears export_stale, unless a
// result changed after the results it holds were read (see
// [wire.AssignmentResults.ResultsRev]), which includes changes made while the
// save dialog was open.
func (a *api) export(w http.ResponseWriter, r *http.Request) {
	res, err := a.eng.Results(r.PathValue("id"))
	if err != nil {
		fail(w, r, err)
		return
	}
	lang := a.language()
	a.deliver(w, r, xlsx.FileName(res), xlsxType,
		func(w io.Writer) error { return xlsx.Export(w, res, lang) },
		func() error { return a.clearStale(r, res) })
}

// deliver hands the teacher the file that write produces, offering name.
//
// With Dialogs the teacher picks the path in the save dialog, and the file
// replaces it whole (see [replaceFile]). The reply is the
// [wire.ExportResult], a 204 for a cancelled dialog, or a 409 "write_failed"
// when the file cannot be written. Either way, a backup over
// [backup.MaxBytes] is a 422 "too_large".
//
// Without Dialogs the file is written to a temporary file in the temp folder
// first, then sent as a download of contentType with its Content-Length. A
// write that fails partway is a 500, never a short file the browser keeps,
// and a file of any size stays out of memory.
//
// saved, when not nil, runs once the file is saved or fully sent. With Dialogs
// its error is the reply; after a download, whose status is already sent, it
// is only logged.
func (a *api) deliver(w http.ResponseWriter, r *http.Request, name, contentType string, write func(io.Writer) error, saved func() error) {
	if saved == nil {
		saved = func() error { return nil }
	}
	if a.dialogs == nil {
		a.download(w, r, name, contentType, write, saved)
		return
	}
	path, err := a.dialogs.SaveFile(name)
	if err != nil {
		fail(w, r, fmt.Errorf("save dialog: %w", err))
		return
	}
	if path == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := replaceFile(path, write); err != nil {
		if errors.Is(err, backup.ErrTooLarge) {
			fail(w, r, err)
			return
		}
		slog.Warn("teacherapi: export not written", "err", err)
		httpx.Error(w, http.StatusConflict, "write_failed")
		return
	}
	if err := saved(); err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, wire.ExportResult{Path: path})
}

// download is [api.deliver] without Dialogs.
func (a *api) download(w http.ResponseWriter, r *http.Request, name, contentType string, write func(io.Writer) error, saved func() error) {
	tmp, err := os.CreateTemp(a.tmpDir, "download-*.tmp")
	if err != nil {
		fail(w, r, err)
		return
	}
	defer removeTemp(tmp)
	if err := write(tmp); err != nil {
		fail(w, r, err)
		return
	}
	size, err := tmp.Seek(0, io.SeekCurrent)
	if err != nil {
		fail(w, r, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Content-Disposition", contentDisposition(name))
	h.Set("Content-Length", strconv.FormatInt(size, 10))
	if _, err := io.Copy(w, io.NewSectionReader(tmp, 0, size)); err != nil {
		return // the client did not get the file
	}
	if err := saved(); err != nil {
		slog.Error("teacherapi: after a download", "err", err)
	}
}

// spool copies the request body, capped at limit bytes, to a temporary file in
// the temp folder and returns the file and its size. A body over the cap,
// declared or read, gets a 413 "too_large", and any other failure the reply
// for its error; spool then returns ok false and leaves no file. Otherwise
// the caller removes the file with [removeTemp].
func (a *api) spool(w http.ResponseWriter, r *http.Request, limit int64) (f *os.File, size int64, ok bool) {
	if r.ContentLength > limit {
		httpx.Error(w, http.StatusRequestEntityTooLarge, "too_large")
		return nil, 0, false
	}
	f, err := os.CreateTemp(a.tmpDir, "spool-*.tmp")
	if err != nil {
		fail(w, r, err)
		return nil, 0, false
	}
	size, err = io.Copy(f, http.MaxBytesReader(w, r.Body, limit))
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &tooBig):
		httpx.Error(w, http.StatusRequestEntityTooLarge, "too_large")
	case err != nil:
		fail(w, r, err)
	default:
		return f, size, true
	}
	removeTemp(f)
	return nil, 0, false
}

// removeTemp closes and removes the temporary file f.
func removeTemp(f *os.File) {
	_ = f.Close()
	_ = os.Remove(f.Name())
}

// clearStale records that the assignment was exported, and clears its
// export_stale flag if its results are still the ones res holds.
func (a *api) clearStale(r *http.Request, res wire.AssignmentResults) error {
	return a.st.Q().ClearExportStale(r.Context(), db.ClearExportStaleParams{
		ExportedAt: sql.NullInt64{Int64: time.Now().UnixMilli(), Valid: true}, ResultsRev: res.ResultsRev, ID: res.AssignmentID,
	})
}

// replaceFile writes the file at path through a temporary file in the same
// folder and renames it into place, so the old file is replaced whole or not
// at all. The rename fails while another program, such as Excel on Windows,
// holds the old file open; the temporary file is removed on any failure.
func replaceFile(path string, write func(io.Writer) error) (err error) {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".klats-*.tmp")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = os.Remove(tmp.Name())
		}
	}()
	err = write(tmp)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp.Name(), 0o644)
	}
	if err == nil {
		err = os.Rename(tmp.Name(), path)
	}
	return err
}

// contentDisposition returns an attachment header for name: an ASCII-only
// fallback filename, and the real one in the RFC 5987 filename* form.
func contentDisposition(name string) string {
	fallback := strings.Map(func(r rune) rune {
		if r < 0x20 || r > 0x7e || r == '"' || r == '\\' || r == '%' {
			return '_'
		}
		return r
	}, name)
	var enc strings.Builder
	for _, b := range []byte(name) {
		if b < 0x80 && (b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || strings.IndexByte("!#$&+-.^_`|~", b) >= 0) {
			enc.WriteByte(b)
		} else {
			fmt.Fprintf(&enc, "%%%02X", b)
		}
	}
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, fallback, enc.String())
}
