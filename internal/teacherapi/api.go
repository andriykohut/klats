// Package teacherapi is the HTTP API the teacher's desktop window calls, and
// the host of the teacher web app. It listens on 127.0.0.1 only and is
// guarded on every request by a Host check, an Origin check and a per-launch
// token (see [Handler]). Engine and database errors are mapped to fixed
// codes without internal detail.
package teacherapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"klats/internal/config"
	"klats/internal/events"
	"klats/internal/httpx"
	"klats/internal/lan"
	"klats/internal/roster"
	"klats/internal/sitting"
	"klats/internal/sse"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
	"klats/internal/xlsx"
)

const (
	maxBodyBytes  = 4 << 20
	keepAliveTime = 15 * time.Second
	maxNameRunes  = 60
	maxLabelRunes = 20
	newTestTitle  = "Новий тест"
	xlsxType      = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

// Dialogs asks the teacher where to save a file, through the desktop window.
type Dialogs interface {
	// SaveFile returns the path the teacher chose, offering defaultName. A
	// cancelled dialog returns an empty path and a nil error.
	SaveFile(defaultName string) (path string, err error)
}

// Deps are what [Handler] serves from.
type Deps struct {
	Store  *store.Store
	Engine *sitting.Engine
	Hub    *events.Hub
	Assets fs.FS // the built teacher app
	Token  string
	Port   int // this API's own port, for the Host and Origin checks
	// DataDir is where Settings are saved.
	DataDir string
	// Settings holds the launch settings, with Port set to the student port in
	// use. The handler copies it, and owns the saved settings from then on.
	Settings *config.Settings
	// Interfaces lists the network interfaces; nil means [lan.System].
	Interfaces func() []lan.Iface
	// Dialogs picks the export target; nil makes the export a browser download.
	Dialogs Dialogs
}

type api struct {
	st      *store.Store
	eng     *sitting.Engine
	hub     *events.Hub
	token   string
	port    int
	dataDir string
	ifaces  func() []lan.Iface
	dialogs Dialogs
	// livePort is the student port of this launch. A port saved in settings
	// takes effect at the next launch, so the network URL keeps using this one.
	livePort int

	mu       sync.Mutex
	settings config.Settings // as saved on disk
}

// Handler returns the teacher API under /api/ and, for every other path, the
// teacher web app from d.Assets, falling back to its index.html. Every request
// passes [api.guard]. It does not build a server: the caller binds it to
// 127.0.0.1, sets the timeouts, and must not set a write timeout, which would
// cut the event stream.
func Handler(d Deps) http.Handler {
	a := &api{
		st: d.Store, eng: d.Engine, hub: d.Hub, token: d.Token, port: d.Port, dataDir: d.DataDir,
		ifaces: d.Interfaces, dialogs: d.Dialogs, livePort: d.Settings.Port, settings: *d.Settings,
	}
	if a.ifaces == nil {
		a.ifaces = lan.System
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/tests", a.listTests)
	mux.HandleFunc("POST /api/tests", a.createTest)
	mux.HandleFunc("GET /api/tests/{id}", a.getTest)
	mux.HandleFunc("PUT /api/tests/{id}", a.putTest)
	mux.HandleFunc("DELETE /api/tests/{id}", a.deleteTest)

	mux.HandleFunc("GET /api/classes", a.listClasses)
	mux.HandleFunc("POST /api/classes", a.createClass)
	mux.HandleFunc("POST /api/classes/parse", a.parseClass)
	mux.HandleFunc("GET /api/classes/{id}", a.getClass)
	mux.HandleFunc("PUT /api/classes/{id}", a.putClass)
	mux.HandleFunc("DELETE /api/classes/{id}", a.deleteClass)

	mux.HandleFunc("POST /api/sittings", a.startSitting)
	mux.HandleFunc("GET /api/sittings/current", a.live)
	mux.HandleFunc("POST /api/sittings/current/end", a.endSitting)
	mux.HandleFunc("POST /api/participants/{id}/kick", a.kick)
	mux.HandleFunc("POST /api/participants/{id}/move", a.move)
	mux.HandleFunc("POST /api/events/{id}/resolve", a.resolve)
	mux.HandleFunc("PUT /api/devices/{token}", a.renameDevice)

	mux.HandleFunc("GET /api/assignments", a.listAssignments)
	mux.HandleFunc("GET /api/assignments/{id}/results", a.results)
	mux.HandleFunc("PUT /api/assignments/{id}/overrides", a.override)
	mux.HandleFunc("POST /api/assignments/{id}/export", a.export)

	mux.HandleFunc("GET /api/network", a.getNetwork)
	mux.HandleFunc("PUT /api/network", a.putNetwork)
	mux.HandleFunc("GET /api/settings", a.getSettings)
	mux.HandleFunc("PUT /api/settings", a.putSettings)
	mux.HandleFunc("GET /api/events", a.events)

	spa := httpx.SPA(d.Assets)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if isAPI(r.URL.Path) {
			httpx.Error(w, http.StatusNotFound, "not_found")
			return
		}
		spa.ServeHTTP(w, r)
	})
	return a.guard(mux)
}

