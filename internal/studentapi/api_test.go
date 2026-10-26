package studentapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"klats/internal/events"
	"klats/internal/media"
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
	".keep":           {Data: []byte("secret")},
	"assets/.hidden":  {Data: []byte("secret")},
}

type env struct {
	st   *store.Store
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
	return setupWith(t, nil)
}

// setupWith is setup with tweak applied to the test before the sitting starts.
func setupWith(t *testing.T, tweak func(*testfmt.Test, *media.Store)) *env {
	t.Helper()
	ms, err := media.Open(filepath.Join(t.TempDir(), "media"))
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(t.TempDir(), "klats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	opts := []testfmt.Option{{ID: "o0", Content: rich("так"), Correct: true}, {ID: "o1", Content: rich("ні")}}
	tst := testfmt.Test{ID: "t1", Version: 1, Title: "Дроби", Palette: "teal", Questions: []testfmt.Question{
		{ID: "q1", Type: "single", Text: rich("Скільки?"), Points: 2, Options: opts},
		{ID: "q2", Type: "multi", Text: rich("Оберіть"), Points: 3, Options: opts},
	}}
	if tweak != nil {
		tweak(&tst, ms)
	}
	doc, err := json.Marshal(tst)
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
	info, err := e.Start("t1", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	return &env{st: st, e: e, hub: hub, h: newHandler(e, hub, assets, ms, now.Now), code: info.Code, now: now}
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

// wantError checks the status and the error code of a JSON error reply.
func wantError(t *testing.T, w *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	wantStatus(t, w, status)
	if got := decodeBody[map[string]string](t, w)["error"]; got != code {
		t.Fatalf("error = %q, want %q; body %s", got, code, w.Body)
	}
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
	wantError(t, v.do("POST", "/api/join", devA, map[string]string{"code": "0000x"}), 404, "bad_code")

	w = v.do("POST", "/api/pick", devA, map[string]string{"code": v.code, "surname": "Шевченко", "firstName": "Тарас"})
	wantStatus(t, w, 200)
	p := decodeBody[wire.Participant](t, w)

	wantError(t, v.do("GET", "/api/test", devB, nil), 404, "not_joined")
	w = v.do("GET", "/api/test", devA, nil)
	wantStatus(t, w, 200)
	res := decodeBody[wire.TestResponse](t, w)
	if res.ParticipantID != p.ID || len(res.Test.Questions) != 2 || res.Answers == nil || len(res.Answers) != 0 || res.Status.State != "writing" {
		t.Errorf("test = %+v", res)
	}

	ch := wire.AnswerChange{ChangeID: "c1", ParticipantID: p.ID, QuestionID: "q1", Answer: testfmt.Answer{Items: []string{"o0"}}, Seq: 1}
	w = v.do("POST", "/api/answers", devA, wire.SubmitRequest{Changes: []wire.AnswerChange{ch}})
	wantStatus(t, w, 200)
	if sr := decodeBody[wire.SubmitResult](t, w); len(sr.Acks) != 1 || sr.Acks[0] != "c1" || sr.Rejected != 0 {
		t.Errorf("submit = %+v", sr)
	}

	res = decodeBody[wire.TestResponse](t, v.do("GET", "/api/test", devA, nil))
	if len(res.Answers) != 1 || res.Answers[0].QuestionID != "q1" || res.Answers[0].Seq != 1 || res.Answers[0].Answer.Items[0] != "o0" {
		t.Errorf("stored answers = %+v", res.Answers)
	}

	w = v.do("POST", "/api/heartbeat", devA, wire.HeartbeatRequest{})
	wantStatus(t, w, 200)
	if st := decodeBody[wire.Status](t, w); st.State != "writing" {
		t.Errorf("heartbeat = %+v", st)
	}
	wantStatus(t, v.do("POST", "/api/focus", devA, wire.FocusRequest{Left: true}), 204)
	live, err := v.e.Live()
	if err != nil {
		t.Fatal(err)
	}
	if len(live.Rows) != 1 || live.Rows[0].WindowSwitches != 1 {
		t.Errorf("window switches after focus = %+v", live.Rows)
	}

	w = v.do("POST", "/api/finish", devA, nil)
	wantStatus(t, w, 200)
	if fr := decodeBody[wire.FinishResult](t, w); fr.Total != 2 || fr.Correct != 1 {
		t.Errorf("finish = %+v", fr)
	}
}

func TestTestResponseNeverHasCorrect(t *testing.T) {
	v := setup(t)
	v.enter(t, devA, "Шевченко")
	w := v.do("GET", "/api/test", devA, nil)
	wantStatus(t, w, 200)
	body := w.Body.String()
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
	wantError(t, w, 409, "name_taken")
	if got := decodeBody[map[string]string](t, w); got["label"] == "" {
		t.Errorf("body = %v, want the holder's label", got)
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
	wantError(t, v.do("POST", "/api/join", devA, map[string]string{"code": v.code}), 429, "rate_limited")
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
	wantError(t, v.doFrom("10.0.0.9:6000", "POST", "/api/join", devA, map[string]string{"code": v.code}), 429, "rate_limited")
	if c := v.doFrom("10.0.0.10:6000", "POST", "/api/join", devA, map[string]string{"code": v.code}).Code; c != 200 {
		t.Errorf("join from another IP = %d, want 200", c)
	}
}

func TestBadDeviceToken(t *testing.T) {
	v := setup(t)
	for _, bad := range []string{"", "short", strings.Repeat("a", 21), strings.Repeat("A", 26), strings.Repeat("1", 26), strings.Repeat("a", 65)} {
		wantError(t, v.do("GET", "/api/test", bad, nil), 400, "invalid_device")
	}
	// A well-formed token passes validation and reaches the engine.
	for _, ok := range []string{strings.Repeat("a", 22), strings.Repeat("z7", 32)} {
		wantError(t, v.do("GET", "/api/test", ok, nil), 404, "not_joined")
	}
	wantError(t, v.do("GET", "/api/events?device=bad", "", nil), 400, "invalid_device")
}

func TestOversizeBodyIs413(t *testing.T) {
	v := setup(t)
	big := []byte(`{"code":"` + strings.Repeat("1", maxBodyBytes) + `"}`)
	wantError(t, v.do("POST", "/api/join", devA, big), 413, "too_large")

	// A body that omits Content-Length is caught while reading.
	r := httptest.NewRequest("POST", "/api/join", io.MultiReader(bytes.NewReader(big)))
	r.Header.Set(deviceHeader, devA)
	w := httptest.NewRecorder()
	v.h.ServeHTTP(w, r)
	wantError(t, w, 413, "too_large")

	wantError(t, v.do("POST", "/api/join", devA, []byte(`{not json`)), 400, "invalid")
}

// TestLargeWrittenAnswerAccepted sends what a device that went offline during
// a test of 30 written questions holds: one 5,000-character answer to each,
// about 300 KB.
func TestLargeWrittenAnswerAccepted(t *testing.T) {
	v := setupWith(t, func(tst *testfmt.Test, _ *media.Store) {
		for i := range 30 {
			tst.Questions = append(tst.Questions, testfmt.Question{ID: fmt.Sprintf("w%d", i), Type: "open", Text: rich("Поясніть"), Points: 4})
		}
	})
	p := v.enter(t, devA, "Шевченко")
	text := strings.Repeat("ї", 5000)
	var req wire.SubmitRequest
	for i := range 30 {
		req.Changes = append(req.Changes, wire.AnswerChange{ChangeID: fmt.Sprintf("c%d", i), ParticipantID: p.ID, QuestionID: fmt.Sprintf("w%d", i), Answer: testfmt.Answer{Text: text}, Seq: 1})
	}
	w := v.do("POST", "/api/answers", devA, req)
	wantStatus(t, w, 200)
	if sr := decodeBody[wire.SubmitResult](t, w); len(sr.Acks) != 30 || sr.Rejected != 0 {
		t.Errorf("submit = %+v", sr)
	}
	res := decodeBody[wire.TestResponse](t, v.do("GET", "/api/test", devA, nil))
	if len(res.Answers) != 30 || res.Answers[0].Answer.Text != text {
		t.Errorf("stored %d answers", len(res.Answers))
	}
}

func TestTrailingBytesRejected(t *testing.T) {
	v := setup(t)
	good := `{"code":"` + v.code + `"}`
	wantStatus(t, v.do("POST", "/api/join", devA, []byte(good+" \n")), 200)
	for _, tail := range []string{" x", "{}", "}", " 1"} {
		wantError(t, v.do("POST", "/api/join", devA, []byte(good+tail)), 400, "invalid")
	}
}

func TestErrorMapping(t *testing.T) {
	v := setup(t)
	p := v.enter(t, devA, "Шевченко")
	// Not joined: no participant on this device.
	wantError(t, v.do("POST", "/api/finish", devB, nil), 404, "not_joined")
	// Too many changes is invalid.
	changes := make([]wire.AnswerChange, 201)
	for i := range changes {
		changes[i] = wire.AnswerChange{ChangeID: fmt.Sprint(i), ParticipantID: p.ID, QuestionID: "q1", Seq: 1}
	}
	wantError(t, v.do("POST", "/api/answers", devA, wire.SubmitRequest{Changes: changes}), 400, "invalid")
	// A pick the engine refuses.
	wantError(t, v.do("POST", "/api/pick", devB, map[string]string{"code": v.code, "surname": "", "firstName": "Х"}), 404, "not_joined")
	wantStatus(t, v.do("POST", "/api/join", devB, map[string]string{"code": v.code}), 200)
	wantError(t, v.do("POST", "/api/pick", devB, map[string]string{"code": v.code, "surname": "", "firstName": "Х"}), 400, "invalid")
	wantError(t, v.do("POST", "/api/pick", devB, map[string]string{"code": "nope", "surname": "А", "firstName": "Б"}), 404, "bad_code")
	// Kicked.
	if err := v.e.Kick(p.ID); err != nil {
		t.Fatal(err)
	}
	wantError(t, v.do("POST", "/api/answers", devA, wire.SubmitRequest{}), 403, "kicked")
	wantError(t, v.do("GET", "/api/test", devA, nil), 403, "kicked")
}

func TestInternalErrorLeaksNothing(t *testing.T) {
	v := setup(t)
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(func() { slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil))) })
	if err := v.st.Close(); err != nil {
		t.Fatal(err)
	}
	w := v.do("POST", "/api/join", devA, map[string]string{"code": v.code})
	wantStatus(t, w, 500)
	if got := strings.TrimSpace(w.Body.String()); got != `{"error":"internal"}` {
		t.Errorf("body = %s", got)
	}
}

func TestPickRateLimit(t *testing.T) {
	v := setup(t)
	pick := func() *httptest.ResponseRecorder {
		return v.do("POST", "/api/pick", devA, map[string]string{"code": v.code, "surname": "Шевченко", "firstName": "Тарас"})
	}
	wantStatus(t, v.do("POST", "/api/join", devA, map[string]string{"code": v.code}), 200)
	for i := 2; i <= 10; i++ {
		wantStatus(t, pick(), 200)
	}
	wantError(t, pick(), 429, "rate_limited")
}

func TestTestResponseIsOwnAnswersOnly(t *testing.T) {
	v := setup(t)
	a := v.enter(t, devA, "Шевченко")
	b := v.enter(t, devB, "Франко")
	submit := func(device string, c wire.AnswerChange) {
		wantStatus(t, v.do("POST", "/api/answers", device, wire.SubmitRequest{Changes: []wire.AnswerChange{c}}), 200)
	}
	submit(devA, wire.AnswerChange{ChangeID: "a1", ParticipantID: a.ID, QuestionID: "q1", Answer: testfmt.Answer{Items: []string{"o0"}}, Seq: 1})
	submit(devB, wire.AnswerChange{ChangeID: "b1", ParticipantID: b.ID, QuestionID: "q1", Answer: testfmt.Answer{Items: []string{"o1"}}, Seq: 1})
	submit(devB, wire.AnswerChange{ChangeID: "b2", ParticipantID: b.ID, QuestionID: "q2", Answer: testfmt.Answer{Items: []string{"o0", "o1"}}, Seq: 1})

	res := decodeBody[wire.TestResponse](t, v.do("GET", "/api/test", devA, nil))
	want := []wire.StoredAnswer{{QuestionID: "q1", Answer: testfmt.Answer{Items: []string{"o0"}}, Seq: 1}}
	if !reflect.DeepEqual(res.Answers, want) {
		t.Errorf("A's answers = %+v, want %+v", res.Answers, want)
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
	for _, hidden := range []string{"/.keep", "/assets/.hidden"} {
		if w = v.do("GET", hidden, "", nil); w.Code != 404 || strings.Contains(w.Body.String(), "secret") {
			t.Errorf("%s = %d %q, want a plain 404", hidden, w.Code, w.Body)
		}
	}
	for _, unknown := range []string{"/api", "/api/", "/api/nope"} {
		wantError(t, v.do("GET", unknown, "", nil), 404, "not_found")
	}
}

// openStream opens an event stream for the device and returns once the
// response headers are in. The caller closes the response body.
func openStream(t *testing.T, srv *httptest.Server, device string) (*http.Response, context.CancelFunc) {
	t.Helper()
	return openEvents(t, srv, "device="+device)
}

// openEvents is openStream with the query string given whole.
func openEvents(t *testing.T, srv *httptest.Server, query string) (*http.Response, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/events?"+query, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	return resp, cancel
}

func TestEventsStream(t *testing.T) {
	v := setup(t)
	srv := httptest.NewServer(v.h)
	defer srv.Close()
	resp, cancel := openStream(t, srv, devA)
	defer cancel()
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

func TestEventsStreamCarriesTheRunningSittingsTakenNames(t *testing.T) {
	v := setup(t)
	srv := httptest.NewServer(v.h)
	defer srv.Close()
	id := v.e.SittingID()
	resp, cancel := openEvents(t, srv, "device="+devA+"&sitting="+id)
	defer cancel()
	defer func() { _ = resp.Body.Close() }()
	other, cancelOther := openEvents(t, srv, "device="+devB+"&sitting=other")
	defer cancelOther()
	defer func() { _ = other.Body.Close() }()
	if n := v.hub.Subscribers("names:other"); n != 0 {
		t.Errorf("a sitting that does not run has %d subscribers", n)
	}

	v.hub.Publish(events.Event{Topic: "names:" + id, Name: "taken", Data: wire.NamesTaken{Taken: []string{"s1"}}})
	buf := make([]byte, 128)
	n, err := resp.Body.Read(buf)
	if want := "event: taken\ndata: {\"taken\":[\"s1\"]}\n\n"; err != nil || string(buf[:n]) != want {
		t.Errorf("frame = %q, %v; want %q", buf[:n], err, want)
	}
	v.hub.Publish(events.Event{Topic: "device:" + devA, Name: "status"})
	if n, err := resp.Body.Read(buf); err != nil || !strings.HasPrefix(string(buf[:n]), "event: status") {
		t.Errorf("device frame = %q, %v", buf[:n], err)
	}
}

// eventually polls cond for up to 3 s: the server notices a disconnect
// asynchronously.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(3 * time.Second); !cond(); time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
	}
}

func TestEventStreamUnsubscribesOnDisconnect(t *testing.T) {
	v := setup(t)
	srv := httptest.NewServer(v.h)
	defer srv.Close()
	topic := "device:" + devA
	resp, cancel := openStream(t, srv, devA)
	defer func() { _ = resp.Body.Close() }()
	if n := v.hub.Subscribers(topic); n != 1 {
		t.Fatalf("subscribers while streaming = %d, want 1", n)
	}
	cancel()
	eventually(t, "the subscription to end", func() bool { return v.hub.Subscribers(topic) == 0 })
}

func TestEventStreamsCappedPerIP(t *testing.T) {
	v := setup(t)
	srv := httptest.NewServer(v.h)
	defer srv.Close()
	var cancels []context.CancelFunc
	for i := range maxStreamsPerIP {
		resp, cancel := openStream(t, srv, token(i))
		defer cancel()
		defer func() { _ = resp.Body.Close() }()
		cancels = append(cancels, cancel)
		if resp.StatusCode != 200 {
			t.Fatalf("stream %d = %d", i+1, resp.StatusCode)
		}
	}
	// A live stream's body never ends: read it only if the reply is the 429.
	resp, cancel := openStream(t, srv, devA)
	defer cancel()
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 429 {
		t.Fatalf("stream %d = %d, want 429", maxStreamsPerIP+1, resp.StatusCode)
	}
	if body, _ := io.ReadAll(resp.Body); strings.TrimSpace(string(body)) != `{"error":"rate_limited"}` {
		t.Errorf("429 body = %s", body)
	}

	cancels[0]()
	eventually(t, "a stream slot to be released", func() bool {
		resp, cancel := openStream(t, srv, devA)
		defer cancel()
		defer func() { _ = resp.Body.Close() }()
		return resp.StatusCode == 200
	})
}

func TestIPv6ClientsCountPerPrefix(t *testing.T) {
	v := setup(t)
	join := func(remote string, i int) int {
		return v.doFrom(remote, "POST", "/api/join", token(i), map[string]string{"code": v.code}).Code
	}
	for i := range 300 {
		if c := join("[2001:db8:0:1::1]:5000", i); c != 200 {
			t.Fatalf("join %d = %d", i, c)
		}
	}
	if c := join("[2001:db8:0:1::ffff]:5000", 300); c != 429 {
		t.Errorf("another address of the same /64 = %d, want 429", c)
	}
	if c := join("[2001:db8:0:2::1]:5000", 301); c != 200 {
		t.Errorf("another /64 = %d, want 200", c)
	}
}

func TestLimitKey(t *testing.T) {
	for remote, want := range map[string]string{
		"10.0.0.9:5000":            "10.0.0.9",
		"10.0.0.10:5000":           "10.0.0.10",
		"[::ffff:10.0.0.9]:5000":   "10.0.0.9",
		"[2001:db8:0:1::1]:5000":   "2001:db8:0:1::/64",
		"[2001:db8:0:1:aaaa::2]:1": "2001:db8:0:1::/64",
		"[fe80::1%eth0]:1":         "fe80::/64",
		"10.0.0.9":                 "10.0.0.9",
		"not an address":           "not an address",
		"[2001:db8:0:2::1]:5000":   "2001:db8:0:2::/64",
	} {
		if got := limitKey(remote); got != want {
			t.Errorf("limitKey(%q) = %q, want %q", remote, got, want)
		}
	}
}

func TestLimiterRefusedAttemptsDoNotCount(t *testing.T) {
	now := &fakeNow{t: time.UnixMilli(1_790_000_000_000)}
	l := newLimiter(now.Now)
	for range deviceLimit {
		if !l.allow("ip", "d") {
			t.Fatal("attempt within the limit refused")
		}
	}
	now.add(30 * time.Second)
	for range 50 {
		if l.allow("ip", "d") {
			t.Fatal("attempt over the limit admitted")
		}
	}
	now.add(31 * time.Second) // the first ten are out of the window; the refused 50 would not be
	if !l.allow("ip", "d") {
		t.Error("refused attempts were counted toward the window")
	}
}

func TestLimiterSweepKeepsLiveKeys(t *testing.T) {
	now := &fakeNow{t: time.UnixMilli(1_790_000_000_000)}
	l := newLimiter(now.Now)
	l.allow("other", "x") // the first call sets the sweep time
	now.add(30 * time.Second)
	for range deviceLimit {
		l.allow("ip", "d")
	}
	now.add(31 * time.Second) // this call sweeps; d's attempts are 31 s old
	if l.allow("ip", "d") {
		t.Error("sweep dropped a key with attempts inside the window")
	}
	if n := len(l.hits); n != 2 {
		t.Errorf("keys after the sweep = %d, want only d and ip", n)
	}
}
