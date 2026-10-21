// Package studentapi is the HTTP API student browsers call over the school
// LAN, and the host of the student web app. It is the only thing the program
// exposes on the network, so every request is untrusted: device tokens are
// validated, bodies are capped, join and pick are rate limited, and engine
// errors are mapped to fixed codes without internal detail.
package studentapi

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"

	"klats/internal/events"
	"klats/internal/sitting"
	"klats/internal/sse"
	"klats/internal/wire"
)

// deviceHeader carries the device token of every API call except the event
// stream, which takes it as the device query parameter because EventSource
// cannot set headers.
const deviceHeader = "X-Klats-Device"

const (
	maxBodyBytes  = 256 << 10
	keepAliveTime = 15 * time.Second
)

var deviceRE = regexp.MustCompile(`^[a-z2-7]{22,64}$`)

type api struct {
	e      *sitting.Engine
	hub    *events.Hub
	assets fs.FS
	rate   *limiter
}

// Handler returns the student API under /api/ and, for every other path, the
// student web app from assets, falling back to its index.html. It does not
// build a server: the caller sets the timeouts, and must not set a write
// timeout, which would cut the event streams.
func Handler(e *sitting.Engine, hub *events.Hub, assets fs.FS) http.Handler {
	return newHandler(e, hub, assets, time.Now)
}

func newHandler(e *sitting.Engine, hub *events.Hub, assets fs.FS, now func() time.Time) http.Handler {
	a := &api{e: e, hub: hub, assets: assets, rate: newLimiter(now)}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/join", a.device(a.join))
	mux.HandleFunc("POST /api/pick", a.device(a.pick))
	mux.HandleFunc("GET /api/test", a.device(a.test))
	mux.HandleFunc("POST /api/answers", a.device(a.answers))
	mux.HandleFunc("POST /api/heartbeat", a.device(a.heartbeat))
	mux.HandleFunc("POST /api/finish", a.device(a.finish))
	mux.HandleFunc("POST /api/focus", a.device(a.focus))
	mux.HandleFunc("GET /api/events", a.events)
	mux.HandleFunc("/", a.static)
	return a.apiMiddleware(mux)
}

// apiMiddleware answers CORS for /api/ (any origin, no credentials, so
// the student app also works from a dev server on another port), turns
// preflights into 204 and caps POST bodies.
func (a *api) apiMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Content-Type, "+deviceHeader)
		h.Set("Access-Control-Max-Age", "600")
		h.Set("Cache-Control", "no-store")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method == http.MethodPost {
			if r.ContentLength > maxBodyBytes {
				writeError(w, http.StatusRequestEntityTooLarge, "too_large")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

// device validates the device token header and passes the token on.
func (a *api) device(next func(w http.ResponseWriter, r *http.Request, device string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get(deviceHeader)
		if !deviceRE.MatchString(token) {
			writeError(w, http.StatusBadRequest, "invalid_device")
			return
		}
		next(w, r, token)
	}
}

type joinRequest struct {
	Code string `json:"code"`
}

type pickRequest struct {
	wire.PickRequest
	Code string `json:"code"`
}

type focusRequest struct {
	Left bool `json:"left"`
}

func (a *api) join(w http.ResponseWriter, r *http.Request, device string) {
	var req joinRequest
	if !a.limited(w, r, device) || !decode(w, r, &req) {
		return
	}
	info, err := a.e.Join(req.Code, device, clientIP(r))
	reply(w, r, info, err)
}

func (a *api) pick(w http.ResponseWriter, r *http.Request, device string) {
	var req pickRequest
	if !a.limited(w, r, device) || !decode(w, r, &req) {
		return
	}
	p, err := a.e.Pick(req.Code, device, req.PickRequest)
	reply(w, r, p, err)
}

func (a *api) test(w http.ResponseWriter, r *http.Request, device string) {
	res, err := a.e.Resume(device)
	reply(w, r, res, err)
}

func (a *api) answers(w http.ResponseWriter, r *http.Request, device string) {
	var req wire.SubmitRequest
	if !decode(w, r, &req) {
		return
	}
	res, err := a.e.Submit(device, req.Changes, req.Pending)
	reply(w, r, res, err)
}

func (a *api) heartbeat(w http.ResponseWriter, r *http.Request, device string) {
	var req wire.HeartbeatRequest
	if !decode(w, r, &req) {
		return
	}
	st, err := a.e.Heartbeat(device, req.Pending)
	reply(w, r, st, err)
}

func (a *api) finish(w http.ResponseWriter, r *http.Request, device string) {
	res, err := a.e.Finish(device)
	reply(w, r, res, err)
}

func (a *api) focus(w http.ResponseWriter, r *http.Request, device string) {
	var req focusRequest
	if !decode(w, r, &req) {
		return
	}
	a.e.Focus(device, req.Left)
	w.WriteHeader(http.StatusNoContent)
}

// events streams the "status" hints for the device until the client leaves.
func (a *api) events(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("device")
	if !deviceRE.MatchString(token) {
		writeError(w, http.StatusBadRequest, "invalid_device")
		return
	}
	ch, unsubscribe := a.hub.Subscribe("device:" + token)
	defer unsubscribe()
	if err := sse.Stream(w, r, ch, keepAliveTime); err != nil {
		slog.Warn("studentapi: event stream ended", "err", err)
	}
}

// static serves the file at the request path from the assets, or index.html
// for any path that is not a file, so client-side routes survive a reload.
// Unknown /api/ paths are a JSON 404.
func (a *api) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if info, err := fs.Stat(a.assets, name); name == "" || err != nil || info.IsDir() {
		name = "index.html"
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFileFS(w, r, a.assets, name)
}

// limited counts a join or pick against the device and IP windows and writes
// the 429 reply when either is full.
func (a *api) limited(w http.ResponseWriter, r *http.Request, device string) bool {
	if a.rate.allow(clientIP(r), device) {
		return true
	}
	w.Header().Set("Retry-After", "60")
	writeError(w, http.StatusTooManyRequests, "rate_limited")
	return false
}

// clientIP returns the host of the request's remote address, without a port.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// decode reads the JSON body into v. It writes a 413 for a body over the cap
// and a 400 for anything else unreadable, and reports whether v is filled.
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	err := json.NewDecoder(r.Body).Decode(v)
	if err == nil {
		return true
	}
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large")
	} else {
		writeError(w, http.StatusBadRequest, "invalid")
	}
	return false
}

// reply writes v as the JSON response, or the mapped error when err is set.
func reply(w http.ResponseWriter, r *http.Request, v any, err error) {
	if err == nil {
		writeJSON(w, http.StatusOK, v)
		return
	}
	var taken sitting.ErrNameTaken
	switch {
	case errors.As(err, &taken):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "name_taken", "label": taken.Label})
	case errors.Is(err, sitting.ErrBadCode):
		writeError(w, http.StatusNotFound, "bad_code")
	case errors.Is(err, sitting.ErrNotJoined):
		writeError(w, http.StatusNotFound, "not_joined")
	case errors.Is(err, sitting.ErrKicked):
		writeError(w, http.StatusForbidden, "kicked")
	case errors.Is(err, sitting.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid")
	case errors.Is(err, sitting.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found")
	default:
		slog.Error("studentapi: request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		writeError(w, http.StatusInternalServerError, "internal")
	}
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("studentapi: write response", "err", err)
	}
}
