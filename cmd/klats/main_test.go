package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/andriykohut/klats/internal/config"
	"github.com/andriykohut/klats/internal/lan"
	"github.com/andriykohut/klats/internal/store"
	"github.com/andriykohut/klats/internal/teacherapi"
	"github.com/andriykohut/klats/internal/testfmt"
	"github.com/andriykohut/klats/internal/wire"
)

// stubs swaps the program's seams for the test's duration: the student app is
// a stand-in, the tick is fast, keep-awake touches nothing and the first-run
// student listener takes the saved port or any free one instead of 8080.
func stubs(t *testing.T) {
	t.Helper()
	ui, shell, inh, listen, every := studentUI, openShell, inhibit, listenLAN, tickEvery
	t.Cleanup(func() { studentUI, openShell, inhibit, listenLAN, tickEvery = ui, shell, inh, listen, every })
	studentUI = fstest.MapFS{"index.html": {Data: []byte("<html>student</html>")}}
	tickEvery = 10 * time.Millisecond
	inhibit = func(string) (func(), error) { return func() {}, nil }
	listenLAN = func(s *config.Settings) (net.Listener, error) {
		l, err := net.Listen("tcp", ":"+strconv.Itoa(s.Port))
		if err == nil {
			s.Port = l.Addr().(*net.TCPAddr).Port
		}
		return l, err
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	return l.Addr().(*net.TCPAddr).Port
}

func wantRefused(t *testing.T, name, addr string) {
	t.Helper()
	if c, err := net.DialTimeout("tcp", addr, time.Second); err == nil {
		_ = c.Close()
		t.Errorf("the %s server still accepts connections at %s", name, addr)
	}
}

// wantCheckpointed fails unless the database's write-ahead log is gone or
// empty, which only a closed store leaves behind.
func wantCheckpointed(t *testing.T, dataDir string) {
	t.Helper()
	if info, err := os.Stat(filepath.Join(dataDir, "klats.db-wal")); err == nil && info.Size() > 0 {
		t.Errorf("klats.db-wal holds %d bytes: the store was not closed", info.Size())
	}
}

// api calls the teacher API at launchURL, a printed teacher line with the
// token, and returns the status and body.
func api(t *testing.T, launchURL, method, path string, body any) (int, []byte) {
	t.Helper()
	u, err := url.Parse(launchURL)
	if err != nil {
		t.Fatal(err)
	}
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, "http://"+u.Host+path, rd)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+u.Query().Get("t"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

// startSitting creates a one-question test and starts a sitting on it.
func startSitting(t *testing.T, launchURL string) {
	t.Helper()
	text := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"так"}]}]}`)
	doc := testfmt.Test{Version: 1, Title: "Дроби", Palette: "teal", Questions: []testfmt.Question{{
		ID: "q1", Type: "single", Text: text, Points: 1,
		Options: []testfmt.Option{{ID: "o0", Content: text, Correct: true}, {ID: "o1", Content: text}},
	}}}
	code, b := api(t, launchURL, "POST", "/api/tests", map[string]string{"title": doc.Title})
	var created wire.TestDoc
	if code != 201 || json.Unmarshal(b, &created) != nil {
		t.Fatalf("create test = %d %s", code, b)
	}
	doc.ID = created.ID
	if code, b := api(t, launchURL, "PUT", "/api/tests/"+doc.ID, doc); code != 200 {
		t.Fatalf("save test = %d %s", code, b)
	}
	if code, b := api(t, launchURL, "POST", "/api/sittings", wire.StartRequest{TestID: doc.ID}); code != 201 {
		t.Fatalf("start sitting = %d %s", code, b)
	}
}

// devRun is a run with -dev in the background.
type devRun struct {
	lines  map[string]string // the printed student, lan and teacher lines
	logs   *bytes.Buffer
	cancel context.CancelFunc
	done   chan error
}

func startDev(t *testing.T, dataDir string, args ...string) *devRun {
	t.Helper()
	d := &devRun{lines: map[string]string{}, logs: &bytes.Buffer{}, done: make(chan error, 1)}
	t.Cleanup(func() {
		if t.Failed() {
			t.Log(d.logs.String())
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	d.cancel = cancel
	t.Cleanup(cancel)
	out, stdout := io.Pipe()
	go func() {
		d.done <- run(ctx, append([]string{"-dev", "-data", dataDir}, args...), stdout, d.logs)
		_ = stdout.Close()
	}()
	var keys []string
	sc := bufio.NewScanner(out)
	for len(keys) < 3 && sc.Scan() {
		k, v, _ := strings.Cut(sc.Text(), " ")
		keys, d.lines[k] = append(keys, k), v
	}
	if strings.Join(keys, ",") != "student,lan,teacher" {
		t.Fatalf("printed %q, want student, lan and teacher lines (run: %v)", d.lines, <-d.done)
	}
	go func() { _, _ = io.Copy(io.Discard, out) }()
	return d
}

// stop ends the run as a signal would and waits for it to return.
func (d *devRun) stop(t *testing.T) {
	t.Helper()
	d.cancel()
	select {
	case err := <-d.done:
		if err != nil {
			t.Errorf("run = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run did not return within 5 s of cancel")
	}
}

func TestDevModeServes(t *testing.T) {
	stubs(t)
	dataDir := t.TempDir()
	port := freePort(t)
	d := startDev(t, dataDir, "-port", strconv.Itoa(port))

	// -port is used as given and not saved.
	if want := "http://127.0.0.1:" + strconv.Itoa(port); d.lines["student"] != want {
		t.Errorf("student line = %q, want %q", d.lines["student"], want)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "settings.json")); err == nil {
		t.Error("-port was saved to settings.json")
	}
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
	if code := get(d.lines["student"]+"/", nil); code != 200 {
		t.Errorf("GET student / = %d, want 200", code)
	}
	teacher, err := url.Parse(d.lines["teacher"])
	if err != nil || teacher.Hostname() != "127.0.0.1" {
		t.Fatalf("teacher URL %q: %v", d.lines["teacher"], err)
	}
	apiURL := "http://" + teacher.Host + "/api/tests"
	if code := get(apiURL, nil); code != 401 {
		t.Errorf("GET teacher /api/tests without the token = %d, want 401", code)
	}
	if code := get(apiURL, http.Header{"Authorization": {"Bearer " + teacher.Query().Get("t")}}); code != 200 {
		t.Errorf("GET teacher /api/tests with the printed token = %d, want 200", code)
	}

	d.stop(t)
	wantRefused(t, "student", "127.0.0.1:"+strconv.Itoa(port))
	wantRefused(t, "teacher", teacher.Host)
	wantCheckpointed(t, dataDir)
	logFile, err := os.ReadFile(filepath.Join(dataDir, "logs", "klats.log"))
	if err != nil {
		t.Fatal(err)
	}
	for name, l := range map[string]string{"stderr": d.logs.String(), "klats.log": string(logFile)} {
		if strings.Contains(l, teacher.Query().Get("t")) {
			t.Errorf("the launch token is in %s", name)
		}
	}
}

// -demo needs -dev. It runs a sitting of the sample class in a temporary data
// folder that is gone after the run, and the student line carries its code.
// With -data, a second run reuses the sitting the first left running.
func TestDemo(t *testing.T) {
	stubs(t)
	var stderr bytes.Buffer
	if err := run(context.Background(), []string{"-demo"}, io.Discard, &stderr); !errors.Is(err, errUsage) || !strings.Contains(stderr.String(), "-demo needs -dev") {
		t.Errorf("-demo without -dev = %v, printed %q", err, stderr.String())
	}

	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)
	d := startDev(t, "", "-demo", "-port", "0")
	_, code, ok := strings.Cut(d.lines["student"], "/?code=")
	status, b := api(t, d.lines["teacher"], "GET", "/api/sittings/current", nil)
	var live wire.LiveSnapshot
	if !ok || status != 200 || json.Unmarshal(b, &live) != nil || live.Sitting.Code != code || live.Sitting.ClassName != "7-Б" {
		t.Errorf("student line %q, live sitting %d %s", d.lines["student"], status, b)
	}
	d.stop(t)
	if entries, _ := os.ReadDir(tmp); len(entries) > 0 {
		t.Errorf("the run left %v in the temporary folder", entries)
	}

	// With -data, a second run prints the sitting the first one left running.
	dataDir := t.TempDir()
	first := startDev(t, dataDir, "-demo", "-port", "0")
	first.stop(t)
	again := startDev(t, dataDir, "-demo", "-port", "0")
	again.stop(t)
	_, code1, _ := strings.Cut(first.lines["student"], "/?code=")
	_, code2, _ := strings.Cut(again.lines["student"], "/?code=")
	if code1 == "" || code2 != code1 {
		t.Errorf("join codes %q then %q, want the first sitting's on both runs", code1, code2)
	}
}

// What a crashed run left in tmp/, such as a half-written restore, is gone
// once the next run is up.
func TestStartEmptiesTheTempFolder(t *testing.T) {
	stubs(t)
	dataDir := t.TempDir()
	left := filepath.Join(dataDir, "tmp", "restore-1", "klats.db")
	if err := os.MkdirAll(filepath.Dir(left), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(left, []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	d := startDev(t, dataDir, "-port", "0")
	defer d.stop(t)
	if entries, err := os.ReadDir(filepath.Join(dataDir, "tmp")); err != nil || len(entries) != 0 {
		t.Errorf("tmp holds %v, %v; want it empty", entries, err)
	}
}

func TestFirstRunSavesTheChosenPort(t *testing.T) {
	stubs(t)
	dataDir := t.TempDir()
	d := startDev(t, dataDir)
	d.stop(t)

	saved, err := config.Load(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if want := "http://127.0.0.1:" + strconv.Itoa(saved.Port); saved.Port == 0 || d.lines["student"] != want {
		t.Errorf("settings.json port = %d, student line %q: want the port the server took", saved.Port, d.lines["student"])
	}
}

func TestDamagedSettingsStartWithTheDefaults(t *testing.T) {
	stubs(t)
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "settings.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	d := startDev(t, dataDir)
	d.stop(t)
	if !strings.Contains(d.logs.String(), "starting with the defaults") {
		t.Errorf("the damaged settings were not logged:\n%s", d.logs)
	}
	// As on a first run, the chosen port is saved, which repairs the file.
	if saved, err := config.Load(dataDir); err != nil || saved.Port == 0 {
		t.Errorf("settings.json after the run = %+v, %v; want the chosen port", saved, err)
	}
}

func TestBusySavedPortKeepsTheTeacherAppUp(t *testing.T) {
	stubs(t)
	listenLAN = func(s *config.Settings) (net.Listener, error) { return lan.Listen(s, runtime.GOOS) }
	taken, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = taken.Close() })
	busy := taken.Addr().(*net.TCPAddr).Port
	dataDir := t.TempDir()
	if err := config.Save(dataDir, config.Settings{Port: busy, Language: "uk"}); err != nil {
		t.Fatal(err)
	}

	d := startDev(t, dataDir)
	if d.lines["student"] != "none" || d.lines["lan"] != "none" {
		t.Errorf("student %q, lan %q, want none for both while the port is busy", d.lines["student"], d.lines["lan"])
	}
	code, b := api(t, d.lines["teacher"], "GET", "/api/network", nil)
	var n wire.NetworkInfo
	if code != 200 || json.Unmarshal(b, &n) != nil || n.Error != "port_busy" || n.Port != busy {
		t.Errorf("GET /api/network = %d %s, want port_busy on port %d", code, b, busy)
	}
	d.stop(t)
	if saved, _ := config.Load(dataDir); saved.Port != busy {
		t.Errorf("the saved port changed to %d", saved.Port)
	}
}

// fakeShell stands in for the desktop window: Run calls fn.
type fakeShell struct{ fn func(teacherURL string) error }

func (f fakeShell) Run(_ context.Context, teacherURL string) error { return f.fn(teacherURL) }
func (fakeShell) Dialogs() teacherapi.Dialogs                      { return nil }
func (fakeShell) Browser() teacherapi.Browser                      { return nil }

// TestShellQuitStopsEverything checks what is left when the shell reports its
// shutdown: on macOS the process exits right after, so nothing may wait for
// run to return.
func TestShellQuitStopsEverything(t *testing.T) {
	stubs(t)
	var held, released atomic.Int32
	inhibit = func(string) (func(), error) {
		held.Add(1)
		return func() {
			time.Sleep(50 * time.Millisecond) // killing a helper process takes a moment
			released.Add(1)
		}, nil
	}
	dataDir := t.TempDir()
	port := freePort(t)
	if err := config.Save(dataDir, config.Settings{Port: port, Language: "uk"}); err != nil {
		t.Fatal(err)
	}
	var ran bool
	openShell = func(_ func() string, _ func() bool, onShutdown func()) (shell, error) {
		return fakeShell{func(launchURL string) error {
			ran = true
			startSitting(t, launchURL)
			for deadline := time.Now().Add(5 * time.Second); held.Load() == 0; time.Sleep(5 * time.Millisecond) {
				if time.Now().After(deadline) {
					t.Fatal("keep-awake did not start with the sitting")
				}
			}

			onShutdown()
			if got := released.Load(); got != 1 {
				t.Errorf("keep-awake released %d times when the shell shut down, want 1", got)
			}
			u, _ := url.Parse(launchURL)
			wantRefused(t, "student", "127.0.0.1:"+strconv.Itoa(port))
			wantRefused(t, "teacher", u.Host)
			wantCheckpointed(t, dataDir)
			return nil
		}}, nil
	}
	if err := run(context.Background(), []string{"-data", dataDir}, io.Discard, io.Discard); err != nil {
		t.Errorf("run = %v", err)
	}
	if !ran {
		t.Fatal("the shell did not run")
	}
}

func TestSavedLanguageSurvivesAnUnreadableFile(t *testing.T) {
	stubs(t)
	dataDir := t.TempDir()
	if err := config.Save(dataDir, config.Settings{Port: freePort(t), Language: "en"}); err != nil {
		t.Fatal(err)
	}
	var got []string
	openShell = func(language func() string, _ func() bool, _ func()) (shell, error) {
		got = append(got, language())
		return fakeShell{func(string) error {
			if err := os.WriteFile(filepath.Join(dataDir, "settings.json"), []byte("{"), 0o600); err != nil {
				t.Error(err)
			}
			got = append(got, language(), language())
			return nil
		}}, nil
	}
	var logs bytes.Buffer
	if err := run(context.Background(), []string{"-dev=false", "-data", dataDir}, io.Discard, &logs); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ",") != "en,en,en" {
		t.Errorf("languages = %v, want en throughout", got)
	}
	if n := strings.Count(logs.String(), "settings unreadable"); n != 1 {
		t.Errorf("the unreadable settings were logged %d times, want 1", n)
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
