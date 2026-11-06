package teacherapi

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"klats/internal/httpx"
)

const (
	cookieName       = "klats_t"
	unauthorizedText = "Цю сторінку можна відкрити лише у вікні Клацу."
)

// NewToken returns a fresh launch token: 32 random bytes, base64url without
// padding.
func NewToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand does not fail on supported platforms
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

// guard admits only requests addressed to this API on the loopback interface,
// from a page of its own origin, that carry the launch token. The Host check
// stops DNS rebinding, the Origin check stops cross-site requests from a
// browser on the same machine, and the token stops other local programs. The
// one request allowed without the token is the bootstrap GET /?t=<token>,
// which sets the token cookie the app's own requests then carry.
func (a *api) guard(next http.Handler) http.Handler {
	hosts := []string{fmt.Sprintf("127.0.0.1:%d", a.port), fmt.Sprintf("localhost:%d", a.port)}
	origins := []string{"http://" + hosts[0], "http://" + hosts[1]}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !slices.Contains(hosts, r.Host) {
			httpx.Error(w, http.StatusForbidden, "forbidden_host")
			return
		}
		if o, present := r.Header["Origin"]; present && (len(o) != 1 || !slices.Contains(origins, o[0])) {
			httpx.Error(w, http.StatusForbidden, "forbidden_origin")
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/" && r.URL.Query().Has("t") {
			if !a.tokenEqual(r.URL.Query().Get("t")) {
				unauthorized(w, r)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: cookieName, Value: a.token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			w.Header().Set("Cache-Control", "no-store")
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		if !a.authorized(r) {
			unauthorized(w, r)
			return
		}
		if isAPI(r.URL.Path) {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func (a *api) tokenEqual(got string) bool {
	return subtle.ConstantTimeCompare([]byte(got), []byte(a.token)) == 1
}

// authorized reports whether the request carries the token as the cookie or
// as a bearer token.
func (a *api) authorized(r *http.Request) bool {
	if c, err := r.Cookie(cookieName); err == nil && a.tokenEqual(c.Value) {
		return true
	}
	bearer, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return ok && a.tokenEqual(bearer)
}

func unauthorized(w http.ResponseWriter, r *http.Request) {
	if isAPI(r.URL.Path) {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(unauthorizedText))
}

func isAPI(urlPath string) bool {
	return urlPath == "/api" || strings.HasPrefix(urlPath, "/api/")
}
