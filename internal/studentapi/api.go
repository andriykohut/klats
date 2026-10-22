// Package studentapi is the HTTP API student browsers call over the school
// LAN, and the host of the student web app. It is the only thing the program
// exposes on the network, so every request is untrusted: device tokens are
// validated, bodies are capped, join and pick are rate limited, and engine
// errors are mapped to fixed codes without internal detail.
package studentapi

import (
	"errors"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"sync"
	"time"

	"klats/internal/events"
	"klats/internal/httpx"
	"klats/internal/sitting"
	"klats/internal/sse"
	"klats/internal/wire"
)

// deviceHeader carries the device token of every API call except the event
// stream, which takes it as the device query parameter because EventSource
// cannot set headers.
const deviceHeader = "X-Klats-Device"

const (
	maxBodyBytes    = 256 << 10
	maxStreamsPerIP = 64
	keepAliveTime   = 15 * time.Second
)

var deviceRE = regexp.MustCompile(`^[a-z2-7]{22,64}$`)

type api struct {
	e    *sitting.Engine
	hub  *events.Hub
	spa  http.Handler
	rate *limiter

	streamsMu sync.Mutex
	streams   map[string]int // client IP → open event streams
}

// Handler returns the student API under /api/ and, for every other path, the
// student web app from assets, falling back to its index.html. It does not
// build a server: the caller sets the timeouts, and must not set a write
// timeout, which would cut the event streams.
func Handler(e *sitting.Engine, hub *events.Hub, assets fs.FS) http.Handler {
	return newHandler(e, hub, assets, time.Now)
}

func newHandler(e *sitting.Engine, hub *events.Hub, assets fs.FS, now func() time.Time) http.Handler {
	a := &api{e: e, hub: hub, spa: httpx.SPA(assets), rate: newLimiter(now), streams: map[string]int{}}
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
		if !isAPI(r.URL.Path) {
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
				httpx.Error(w, http.StatusRequestEntityTooLarge, "too_large")
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
			httpx.Error(w, http.StatusBadRequest, "invalid_device")
			return
		}
		next(w, r, token)
	}
}

func isAPI(urlPath string) bool {
	return urlPath == "/api" || strings.HasPrefix(urlPath, "/api/")
}

func (a *api) join(w http.ResponseWriter, r *http.Request, device string) {
	var req wire.JoinRequest
	if !a.admit(w, r, device) || !httpx.Decode(w, r, &req, maxBodyBytes) {
		return
	}
	info, err := a.e.Join(req.Code, device, clientIP(r))
	reply(w, r, info, err)
}

func (a *api) pick(w http.ResponseWriter, r *http.Request, device string) {
	var req wire.PickBody
	if !a.admit(w, r, device) || !httpx.Decode(w, r, &req, maxBodyBytes) {
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
	if !httpx.Decode(w, r, &req, maxBodyBytes) {
		return
	}
	res, err := a.e.Submit(device, req.Changes, req.Pending)
	reply(w, r, res, err)
}

func (a *api) heartbeat(w http.ResponseWriter, r *http.Request, device string) {
	var req wire.HeartbeatRequest
	if !httpx.Decode(w, r, &req, maxBodyBytes) {
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
	var req wire.FocusRequest
	if !httpx.Decode(w, r, &req, maxBodyBytes) {
		return
	}
	a.e.Focus(device, req.Left)
	w.WriteHeader(http.StatusNoContent)
}

// events streams the "status" hints for the device until the client leaves.
// With sitting set to the running sitting's id, it also streams that
// sitting's "taken" names (see [wire.NamesTaken]); another id is ignored.
func (a *api) events(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("device")
	if !deviceRE.MatchString(token) {
		httpx.Error(w, http.StatusBadRequest, "invalid_device")
		return
	}
	ip := limitKey(r.RemoteAddr)
	if !a.openStream(ip) {
		w.Header().Set("Retry-After", "60")
		httpx.Error(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	defer a.closeStream(ip)
	topics := []string{"device:" + token}
	if id := r.URL.Query().Get("sitting"); id != "" && id == a.e.SittingID() {
		topics = append(topics, "names:"+id)
	}
	ch, unsubscribe := a.hub.Subscribe(topics...)
	defer unsubscribe()
	if err := sse.Stream(w, r, ch, keepAliveTime); err != nil {
		slog.Warn("studentapi: event stream ended", "err", err)
	}
}

// openStream takes one of the client's event stream slots, if one is free.
func (a *api) openStream(ip string) bool {
	a.streamsMu.Lock()
	defer a.streamsMu.Unlock()
	if a.streams[ip] >= maxStreamsPerIP {
		return false
	}
	a.streams[ip]++
	return true
}

func (a *api) closeStream(ip string) {
	a.streamsMu.Lock()
	defer a.streamsMu.Unlock()
	if a.streams[ip]--; a.streams[ip] == 0 {
		delete(a.streams, ip)
	}
}

// static serves the student web app. Unknown /api/ paths are a JSON 404, so
// a mistyped call is never answered with HTML.
func (a *api) static(w http.ResponseWriter, r *http.Request) {
	if isAPI(r.URL.Path) {
		httpx.Error(w, http.StatusNotFound, "not_found")
		return
	}
	a.spa.ServeHTTP(w, r)
}

// admit counts a join or pick against the device and IP windows. When either
// is full it writes the 429 reply and returns false.
func (a *api) admit(w http.ResponseWriter, r *http.Request, device string) bool {
	if a.rate.allow(limitKey(r.RemoteAddr), device) {
		return true
	}
	w.Header().Set("Retry-After", "60")
	httpx.Error(w, http.StatusTooManyRequests, "rate_limited")
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

// limitKey returns the key the per-client limits count remoteAddr under: the
// IPv4 address, or the /64 prefix of an IPv6 address, since a single IPv6
// client holds a whole /64 and could otherwise rotate addresses past the limits.
func limitKey(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	addr = addr.WithZone("").Unmap()
	if addr.Is4() {
		return addr.String()
	}
	return netip.PrefixFrom(addr, 64).Masked().String()
}

// reply writes v as the JSON response, or the mapped error when err is set.
func reply(w http.ResponseWriter, r *http.Request, v any, err error) {
	if err == nil {
		httpx.JSON(w, http.StatusOK, v)
		return
	}
	var taken sitting.ErrNameTaken
	switch {
	case errors.As(err, &taken):
		httpx.JSON(w, http.StatusConflict, map[string]string{"error": "name_taken", "label": taken.Label})
	case errors.Is(err, sitting.ErrBadCode):
		httpx.Error(w, http.StatusNotFound, "bad_code")
	case errors.Is(err, sitting.ErrNotJoined):
		httpx.Error(w, http.StatusNotFound, "not_joined")
	case errors.Is(err, sitting.ErrKicked):
		httpx.Error(w, http.StatusForbidden, "kicked")
	case errors.Is(err, sitting.ErrInvalid):
		httpx.Error(w, http.StatusBadRequest, "invalid")
	case errors.Is(err, sitting.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "not_found")
	default:
		slog.Error("studentapi: request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		httpx.Error(w, http.StatusInternalServerError, "internal")
	}
}
