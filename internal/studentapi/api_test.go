package studentapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"klats/internal/events"
	"klats/internal/sitting"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

const (
	devA = "aaaaaaaaaaaaaaaaaaaaaaaaaa"
	devB = "bbbbbbbbbbbbbbbbbbbbbbbbbb"
)

func rich(s string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q}]}]}`, s))
}

var assets = fstest.MapFS{
	"index.html":      {Data: []byte("<html>spa</html>")},
	"assets/app-1.js": {Data: []byte("console.log(1)")},
}

type env struct {
	e    *sitting.Engine
	hub  *events.Hub
	h    http.Handler
	code string
	now  *fakeNow
}

type fakeNow struct {
	mu sync.Mutex
	t  time.Time
}

func (f *fakeNow) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.t
}

func (f *fakeNow) add(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.t = f.t.Add(d)
}

// setup returns a handler over an engine with a typed-name sitting running
// on test "t1" (q1 single choice, q2 multi choice).
func setup(t *testing.T) *env {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "klats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	opts := []testfmt.Option{{ID: "o0", Content: rich("так"), Correct: true}, {ID: "o1", Content: rich("ні")}}
	doc, err := json.Marshal(testfmt.Test{ID: "t1", Version: 1, Title: "Дроби", Palette: "teal", Questions: []testfmt.Question{
		{ID: "q1", Type: "single", Text: rich("Скільки?"), Points: 2, Options: opts},
		{ID: "q2", Type: "multi", Text: rich("Оберіть"), Points: 3, Options: opts},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Q().InsertTest(context.Background(), db.InsertTestParams{ID: "t1", Title: "Дроби", Doc: string(doc)}); err != nil {
		t.Fatal(err)
	}
	now := &fakeNow{t: time.UnixMilli(1_790_000_000_000)}
	hub := events.New()
	e, err := sitting.New(st, hub, now.Now)
	if err != nil {
		t.Fatal(err)
	}
	info, err := e.Start("t1", nil)
	if err != nil {
		t.Fatal(err)
	}
	return &env{e: e, hub: hub, h: newHandler(e, hub, assets, now.Now), code: info.Code, now: now}
}

// do sends the request to the handler from remote address 10.0.0.5:4000.
func (v *env) do(method, path, device string, body any) *httptest.ResponseRecorder {
	return v.doFrom("10.0.0.5:4000", method, path, device, body)
}

func (v *env) doFrom(remote, method, path, device string, body any) *httptest.ResponseRecorder {
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		rd = bytes.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		rd = bytes.NewReader(raw)
	}
	r := httptest.NewRequest(method, path, rd)
	r.RemoteAddr = remote
	if device != "" {
		r.Header.Set(deviceHeader, device)
	}
	w := httptest.NewRecorder()
	v.h.ServeHTTP(w, r)
	return w
}

func decodeBody[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return v
}

func wantStatus(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("status = %d, want %d; body %s", w.Code, want, w.Body)
	}
}

func (v *env) enter(t *testing.T, device, surname string) wire.Participant {
	t.Helper()
	wantStatus(t, v.do("POST", "/api/join", device, map[string]string{"code": v.code}), 200)
	w := v.do("POST", "/api/pick", device, map[string]string{"code": v.code, "surname": surname, "firstName": "Учень"})
	wantStatus(t, w, 200)
	return decodeBody[wire.Participant](t, w)
}

// token returns the i-th distinct valid device token.
func token(i int) string {
	return fmt.Sprintf("%s%c%c", strings.Repeat("a", 24), 'a'+i/26%26, 'a'+i%26)
}

func TestJoinPickTestFlow(t *testing.T) {
	v := setup(t)

	w := v.do("POST", "/api/join", devA, map[string]string{"code": v.code})
	wantStatus(t, w, 200)
	if info := decodeBody[wire.JoinInfo](t, w); info.Mode != "typed" || info.Language != "uk" {
		t.Errorf("join = %+v", info)
	}
	wantStatus(t, v.do("POST", "/api/join", devA, map[string]string{"code": "0000x"}), 404)

	w = v.do("POST", "/api/pick", devA, map[string]string{"code": v.code, "surname": "Шевченко", "firstName": "Тарас"})
	wantStatus(t, w, 200)
	p := decodeBody[wire.Participant](t, w)

	wantStatus(t, v.do("GET", "/api/test", devB, nil), 404)
	w = v.do("GET", "/api/test", devA, nil)
	wantStatus(t, w, 200)
	res := decodeBody[wire.TestResponse](t, w)
	if res.ParticipantID != p.ID || len(res.Test.Questions) != 2 || res.Answers == nil || len(res.Answers) != 0 || res.Status.State != "writing" {
		t.Errorf("test = %+v", res)
	}

	ch := wire.AnswerChange{ChangeID: "c1", ParticipantID: p.ID, QuestionID: "q1", OptionIDs: []string{"o0"}, Seq: 1}
	w = v.do("POST", "/api/answers", devA, wire.SubmitRequest{Changes: []wire.AnswerChange{ch}})
	wantStatus(t, w, 200)
	if sr := decodeBody[wire.SubmitResult](t, w); len(sr.Acks) != 1 || sr.Acks[0] != "c1" || sr.Rejected != 0 {
		t.Errorf("submit = %+v", sr)
	}

	res = decodeBody[wire.TestResponse](t, v.do("GET", "/api/test", devA, nil))
	if len(res.Answers) != 1 || res.Answers[0].QuestionID != "q1" || res.Answers[0].Seq != 1 || res.Answers[0].OptionIDs[0] != "o0" {
		t.Errorf("stored answers = %+v", res.Answers)
	}

	w = v.do("POST", "/api/heartbeat", devA, wire.HeartbeatRequest{})
	wantStatus(t, w, 200)
	if st := decodeBody[wire.Status](t, w); st.State != "writing" {
		t.Errorf("heartbeat = %+v", st)
	}
	wantStatus(t, v.do("POST", "/api/focus", devA, map[string]bool{"left": true}), 204)

	w = v.do("POST", "/api/finish", devA, nil)
	wantStatus(t, w, 200)
	if fr := decodeBody[wire.FinishResult](t, w); fr.Total != 2 || fr.Correct != 1 {
		t.Errorf("finish = %+v", fr)
	}
}

func TestTestResponseNeverHasCorrect(t *testing.T) {
	v := setup(t)
	v.enter(t, devA, "Шевченко")
	body := v.do("GET", "/api/test", devA, nil).Body.String()
	for _, banned := range []string{`"correct"`, `"points"`} {
		if strings.Contains(body, banned) {
			t.Errorf("test response contains %s: %s", banned, body)
		}
	}
}

func TestNameTakenIs409WithLabel(t *testing.T) {
	v := setup(t)
	v.enter(t, devA, "Шевченко")
	wantStatus(t, v.do("POST", "/api/join", devB, map[string]string{"code": v.code}), 200)
	w := v.do("POST", "/api/pick", devB, map[string]string{"code": v.code, "surname": "Шевченко", "firstName": "Учень"})
	wantStatus(t, w, 409)
	got := decodeBody[map[string]string](t, w)
	if got["error"] != "name_taken" || got["label"] == "" {
		t.Errorf("body = %v", got)
	}
}

func TestJoinRateLimitPerDevice(t *testing.T) {
	v := setup(t)
	join := func(device string) int {
		return v.do("POST", "/api/join", device, map[string]string{"code": v.code}).Code
	}
	for i := 1; i <= 10; i++ {
		if c := join(devA); c != 200 {
			t.Fatalf("join %d = %d", i, c)
		}
	}
	if c := join(devA); c != 429 {
		t.Errorf("11th join = %d, want 429", c)
	}
	if c := join(devB); c != 200 {
		t.Errorf("other device = %d, want 200", c)
	}
	v.now.add(time.Minute)
	if c := join(devA); c != 200 {
		t.Errorf("join after the window = %d, want 200", c)
	}
}

func TestManyDevicesOneIP(t *testing.T) {
	v := setup(t)
	for i := range 35 {
		device := token(i)
		for j := range 2 {
			w := v.doFrom("10.0.0.9:5000", "POST", "/api/join", device, map[string]string{"code": v.code})
			if w.Code != 200 {
				t.Fatalf("device %d join %d = %d", i, j, w.Code)
			}
		}
	}
}

func TestIPRateLimit(t *testing.T) {
	v := setup(t)
	for i := range 300 {
		if c := v.doFrom("10.0.0.9:5000", "POST", "/api/join", token(i), map[string]string{"code": v.code}).Code; c != 200 {
			t.Fatalf("join %d = %d", i, c)
		}
	}
	if c := v.doFrom("10.0.0.9:6000", "POST", "/api/join", devA, map[string]string{"code": v.code}).Code; c != 429 {
		t.Errorf("301st join from the IP = %d, want 429", c)
	}
	if c := v.doFrom("10.0.0.10:6000", "POST", "/api/join", devA, map[string]string{"code": v.code}).Code; c != 200 {
		t.Errorf("join from another IP = %d, want 200", c)
	}
}

func TestBadDeviceToken(t *testing.T) {
	v := setup(t)
	for _, bad := range []string{"", "short", strings.Repeat("A", 26), strings.Repeat("1", 26), strings.Repeat("a", 65)} {
		if c := v.do("GET", "/api/test", bad, nil).Code; c != 400 {
			t.Errorf("token %q: status = %d, want 400", bad, c)
		}
	}
	wantStatus(t, v.do("GET", "/api/events?device=bad", "", nil), 400)
}

func TestOversizeBodyIs413(t *testing.T) {
	v := setup(t)
	big := []byte(`{"code":"` + strings.Repeat("1", maxBodyBytes) + `"}`)
	wantStatus(t, v.do("POST", "/api/join", devA, big), 413)

	// A body that omits Content-Length is caught while reading.
	r := httptest.NewRequest("POST", "/api/join", io.MultiReader(bytes.NewReader(big)))
	r.Header.Set(deviceHeader, devA)
	w := httptest.NewRecorder()
	v.h.ServeHTTP(w, r)
	wantStatus(t, w, 413)

	wantStatus(t, v.do("POST", "/api/join", devA, []byte(`{not json`)), 400)
}

func TestErrorMapping(t *testing.T) {
	v := setup(t)
	p := v.enter(t, devA, "Шевченко")
	// Not joined: no participant on this device.
	wantStatus(t, v.do("POST", "/api/finish", devB, nil), 404)
	// Too many changes is invalid.
	changes := make([]wire.AnswerChange, 201)
	for i := range changes {
		changes[i] = wire.AnswerChange{ChangeID: fmt.Sprint(i), ParticipantID: p.ID, QuestionID: "q1", Seq: 1}
	}
	wantStatus(t, v.do("POST", "/api/answers", devA, wire.SubmitRequest{Changes: changes}), 400)
	// Kicked.
	if err := v.e.Kick(p.ID); err != nil {
		t.Fatal(err)
	}
	w := v.do("POST", "/api/answers", devA, wire.SubmitRequest{})
	wantStatus(t, w, 403)
	if got := decodeBody[map[string]string](t, w); got["error"] != "kicked" {
		t.Errorf("body = %v", got)
	}
}

func TestCORSPreflight(t *testing.T) {
	v := setup(t)
	r := httptest.NewRequest("OPTIONS", "/api/answers", nil)
	r.Header.Set("Origin", "http://10.0.0.9")
	r.Header.Set("Access-Control-Request-Method", "POST")
	w := httptest.NewRecorder()
	v.h.ServeHTTP(w, r)
	wantStatus(t, w, 204)
	want := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, X-Klats-Device",
		"Access-Control-Max-Age":       "600",
	}
	for k, val := range want {
		if got := w.Header().Get(k); got != val {
			t.Errorf("%s = %q, want %q", k, got, val)
		}
	}
	if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Errorf("Allow-Credentials = %q, want none", got)
	}
	// Plain responses carry the origin header too.
	if got := v.do("GET", "/api/nope", "", nil).Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Allow-Origin on a 404 = %q", got)
	}
}

func TestSPAFallback(t *testing.T) {
	v := setup(t)
	w := v.do("GET", "/join", "", nil)
	wantStatus(t, w, 200)
	if w.Body.String() != "<html>spa</html>" || w.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("/join = %q, cache %q", w.Body, w.Header().Get("Cache-Control"))
	}
	w = v.do("GET", "/", "", nil)
	if w.Code != 200 || w.Body.String() != "<html>spa</html>" {
		t.Errorf("/ = %d %q", w.Code, w.Body)
	}
	w = v.do("GET", "/assets/app-1.js", "", nil)
	if w.Body.String() != "console.log(1)" || w.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Errorf("asset = %q, cache %q", w.Body, w.Header().Get("Cache-Control"))
	}
	for _, missing := range []string{"/assets/gone.js", "/assets/", "/assets"} {
		w = v.do("GET", missing, "", nil)
		if w.Code != 404 || w.Header().Get("Cache-Control") != "no-store" || strings.Contains(w.Body.String(), "spa") {
			t.Errorf("%s = %d, cache %q, body %q", missing, w.Code, w.Header().Get("Cache-Control"), w.Body)
		}
	}
	w = v.do("GET", "/api/nope", "", nil)
	wantStatus(t, w, 404)
	if got := decodeBody[map[string]string](t, w); got["error"] != "not_found" {
		t.Errorf("unknown api path body = %v", got)
	}
}

func TestEventsStream(t *testing.T) {
	v := setup(t)
	srv := httptest.NewServer(v.h)
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/events?device="+devA, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type = %q", ct)
	}
	v.hub.Publish(events.Event{Topic: "device:" + devA, Name: "status"})
	buf := make([]byte, 64)
	n, err := resp.Body.Read(buf)
	if err != nil || !strings.HasPrefix(string(buf[:n]), "event: status") {
		t.Errorf("frame = %q, %v", buf[:n], err)
	}
}

func TestEventStreamsCappedPerIP(t *testing.T) {
	v := setup(t)
	srv := httptest.NewServer(v.h)
	defer srv.Close()
	open := func() (*http.Response, context.CancelFunc) {
		ctx, cancel := context.WithCancel(context.Background())
		req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/events?device="+devA, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		return resp, cancel
	}
	var cancels []context.CancelFunc
	for i := range maxStreamsPerIP {
		resp, cancel := open()
		defer cancel()
		defer func() { _ = resp.Body.Close() }()
		cancels = append(cancels, cancel)
		if resp.StatusCode != 200 {
			t.Fatalf("stream %d = %d", i+1, resp.StatusCode)
		}
	}
	resp, cancel := open()
	defer cancel()
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 429 || !strings.Contains(string(body), "rate_limited") {
		t.Fatalf("9th stream = %d %s, want 429 rate_limited", resp.StatusCode, body)
	}

	cancels[0]()
	deadline := time.Now().Add(3 * time.Second)
	for {
		resp, cancel := open()
		code := resp.StatusCode
		defer cancel()
		defer func() { _ = resp.Body.Close() }()
		if code == 200 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("slot not released after a stream ended: %d", code)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
