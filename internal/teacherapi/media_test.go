package teacherapi

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"klats/internal/wire"
)

func pngBytes() []byte {
	return append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{7}, 64)...)
}

func TestTeacherMediaUploadAndServe(t *testing.T) {
	v := setup(t, false)
	w := v.do("POST", "/api/media", pngBytes())
	wantStatus(t, w, 201)
	name := decodeBody[wire.MediaResult](t, w).Name
	if len(name) != 64+len(".png") || !strings.HasSuffix(name, ".png") {
		t.Fatalf("name = %q", name)
	}

	w = v.do("GET", "/api/media/"+name, nil)
	wantStatus(t, w, 200)
	if w.Header().Get("Content-Type") != "image/png" || w.Header().Get("Cache-Control") != "private, max-age=31536000, immutable" ||
		w.Header().Get("Content-Security-Policy") != "" {
		t.Errorf("headers = %v", w.Header())
	}
	if !bytes.Equal(w.Body.Bytes(), pngBytes()) {
		t.Error("served bytes differ from the upload")
	}

	wantError(t, v.do("POST", "/api/media", []byte("<html><script>alert(1)</script></html>")), 415, "unsupported")
	wantError(t, v.do("GET", "/api/media/"+strings.Repeat("0", 64)+".png", nil), 404, "not_found")
	wantError(t, v.do("GET", "/api/media/x.png", nil), 404, "not_found")
}

func TestTeacherMediaSandboxesSVG(t *testing.T) {
	v := setup(t, false)
	w := v.do("POST", "/api/media", []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><script>alert(1)</script></svg>`))
	wantStatus(t, w, 201)
	name := decodeBody[wire.MediaResult](t, w).Name
	if !strings.HasSuffix(name, ".svg") {
		t.Fatalf("name = %q", name)
	}
	w = v.do("GET", "/api/media/"+name, nil)
	wantStatus(t, w, 200)
	if h := w.Header(); h.Get("Content-Type") != "image/svg+xml" || h.Get("Content-Security-Policy") != "sandbox" {
		t.Errorf("headers = %v", h)
	}
}

func TestTeacherMediaUploadCaps(t *testing.T) {
	v := setup(t, false)
	big := append([]byte("OggS"), make([]byte, 10<<20)...) // 10 MiB + 4 bytes
	wantError(t, v.do("POST", "/api/media", big), 413, "too_large")
	r := v.req("POST", "/api/media", big)
	r.ContentLength = -1 // chunked: only the body reader enforces the cap
	wantError(t, v.serve(r), 413, "too_large")
	wantError(t, v.do("POST", "/api/media", append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 5<<20)...)), 413, "too_large")
}

func TestTeacherMediaNeedsToken(t *testing.T) {
	v := setup(t, false)
	r := httptest.NewRequest("GET", "/api/media/"+strings.Repeat("0", 64)+".png", nil)
	r.Host = v.req("GET", "/", nil).Host
	wantError(t, v.serve(r), http.StatusUnauthorized, "unauthorized")
}