// fail writes the reply for an engine or database error.
func fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, sitting.ErrSittingActive):
		httpx.Error(w, http.StatusConflict, "sitting_active")
	case errors.Is(err, sitting.ErrHasProblems):
		httpx.JSON(w, http.StatusConflict, map[string]any{"error": "has_problems", "problems": []testfmt.Problem{}})
	case errors.Is(err, sitting.ErrInvalid):
		httpx.Error(w, http.StatusBadRequest, "invalid")
	case errors.Is(err, sitting.ErrNotFound), errors.Is(err, sql.ErrNoRows):
		httpx.Error(w, http.StatusNotFound, "not_found")
	default:
		slog.Error("teacherapi: request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		httpx.Error(w, http.StatusInternalServerError, "internal")
	}
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	return httpx.Decode(w, r, v, maxBodyBytes)
}

func noContent(w http.ResponseWriter, r *http.Request, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func problemsOf(t testfmt.Test) []testfmt.Problem {
	if p := t.Problems(); p != nil {
		return p
	}
	return []testfmt.Problem{}
}

func (a *api) listTests(w http.ResponseWriter, r *http.Request) {
	rows, err := a.st.Q().ListTests(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	out := make([]wire.TestSummary, 0, len(rows))
	for _, row := range rows {
		s := wire.TestSummary{ID: row.ID, Title: row.Title, UpdatedAt: row.UpdatedAt}
		if t, err := testfmt.Decode([]byte(row.Doc)); err != nil {
			slog.Warn("teacherapi: stored test does not decode", "test", row.ID, "err", err)
		} else {
			s.QuestionCount, s.Blocking = len(t.Questions), t.HasBlocking()
		}
		out = append(out, s)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func testDoc(row db.Test) (wire.TestDoc, error) {
	t, err := testfmt.Decode([]byte(row.Doc))
	if err != nil {
		return wire.TestDoc{}, fmt.Errorf("stored test %s: %w", row.ID, err)
	}
	return wire.TestDoc{ID: row.ID, Test: t, Problems: problemsOf(t), SavedAt: row.UpdatedAt}, nil
}

func (a *api) createTest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title string `json:"title"`
	}
	if !decode(w, r, &req) {
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = newTestTitle
	}
	id := store.NewID()
	t := testfmt.Test{ID: id, Version: 1, Title: title, Palette: testfmt.DefaultPalette, Questions: []testfmt.Question{}}
	doc, err := json.Marshal(t)
	if err != nil {
		fail(w, r, err)
		return
	}
	now := time.Now().UnixMilli()
	row := db.Test{ID: id, Title: title, Doc: string(doc), CreatedAt: now, UpdatedAt: now}
	err = a.st.Q().InsertTest(r.Context(), db.InsertTestParams{ID: id, Title: title, Doc: row.Doc, CreatedAt: now, UpdatedAt: now})
	if err != nil {
		fail(w, r, err)
		return
	}
	out, err := testDoc(row)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, out)
}

func (a *api) getTest(w http.ResponseWriter, r *http.Request) {
	row, err := a.st.Q().GetTest(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, r, err)
		return
	}
	out, err := testDoc(row)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) putTest(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var raw json.RawMessage
	if !decode(w, r, &raw) {
		return
	}
	if _, err := a.st.Q().GetTest(r.Context(), id); err != nil {
		fail(w, r, err)
		return
	}
	t, err := testfmt.Decode(raw)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid")
		return
	}
	t.ID = id
	doc, err := json.Marshal(t)
	if err != nil {
		fail(w, r, err)
		return
	}
	now := time.Now().UnixMilli()
	if err := a.st.Q().UpdateTest(r.Context(), db.UpdateTestParams{ID: id, Title: t.Title, Doc: string(doc), UpdatedAt: now}); err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, wire.SaveResult{Problems: problemsOf(t), SavedAt: now})
}

