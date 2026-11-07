package teacherapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	"github.com/andriykohut/klats/internal/events"
	"github.com/andriykohut/klats/internal/httpx"
)

// OpenedFiles queues the files the system asked Klats to open, such as a
// .klats file double-clicked in the file manager, until the teacher app takes
// them through GET /api/opened. It is safe for concurrent use.
type OpenedFiles struct {
	mu    sync.Mutex
	paths []string
	hub   *events.Hub // set by Handler
}

// NewOpenedFiles returns an empty queue. It can take files before [Handler]
// serves it, as when Klats starts with a file.
func NewOpenedFiles() *OpenedFiles { return &OpenedFiles{} }

// Add queues path and, once [Handler] serves the queue, publishes
// "file_opened" on the teacher topic. Paths added before that wait for the
// teacher app, which takes the queue when its library loads.
func (o *OpenedFiles) Add(path string) {
	o.mu.Lock()
	o.paths = append(o.paths, path)
	hub := o.hub
	o.mu.Unlock()
	if hub != nil {
		hub.Publish(events.Event{Topic: "teacher", Name: "file_opened"})
	}
}

func (o *OpenedFiles) attach(hub *events.Hub) {
	o.mu.Lock()
	o.hub = hub
	o.mu.Unlock()
}

func (o *OpenedFiles) take() (string, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if len(o.paths) == 0 {
		return "", false
	}
	path := o.paths[0]
	o.paths = o.paths[1:]
	return path, true
}

// takeOpened takes the oldest queued file and replies with its bytes and its
// base name, URL-path-escaped, in X-File-Name, or 204 when none is queued. It
// reads only paths that came through [OpenedFiles.Add], never one from the
// request. The file leaves the queue whatever happens: one over maxKlatsBytes
// is a 413 "too_large", and one that cannot be read a 404 "file_missing".
func (a *api) takeOpened(w http.ResponseWriter, _ *http.Request) {
	path, ok := a.opened.take()
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	f, err := os.Open(path)
	var info os.FileInfo
	if err == nil {
		defer func() { _ = f.Close() }()
		info, err = f.Stat()
	}
	switch {
	case err != nil || !info.Mode().IsRegular():
		slog.Warn("teacherapi: opened file unreadable", "path", path, "err", err)
		httpx.Error(w, http.StatusNotFound, "file_missing")
	case info.Size() > maxKlatsBytes:
		httpx.Error(w, http.StatusRequestEntityTooLarge, "too_large")
	default:
		h := w.Header()
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Content-Length", strconv.FormatInt(info.Size(), 10))
		h.Set("X-File-Name", url.PathEscape(filepath.Base(path)))
		_, _ = io.Copy(w, f)
	}
}

// addOpened queues the path in the request body as if the system had opened
// it. It is mounted only under -dev, for the end-to-end tests.
func (a *api) addOpened(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if !decode(w, r, &req) {
		return
	}
	a.opened.Add(req.Path)
	w.WriteHeader(http.StatusNoContent)
}
