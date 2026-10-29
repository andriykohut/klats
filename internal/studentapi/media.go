package studentapi

import (
	"errors"
	"net/http"

	"klats/internal/httpx"
	"klats/internal/media"
)

// serveMedia serves a media file of the running test, or of the last ended
// one while none runs. Any other name, stored or not, is a 404, so a student
// cannot read files of tests they were not given. It needs no device token:
// names are content hashes, and the files are the test's own pictures and
// sounds.
func (a *api) serveMedia(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !a.e.HasMedia(name) {
		httpx.Error(w, http.StatusNotFound, "not_found")
		return
	}
	f, contentType, err := a.media.Open(name)
	if errors.Is(err, media.ErrNotFound) {
		httpx.Error(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		reply(w, r, nil, err)
		return
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		reply(w, r, nil, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("X-Content-Type-Options", "nosniff")
	if contentType == "image/svg+xml" {
		// An <img> never runs an SVG's scripts; this stops them when the
		// file is opened as a page of its own.
		h.Set("Content-Security-Policy", "sandbox")
	}
	http.ServeContent(w, r, "", info.ModTime(), f)
}
