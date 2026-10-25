package teacherapi

import (
	"bytes"
	"database/sql"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"klats/internal/httpx"
	"klats/internal/store/db"
	"klats/internal/wire"
	"klats/internal/xlsx"
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

// export writes the assignment's results workbook. With Dialogs the teacher
// picks the file, which is replaced atomically; without, the workbook is the
// response. A finished export records exported_at, which sets
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
	if a.dialogs == nil {
		var buf bytes.Buffer
		if err := xlsx.Export(&buf, res, lang); err != nil {
			fail(w, r, err)
			return
		}
		h := w.Header()
		h.Set("Content-Type", xlsxType)
		h.Set("Content-Disposition", contentDisposition(xlsx.FileName(res)))
		if _, err := w.Write(buf.Bytes()); err != nil {
			return // the client did not get the file
		}
		// The status is sent, so a failure here can only be logged.
		if err := a.clearStale(r, res); err != nil {
			slog.Error("teacherapi: clear export_stale", "err", err)
		}
		return
	}
	path, err := a.dialogs.SaveFile(xlsx.FileName(res))
	if err != nil {
		fail(w, r, fmt.Errorf("save dialog: %w", err))
		return
	}
	if path == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := replaceFile(path, func(w io.Writer) error { return xlsx.Export(w, res, lang) }); err != nil {
		slog.Warn("teacherapi: export not written", "err", err)
		httpx.Error(w, http.StatusConflict, "write_failed")
		return
	}
	if err := a.clearStale(r, res); err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, wire.ExportResult{Path: path})
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
