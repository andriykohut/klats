package studentapi

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"klats/internal/media"
	"klats/internal/testfmt"
)

func png(fill byte) []byte {
	return append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{fill}, 64)...)
}

func TestStudentMediaOnlyFromSitting(t *testing.T) {
	var inTest, stored string
	v := setupWith(t, func(tst *testfmt.Test, ms *media.Store) {
		var err error
		if inTest, err = ms.Put(bytes.NewReader(png(1))); err != nil {
			t.Fatal(err)
		}
		if stored, err = ms.Put(bytes.NewReader(png(2))); err != nil {
			t.Fatal(err)
		}
		tst.Questions[0].Options[0].Image = &testfmt.Image{Src: inTest, W: 10, H: 10}
	})

	w := v.do("GET", "/api/media/"+inTest, "", nil) // no device header
	wantStatus(t, w, 200)
	h := w.Header()
	if h.Get("Content-Type") != "image/png" || h.Get("Cache-Control") != "public, max-age=31536000, immutable" ||
		h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Access-Control-Allow-Origin") != "*" ||
		h.Get("Content-Security-Policy") != "" {
		t.Errorf("headers = %v", h)
	}
	if !bytes.Equal(w.Body.Bytes(), png(1)) {
		t.Error("body differs from the stored file")
	}

	r := httptest.NewRequest("GET", "/api/media/"+inTest, nil)
	r.Header.Set("Range", "bytes=0-9")
	w = httptest.NewRecorder()
	v.h.ServeHTTP(w, r)
	wantStatus(t, w, http.StatusPartialContent)
	if w.Body.Len() != 10 || !strings.HasPrefix(w.Header().Get("Content-Range"), "bytes 0-9/") {
		t.Errorf("range reply: %d bytes, Content-Range %q", w.Body.Len(), w.Header().Get("Content-Range"))
	}

	for _, name := range []string{stored, strings.Repeat("e", 64) + ".png", "..%2Fklats.db", "x.png"} {
		wantError(t, v.do("GET", "/api/media/"+name, "", nil), 404, "not_found")
	}
}

func TestStudentMediaSandboxesSVG(t *testing.T) {
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><script>alert(1)</script></svg>`)
	var name string
	v := setupWith(t, func(tst *testfmt.Test, ms *media.Store) {
		var err error
		if name, err = ms.Put(bytes.NewReader(svg)); err != nil {
			t.Fatal(err)
		}
		tst.Questions[0].Options[0].Image = &testfmt.Image{Src: name, W: 300, H: 225}
	})
	w := v.do("GET", "/api/media/"+name, "", nil)
	wantStatus(t, w, 200)
	if h := w.Header(); h.Get("Content-Type") != "image/svg+xml" || h.Get("Content-Security-Policy") != "sandbox" {
		t.Errorf("headers = %v", h)
	}
}