func (a *api) deleteTest(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := a.st.Q().GetTest(r.Context(), id); err != nil {
		fail(w, r, err)
		return
	}
	noContent(w, r, a.st.Q().DeleteTest(r.Context(), id))
}

func (a *api) listClasses(w http.ResponseWriter, r *http.Request) {
	q := a.st.Q()
	rows, err := q.ListClasses(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	out := make([]wire.ClassSummary, 0, len(rows))
	for _, c := range rows {
		students, err := q.ListStudents(r.Context(), c.ID)
		if err != nil {
			fail(w, r, err)
			return
		}
		out = append(out, wire.ClassSummary{ID: c.ID, Name: c.Name, StudentCount: len(students)})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func loadClass(ctx context.Context, q *db.Queries, id string) (wire.Class, error) {
	c, err := q.GetClass(ctx, id)
	if err != nil {
		return wire.Class{}, err
	}
	rows, err := q.ListStudents(ctx, id)
	if err != nil {
		return wire.Class{}, err
	}
	out := wire.Class{ID: c.ID, Name: c.Name, Students: make([]wire.Student, 0, len(rows))}
	for _, s := range rows {
		out.Students = append(out.Students, wire.Student{ID: s.ID, Name: s.Name})
	}
	return out, nil
}

func (a *api) getClass(w http.ResponseWriter, r *http.Request) {
	c, err := loadClass(r.Context(), a.st.Q(), r.PathValue("id"))
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, c)
}

// cleanClass normalizes the class name and the student names, drops students
// with an empty name, and returns [sitting.ErrInvalid] for an empty class
// name or a name over maxNameRunes.
func cleanClass(c wire.Class) (wire.Class, error) {
	c.Name = roster.Normalize(c.Name)
	if c.Name == "" || utf8.RuneCountInString(c.Name) > maxNameRunes {
		return c, sitting.ErrInvalid
	}
	students := make([]wire.Student, 0, len(c.Students))
	for _, s := range c.Students {
		s.Name = roster.Normalize(s.Name)
		if utf8.RuneCountInString(s.Name) > maxNameRunes {
			return c, sitting.ErrInvalid
		}
		if s.Name != "" {
			students = append(students, s)
		}
	}
	c.Students = students
	return c, nil
}

func (a *api) createClass(w http.ResponseWriter, r *http.Request) {
	var req wire.Class
	if !decode(w, r, &req) {
		return
	}
	req, err := cleanClass(req)
	if err != nil {
		fail(w, r, err)
		return
	}
	id := store.NewID()
	err = a.st.Tx(r.Context(), func(q *db.Queries) error {
		if err := q.InsertClass(r.Context(), db.InsertClassParams{ID: id, Name: req.Name, CreatedAt: time.Now().UnixMilli()}); err != nil {
			return err
		}
		for _, s := range req.Students {
			p := db.InsertStudentParams{ID: store.NewID(), ClassID: id, Name: s.Name, SortKey: roster.SortKey(s.Name)}
			if err := q.InsertStudent(r.Context(), p); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	c, err := loadClass(r.Context(), a.st.Q(), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, c)
}

// putClass renames the class and makes its students match the request:
// entries with an id of the class are updated, entries without one are added,
// and students left out are removed. It is all or nothing.
func (a *api) putClass(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req wire.Class
	if !decode(w, r, &req) {
		return
	}
	req, err := cleanClass(req)
	if err != nil {
		fail(w, r, err)
		return
	}
	err = a.st.Tx(r.Context(), func(q *db.Queries) error {
		ctx := r.Context()
		if _, err := q.GetClass(ctx, id); err != nil {
			return err
		}
		if err := q.RenameClass(ctx, db.RenameClassParams{Name: req.Name, ID: id}); err != nil {
			return err
		}
		existing, err := q.ListStudents(ctx, id)
		if err != nil {
			return err
		}
		unseen := make(map[string]bool, len(existing))
		for _, s := range existing {
			unseen[s.ID] = true
		}
		for _, s := range req.Students {
			key := roster.SortKey(s.Name)
			switch {
			case s.ID == "":
				err = q.InsertStudent(ctx, db.InsertStudentParams{ID: store.NewID(), ClassID: id, Name: s.Name, SortKey: key})
			case unseen[s.ID]:
				delete(unseen, s.ID)
				err = q.UpdateStudent(ctx, db.UpdateStudentParams{Name: s.Name, SortKey: key, ID: s.ID})
			default: // not a student of this class, or listed twice
				err = sitting.ErrInvalid
			}
			if err != nil {
				return err
			}
		}
		for sid := range unseen {
			if err := q.DeleteStudent(ctx, sid); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	c, err := loadClass(r.Context(), a.st.Q(), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, c)
}

func (a *api) deleteClass(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := a.st.Q().GetClass(r.Context(), id); err != nil {
		fail(w, r, err)
		return
	}
	noContent(w, r, a.st.Q().DeleteClass(r.Context(), id))
}

func (a *api) parseClass(w http.ResponseWriter, r *http.Request) {
	var req wire.ParseRequest
	if !decode(w, r, &req) {
		return
	}
	names := roster.ParsePaste(req.Text)
	if names == nil {
		names = []string{}
	}
	httpx.JSON(w, http.StatusOK, wire.ParseResult{Names: names})
}

func (a *api) startSitting(w http.ResponseWriter, r *http.Request) {
	var req wire.StartRequest
	if !decode(w, r, &req) {
		return
	}
	row, err := a.st.Q().GetTest(r.Context(), req.TestID)
	if err != nil {
		fail(w, r, err)
		return
	}
	t, err := testfmt.Decode([]byte(row.Doc))
	if err != nil {
		fail(w, r, fmt.Errorf("stored test %s: %w", row.ID, err))
		return
	}
	if t.HasBlocking() {
		httpx.JSON(w, http.StatusConflict, map[string]any{"error": "has_problems", "problems": problemsOf(t)})
		return
	}
	info, err := a.eng.Start(req.TestID, req.ClassID)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, info)
}

func (a *api) live(w http.ResponseWriter, r *http.Request) {
	snap, err := a.eng.Live()
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, snap)
}

func (a *api) endSitting(w http.ResponseWriter, r *http.Request) {
	noContent(w, r, a.eng.End())
}

func (a *api) kick(w http.ResponseWriter, r *http.Request) {
	noContent(w, r, a.eng.Kick(r.PathValue("id")))
}

func (a *api) move(w http.ResponseWriter, r *http.Request) {
	var req wire.MoveRequest
	if !decode(w, r, &req) {
		return
	}
	noContent(w, r, a.eng.Move(r.PathValue("id"), req.Device))
}

func (a *api) resolve(w http.ResponseWriter, r *http.Request) {
	var req wire.ResolveRequest
	if !decode(w, r, &req) {
		return
	}
	noContent(w, r, a.eng.ResolveEvent(r.PathValue("id"), req.Action))
}

func (a *api) renameDevice(w http.ResponseWriter, r *http.Request) {
	var req wire.LabelRequest
	if !decode(w, r, &req) {
		return
	}
	label := strings.TrimSpace(req.Label)
	if n := utf8.RuneCountInString(label); n < 1 || n > maxLabelRunes {
		httpx.Error(w, http.StatusBadRequest, "invalid")
		return
	}
	noContent(w, r, a.eng.RenameDevice(r.PathValue("token"), label))
}

func (a *api) listAssignments(w http.ResponseWriter, r *http.Request) {
	rows, err := a.st.Q().ListAssignments(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	out := make([]wire.AssignmentSummary, 0, len(rows))
	for _, row := range rows {
		out = append(out, wire.AssignmentSummary{
			ID: row.ID, TestTitle: row.TestTitle, ClassName: row.ClassName, CreatedAt: row.CreatedAt,
			Participants: int(row.Participants), ExportStale: row.ExportStale != 0,
		})
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
// response. Either way a finished export clears export_stale.
func (a *api) export(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	res, err := a.eng.Results(id)
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
		if err := a.st.Q().ClearExportStale(r.Context(), id); err != nil {
			fail(w, r, err)
			return
		}
		h := w.Header()
		h.Set("Content-Type", xlsxType)
		h.Set("Content-Disposition", contentDisposition(xlsx.FileName(res)))
		_, _ = w.Write(buf.Bytes())
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
	if err := a.st.Q().ClearExportStale(r.Context(), id); err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, wire.ExportResult{Path: path})
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

// networkInfo describes the address students use. The caller holds a.mu.
func (a *api) networkInfo(cands []netip.Addr) wire.NetworkInfo {
	info := wire.NetworkInfo{Candidates: make([]string, len(cands)), Port: a.livePort}
	for i, c := range cands {
		info.Candidates[i] = c.String()
	}
	if chosen, ok := lan.Choose(cands, a.settings.Address); ok {
		info.Address, info.URL = chosen.String(), lan.URL(chosen, a.livePort)
	}
	return info
}

func (a *api) getNetwork(w http.ResponseWriter, r *http.Request) {
	cands := lan.Candidates(a.ifaces())
	a.mu.Lock()
	defer a.mu.Unlock()
	httpx.JSON(w, http.StatusOK, a.networkInfo(cands))
}

func (a *api) putNetwork(w http.ResponseWriter, r *http.Request) {
	var req wire.NetworkRequest
	if !decode(w, r, &req) {
		return
	}
	addr, err := netip.ParseAddr(req.Address)
	cands := lan.Candidates(a.ifaces())
	if err != nil || !containsAddr(cands, addr) {
		httpx.Error(w, http.StatusBadRequest, "invalid")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	next := a.settings
	next.Address = addr.String()
	if err := config.Save(a.dataDir, next); err != nil {
		fail(w, r, err)
		return
	}
	a.settings = next
	httpx.JSON(w, http.StatusOK, a.networkInfo(cands))
}

func containsAddr(addrs []netip.Addr, a netip.Addr) bool {
	for _, c := range addrs {
		if c == a {
			return true
		}
	}
	return false
}

func (a *api) getSettings(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	httpx.JSON(w, http.StatusOK, wire.SettingsInfo{Port: a.settings.Port, Language: a.settings.Language})
}

func (a *api) putSettings(w http.ResponseWriter, r *http.Request) {
	var req wire.SettingsInfo
	if !decode(w, r, &req) {
		return
	}
	if (req.Language != "uk" && req.Language != "en") || req.Port < 1 || req.Port > 65535 {
		httpx.Error(w, http.StatusBadRequest, "invalid")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	next := a.settings
	next.Port, next.Language = req.Port, req.Language
	if err := config.Save(a.dataDir, next); err != nil {
		fail(w, r, err)
		return
	}
	a.settings = next
	a.eng.SetLanguage(next.Language)
	httpx.JSON(w, http.StatusOK, req)
}

// events streams the teacher's "live" hints until the client leaves.
func (a *api) events(w http.ResponseWriter, r *http.Request) {
	ch, unsubscribe := a.hub.Subscribe("teacher")
	defer unsubscribe()
	if err := sse.Stream(w, r, ch, keepAliveTime); err != nil {
		slog.Warn("teacherapi: event stream ended", "err", err)
	}
}
