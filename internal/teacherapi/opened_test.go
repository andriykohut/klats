package teacherapi

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

// writeFile writes body to name in a new temporary folder and returns its path.
func writeFile(t *testing.T, name, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestOpenedFilesInOrder(t *testing.T) {
	opened := NewOpenedFiles()
	// Added before the handler exists, as when Klats starts with the file.
	opened.Add(writeFile(t, "Дроби 7-Б.klats", "first"))
	v := setup(t, false, func(d *Deps) { d.Opened = opened })
	ch, unsubscribe := v.hub.Subscribe("teacher")
	defer unsubscribe()
	opened.Add(writeFile(t, "b.klats", "second"))
	select {
	case e := <-ch:
		if e.Name != "file_opened" {
			t.Errorf("event = %q, want file_opened", e.Name)
		}
	default:
		t.Error("Add published nothing")
	}

	w := v.do("GET", "/api/opened", nil)
	wantStatus(t, w, 200)
	if w.Body.String() != "first" || w.Header().Get("Content-Type") != "application/octet-stream" {
		t.Errorf("first file = %q, %q", w.Body, w.Header().Get("Content-Type"))
	}
	if name, err := url.PathUnescape(w.Header().Get("X-File-Name")); err != nil || name != "Дроби 7-Б.klats" {
		t.Errorf("X-File-Name = %q (%q, %v)", w.Header().Get("X-File-Name"), name, err)
	}
	w = v.do("GET", "/api/opened", nil)
	wantStatus(t, w, 200)
	if w.Body.String() != "second" || w.Header().Get("X-File-Name") != "b.klats" {
		t.Errorf("second file = %q named %q", w.Body, w.Header().Get("X-File-Name"))
	}
	wantStatus(t, v.do("GET", "/api/opened", nil), 204)
}

func TestOpenedFileMissing(t *testing.T) {
	opened := NewOpenedFiles()
	gone := writeFile(t, "gone.klats", "x")
	if err := os.Remove(gone); err != nil {
		t.Fatal(err)
	}
	opened.Add(gone)
	opened.Add(writeFile(t, "a.klats", "next"))
	v := setup(t, false, func(d *Deps) { d.Opened = opened })
	wantError(t, v.do("GET", "/api/opened", nil), 404, "file_missing")
	w := v.do("GET", "/api/opened", nil)
	wantStatus(t, w, 200)
	if w.Body.String() != "next" {
		t.Errorf("file after the missing one = %q", w.Body)
	}
}

func TestOpenedFileTooLarge(t *testing.T) {
	opened := NewOpenedFiles()
	big := writeFile(t, "big.klats", "")
	if err := os.Truncate(big, maxKlatsBytes+1); err != nil { // sparse
		t.Fatal(err)
	}
	opened.Add(big)
	v := setup(t, false, func(d *Deps) { d.Opened = opened })
	wantError(t, v.do("GET", "/api/opened", nil), 413, "too_large")
	wantStatus(t, v.do("GET", "/api/opened", nil), 204)
}

func TestOpenedNeedsToken(t *testing.T) {
	opened := NewOpenedFiles()
	opened.Add(writeFile(t, "a.klats", "kept"))
	v := setup(t, false, func(d *Deps) { d.Opened = opened })
	r := v.req("GET", "/api/opened", nil)
	r.Header.Del("Authorization")
	wantError(t, v.serve(r), 401, "unauthorized")
	w := v.do("GET", "/api/opened", nil)
	wantStatus(t, w, 200)
	if w.Body.String() != "kept" {
		t.Errorf("file after the refused request = %q", w.Body)
	}
}

func TestOpenedAddRouteOnlyInDev(t *testing.T) {
	path := writeFile(t, "a.klats", "dev")
	v := setup(t, false)
	if w := v.do("POST", "/api/opened", map[string]string{"path": path}); w.Code < 400 {
		t.Errorf("POST /api/opened without Dev = %d", w.Code)
	}
	wantStatus(t, v.do("GET", "/api/opened", nil), 204)

	v = setup(t, false, func(d *Deps) { d.Dev = true })
	wantStatus(t, v.do("POST", "/api/opened", map[string]string{"path": path}), 204)
	w := v.do("GET", "/api/opened", nil)
	wantStatus(t, w, 200)
	if w.Body.String() != "dev" {
		t.Errorf("file added through the dev route = %q", w.Body)
	}
}
