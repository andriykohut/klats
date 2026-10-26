package httpx

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

var assets = fstest.MapFS{
	"index.html":      {Data: []byte("<html>spa</html>")},
	"assets/app-1.js": {Data: []byte("console.log(1)")},
	".keep":           {Data: []byte("secret")},
	"assets/.hidden":  {Data: []byte("secret")},
}

func get(h http.Handler, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, path, nil))
	return w
}

func TestSPAFallback(t *testing.T) {
	h := SPA(assets)
	w := get(h, "GET", "/join")
	if w.Code != 200 || w.Body.String() != "<html>spa</html>" || w.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("/join = %d %q, cache %q", w.Code, w.Body, w.Header().Get("Cache-Control"))
	}
	w = get(h, "GET", "/")
	if w.Code != 200 || w.Body.String() != "<html>spa</html>" {
		t.Errorf("/ = %d %q", w.Code, w.Body)
	}
	w = get(h, "GET", "/assets/app-1.js")
	if w.Body.String() != "console.log(1)" || w.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Errorf("asset = %q, cache %q", w.Body, w.Header().Get("Cache-Control"))
	}
	for _, missing := range []string{"/assets/gone.js", "/assets/", "/assets"} {
		w = get(h, "GET", missing)
		if w.Code != 404 || w.Header().Get("Cache-Control") != "no-store" || strings.Contains(w.Body.String(), "spa") {
			t.Errorf("%s = %d, cache %q, body %q", missing, w.Code, w.Header().Get("Cache-Control"), w.Body)
		}
	}
	for _, hidden := range []string{"/.keep", "/assets/.hidden", "/sub/.hidden/x", "/.well-known/x"} {
		w = get(h, "GET", hidden)
		if w.Code != 404 || strings.Contains(w.Body.String(), "secret") || strings.Contains(w.Body.String(), "spa") {
			t.Errorf("%s = %d %q, want a plain 404", hidden, w.Code, w.Body)
		}
	}
	w = get(h, "POST", "/")
	if w.Code != 405 || w.Header().Get("Allow") != "GET, HEAD" {
		t.Errorf("POST / = %d, Allow %q", w.Code, w.Header().Get("Allow"))
	}
}

func decodeWith(body string, limit int64) (*httptest.ResponseRecorder, bool) {
	var v struct{ A int }
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/", io.MultiReader(bytes.NewReader([]byte(body)))) // no Content-Length
	return w, Decode(w, r, &v, limit)
}

func TestDecode(t *testing.T) {
	if _, ok := decodeWith(`{"A":1} `+"\n", 100); !ok {
		t.Error("valid body refused")
	}
	for _, tc := range []struct {
		body   string
		limit  int64
		status int
		code   string
	}{
		{`{"A":1} x`, 100, 400, "invalid"},
		{`{"A":1}{}`, 100, 400, "invalid"},
		{`{not json`, 100, 400, "invalid"},
		{`{"A":1}` + strings.Repeat(" ", 200), 100, 413, "too_large"},
		{`{"A":"` + strings.Repeat("1", 200) + `"}`, 100, 413, "too_large"},
	} {
		w, ok := decodeWith(tc.body, tc.limit)
		var got map[string]string
		_ = json.Unmarshal(w.Body.Bytes(), &got)
		if ok || w.Code != tc.status || got["error"] != tc.code {
			t.Errorf("%.20q: ok=%v status=%d body=%s", tc.body, ok, w.Code, w.Body)
		}
	}
	// A declared length over the cap is refused before reading.
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"A":1}`))
	r.ContentLength = 1000
	w := httptest.NewRecorder()
	if Decode(w, r, new(struct{}), 100) || w.Code != 413 {
		t.Errorf("declared length: status %d", w.Code)
	}
}

func TestSafeFileName(t *testing.T) {
	for _, tc := range []struct {
		in   string
		max  int
		want string
	}{
		{"Дроби", 0, "Дроби"},
		{"7/8: Дроби?", 80, "7_8_ Дроби_"},
		{`a\b*c"d<e>f|g`, 0, "a_b_c_d_e_f_g"},
		{"Тест\n1...", 0, "Тест_1"},
		{" . ", 0, ""},
		{strings.Repeat("ї", 150), 100, strings.Repeat("ї", 100)},
		{"ab. cd", 3, "ab"},
	} {
		if got := SafeFileName(tc.in, tc.max); got != tc.want {
			t.Errorf("SafeFileName(%q, %d) = %q, want %q", tc.in, tc.max, got, tc.want)
		}
	}
}
