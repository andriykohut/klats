// Package httpx holds the JSON, static-file and file-name plumbing shared by
// the student and teacher HTTP APIs.
package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"slices"
	"strings"
)

var errTrailing = errors.New("httpx: data after the JSON value")

// JSON writes v as the JSON response with the given status.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("httpx: write response", "err", err)
	}
}

// Error writes {"error": code} with the given status.
func Error(w http.ResponseWriter, status int, code string) {
	JSON(w, status, map[string]string{"error": code})
}

// Decode reads the JSON request body, capped at limit bytes, into v. It writes
// a 413 "too_large" for a body over the cap and a 400 "invalid" for anything
// else unreadable (including data after the JSON value), and reports whether v
// is filled.
func Decode(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	if r.ContentLength > limit {
		Error(w, http.StatusRequestEntityTooLarge, "too_large")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	err := dec.Decode(v)
	if err == nil {
		// Anything but whitespace after the value is a malformed body.
		if _, tail := dec.Token(); tail != io.EOF {
			err = errTrailing
			var tooBig *http.MaxBytesError
			if errors.As(tail, &tooBig) {
				err = tail
			}
		}
	}
	if err == nil {
		return true
	}
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		Error(w, http.StatusRequestEntityTooLarge, "too_large")
	} else {
		Error(w, http.StatusBadRequest, "invalid")
	}
	return false
}

// SPA serves the file at the request path from assets, or index.html for any
// path that is not a file, so client-side routes survive a reload. Files under
// /assets/ are cached as immutable and a missing one is a plain 404, never the
// HTML fallback; index.html is always revalidated. A path with a segment
// starting with a dot is a plain 404, so dotfiles in the embedded build are
// never served. Only GET and HEAD are allowed.
func SPA(assets fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if slices.ContainsFunc(strings.Split(name, "/"), func(seg string) bool { return strings.HasPrefix(seg, ".") }) {
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}
		info, err := fs.Stat(assets, name)
		missing := name == "" || err != nil || info.IsDir()
		inAssets := name == "assets" || strings.HasPrefix(name, "assets/")
		switch {
		case inAssets && missing:
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		case inAssets:
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		default:
			w.Header().Set("Cache-Control", "no-cache")
			if missing {
				name = "index.html"
			}
		}
		http.ServeFileFS(w, r, assets, name)
	})
}

// SafeFileName returns s as a file name every OS accepts: characters invalid
// in Windows file names and control characters become "_", it is cut to
// maxRunes when maxRunes is positive, and trailing dots and spaces are
// trimmed. It may return "".
func SafeFileName(s string, maxRunes int) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`\/:*?"<>|`, r) {
			return '_'
		}
		return r
	}, s)
	if rs := []rune(s); maxRunes > 0 && len(rs) > maxRunes {
		s = string(rs[:maxRunes])
	}
	return strings.TrimRight(s, ". ")
}
