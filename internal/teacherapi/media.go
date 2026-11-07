package teacherapi

import (
	"errors"
	"net/http"

	"github.com/andriykohut/klats/internal/httpx"
	"github.com/andriykohut/klats/internal/media"
	"github.com/andriykohut/klats/internal/wire"
)

// maxUploadBytes is the largest upload body: the audio cap of [media.Store.Put].
const maxUploadBytes = 10 << 20

// putMedia stores the request body as a media file. The store sniffs the type
// and enforces the per-kind size caps.
func (a *api) putMedia(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength > maxUploadBytes {
		httpx.Error(w, http.StatusRequestEntityTooLarge, "too_large")
		return
	}
	name, err := a.media.Put(http.MaxBytesReader(w, r.Body, maxUploadBytes))
	var tooBig *http.MaxBytesError
	switch {
	case err == nil:
		httpx.JSON(w, http.StatusCreated, wire.MediaResult{Name: name})
	case errors.Is(err, media.ErrUnsupported):
		httpx.Error(w, http.StatusUnsupportedMediaType, "unsupported")
	case errors.Is(err, media.ErrTooLarge), errors.As(err, &tooBig):
		httpx.Error(w, http.StatusRequestEntityTooLarge, "too_large")
	default:
		fail(w, r, err)
	}
}

// getMedia serves a stored media file. Names are content hashes, so the
// browser may keep a file for good.
func (a *api) getMedia(w http.ResponseWriter, r *http.Request) {
	f, contentType, err := a.media.Open(r.PathValue("name"))
	if errors.Is(err, media.ErrNotFound) {
		httpx.Error(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		fail(w, r, err)
		return
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		fail(w, r, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	h.Set("X-Content-Type-Options", "nosniff")
	if contentType == "image/svg+xml" {
		// An <img> never runs an SVG's scripts; this stops them when the
		// file is opened as a page of its own.
		h.Set("Content-Security-Policy", "sandbox")
	}
	http.ServeContent(w, r, "", info.ModTime(), f)
}
