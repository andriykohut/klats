package main

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"klats/internal/store"
)

func TestDevModeServes(t *testing.T) {
	// The real app is in web/student/dist only after `make web`.
	built := studentUI
	studentUI = fstest.MapFS{"index.html": {Data: []byte("<html>student</html>")}}
	t.Cleanup(func() { studentUI = built })
	var logs bytes.Buffer
	t.Cleanup(func() {
		if t.Failed() {
			t.Log(logs.String())
		}
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	out, stdout := io.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, []string{"-dev", "-port", "0", "-data", t.TempDir()}, stdout, &logs)
		_ = stdout.Close()
	}()

	var keys []string
	lines := map[string]string{}
	sc := bufio.NewScanner(out)
	for len(keys) < 3 && sc.Scan() {
		k, v, _ := strings.Cut(sc.Text(), " ")
		keys, lines[k] = append(keys, k), v
	}
	if strings.Join(keys, ",") != "student,lan,teacher" {
		t.Fatalf("printed %q, want student, lan and teacher lines", lines)
	}
	go func() { _, _ = io.Copy(io.Discard, out) }()

	get := func(u string, header http.Header) int {
		t.Helper()
		req, err := http.NewRequest("GET", u, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header = header
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	if code := get(lines["student"]+"/", nil); code != 200 {
		t.Errorf("GET student / = %d, want 200", code)
	}
	teacher, err := url.Parse(lines["teacher"])
	if err != nil || teacher.Hostname() != "127.0.0.1" {
		t.Fatalf("teacher URL %q: %v", lines["teacher"], err)
	}
	api := "http://" + teacher.Host + "/api/tests"
	if code := get(api, nil); code != 401 {
		t.Errorf("GET teacher /api/tests without the token = %d, want 401", code)
	}
	if code := get(api, http.Header{"Authorization": {"Bearer " + teacher.Query().Get("t")}}); code != 200 {
		t.Errorf("GET teacher /api/tests with the printed token = %d, want 200", code)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("run = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run did not return within 5 s of cancel")
	}
}

func TestDailySnapshot(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "klats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	snaps := func() []string {
		files, _ := filepath.Glob(filepath.Join(dir, "snapshots", "klats-*.db"))
		return files
	}

	snapshotDaily(st, dir)
	snapshotDaily(st, dir)
	if got := snaps(); len(got) != 1 {
		t.Fatalf("snapshots after two starts today = %v, want one", got)
	}
	yesterday := time.Now().AddDate(0, 0, -1)
	if err := os.Chtimes(snaps()[0], yesterday, yesterday); err != nil {
		t.Fatal(err)
	}
	snapshotDaily(st, dir)
	if got := snaps(); len(got) != 2 {
		t.Errorf("snapshots after the first start of a new day = %v, want two", got)
	}
}

func TestOpenLogRotates(t *testing.T) {
	dir := t.TempDir()
	logs := filepath.Join(dir, "logs")
	if err := os.MkdirAll(logs, 0o700); err != nil {
		t.Fatal(err)
	}
	old := bytes.Repeat([]byte("x"), maxLogBytes+1)
	if err := os.WriteFile(filepath.Join(logs, "klats.log.1"), []byte("older"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(logs, "klats.log"), old, 0o600); err != nil {
		t.Fatal(err)
	}

	f, err := openLog(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("new\n"); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	if got, _ := os.ReadFile(filepath.Join(logs, "klats.log.1")); !bytes.Equal(got, old) {
		t.Errorf("klats.log.1 holds %d bytes, want the old %d-byte log", len(got), len(old))
	}
	if got, _ := os.ReadFile(filepath.Join(logs, "klats.log")); string(got) != "new\n" {
		t.Errorf("klats.log = %q, want a fresh log", got)
	}

	// Under the limit the log is appended to.
	f, err = openLog(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.WriteString("more\n")
	_ = f.Close()
	if got, _ := os.ReadFile(filepath.Join(logs, "klats.log")); string(got) != "new\nmore\n" {
		t.Errorf("klats.log = %q, want both lines", got)
	}
}
