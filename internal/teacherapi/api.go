// Package teacherapi is the HTTP API the teacher's desktop window calls, and
// the host of the teacher web app. It listens on 127.0.0.1 only and is
// guarded on every request by a Host check, an Origin check and a per-launch
// token (see [Handler]). Engine and database errors are mapped to fixed
// codes without internal detail.
package teacherapi

import (
	"database/sql"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"klats/internal/config"
	"klats/internal/events"
	"klats/internal/httpx"
	"klats/internal/lan"
	"klats/internal/media"
	"klats/internal/sitting"
	"klats/internal/store"
	"klats/internal/testfmt"
)

const (
	maxBodyBytes  = 4 << 20
	keepAliveTime = 15 * time.Second
	maxNameRunes  = 60
	maxLabelRunes = 20
	maxQRBytes    = 512
	qrPixels      = 512
	newTestTitle  = "Новий тест"
	xlsxType      = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	// maxKlatsBytes is the largest .klats file [klatsfile.Read] opens.
	maxKlatsBytes     = 256 << 20
	maxFileTitleRunes = 80
)

// Dialogs asks the teacher where to save a file, through the desktop window.
type Dialogs interface {
	// SaveFile returns the path the teacher chose, offering defaultName,
	// whose extension picks the file type the dialog offers. A cancelled
	// dialog returns an empty path and a nil error.
	SaveFile(defaultName string) (path string, err error)
}

// Deps are what [Handler] serves from.
type Deps struct {
	Store  *store.Store
	Engine *sitting.Engine
	Hub    *events.Hub
	Media  *media.Store
	Assets fs.FS // the built teacher app
	Token  string
	Port   int // this API's own port, for the Host and Origin checks
	// DataDir is where Settings are saved, and where opened files and
	// downloads are spooled.
	DataDir string
	// LANPort is the port the student server is bound to, or 0 when it is not
	// running. It can differ from Settings.Port, for example under a -port
	// override, and a saved port takes effect only at the next launch.
	LANPort int
	// LANError returns why the student server is not running, such as
	// "port_busy", or "" when it runs; nil means it runs.
	LANError func() string
	// Settings holds the saved settings. The handler copies it, and owns the
	// saved settings from then on.
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
	media   *media.Store
	token   string
	port    int
	dataDir string
	ifaces  func() []lan.Iface
	dialogs Dialogs
	lanPort int
	lanErr  func() string

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
		st: d.Store, eng: d.Engine, hub: d.Hub, media: d.Media, token: d.Token, port: d.Port, dataDir: d.DataDir,
		ifaces: d.Interfaces, dialogs: d.Dialogs, lanPort: d.LANPort, lanErr: d.LANError, settings: *d.Settings,
	}
	if a.ifaces == nil {
		a.ifaces = lan.System
	}
	if a.lanErr == nil {
		a.lanErr = func() string { return "" }
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/tests", a.listTests)
	mux.HandleFunc("POST /api/tests", a.createTest)
	mux.HandleFunc("GET /api/tests/{id}", a.getTest)
	mux.HandleFunc("PUT /api/tests/{id}", a.putTest)
	mux.HandleFunc("DELETE /api/tests/{id}", a.deleteTest)
	mux.HandleFunc("POST /api/tests/{id}/duplicate", a.duplicateTest)
	mux.HandleFunc("POST /api/tests/{id}/export", a.exportTest)
	mux.HandleFunc("POST /api/tests/import", a.importTest)

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
	mux.HandleFunc("POST /api/participants/{id}/time", a.addTime)
	mux.HandleFunc("POST /api/events/{id}/resolve", a.resolve)
	mux.HandleFunc("PUT /api/devices/{token}", a.renameDevice)

	mux.HandleFunc("GET /api/assignments", a.listAssignments)
	mux.HandleFunc("GET /api/assignments/{id}/results", a.results)
	mux.HandleFunc("PUT /api/assignments/{id}/overrides", a.override)
	mux.HandleFunc("POST /api/assignments/{id}/export", a.export)

	mux.HandleFunc("POST /api/media", a.putMedia)
	mux.HandleFunc("GET /api/media/{name}", a.getMedia)

	mux.HandleFunc("GET /api/network", a.getNetwork)
	mux.HandleFunc("PUT /api/network", a.putNetwork)
	mux.HandleFunc("GET /api/settings", a.getSettings)
	mux.HandleFunc("PUT /api/settings", a.putSettings)
	mux.HandleFunc("GET /api/events", a.events)
	mux.HandleFunc("GET /api/qr", a.qr)

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
	case errors.Is(err, sitting.ErrInvalid):
		httpx.Error(w, http.StatusBadRequest, "invalid")
	case errors.Is(err, sitting.ErrNotFound), errors.Is(err, sql.ErrNoRows):
		httpx.Error(w, http.StatusNotFound, "not_found")
	case errors.Is(err, testfmt.ErrTooNew):
		httpx.Error(w, http.StatusUnprocessableEntity, "test_too_new")
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
