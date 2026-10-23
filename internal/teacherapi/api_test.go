package teacherapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"klats/internal/config"
	"klats/internal/events"
	"klats/internal/lan"
	"klats/internal/sitting"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

const (
	port  = 4321
	token = "test-token"
)

type fakeDialogs struct {
	path string
	err  error
	name string // the default name SaveFile was offered
	// during runs while the dialog is open.
	during func()
}

func (f *fakeDialogs) SaveFile(defaultName string) (string, error) {
	f.name = defaultName
	if f.during != nil {
		f.during()
	}
	return f.path, f.err
}

type env struct {
	st      *store.Store
	e       *sitting.Engine
	hub     *events.Hub
	h       http.Handler
	dir     string
	dialogs *fakeDialogs
}

func rich(s string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q}]}]}`, s))
}

func goodTest(id string) testfmt.Test {
	opts := []testfmt.Option{{ID: "o0", Content: rich("так"), Correct: true}, {ID: "o1", Content: rich("ні")}}
	return testfmt.Test{ID: id, Version: 1, Title: "Дроби", Palette: "teal", Questions: []testfmt.Question{
		{ID: "q1", Type: "single", Text: rich("Скільки?"), Points: 2, Options: opts},
	}}
}

func setup(t *testing.T, withDialogs bool, tweak ...func(*Deps)) *env {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "klats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	hub := events.New()
	e, err := sitting.New(st, hub, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	v := &env{st: st, e: e, hub: hub, dir: dir}
	d := Deps{
		Store: st, Engine: e, Hub: hub, Token: token, Port: port, DataDir: dir,
		Assets:   fstest.MapFS{"index.html": {Data: []byte("<html>teacher</html>")}},
		Settings: &config.Settings{Port: 8080, Language: "uk"}, LANPort: 8080,
		Interfaces: func() []lan.Iface {
			return []lan.Iface{{Name: "eth0", Up: true, Addrs: []netip.Addr{netip.MustParseAddr("192.168.1.20"), netip.MustParseAddr("10.0.0.7")}}}
		},
	}
	if withDialogs {
		v.dialogs = &fakeDialogs{}
		d.Dialogs = v.dialogs
	}
	for _, f := range tweak {
		f(&d)
	}
	v.h = Handler(d)
	return v
}

func (v *env) req(method, path string, body any) *http.Request {
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
	r.Host = fmt.Sprintf("127.0.0.1:%d", port)
	r.Header.Set("Authorization", "Bearer "+token)
	return r
}

func (v *env) do(method, path string, body any) *httptest.ResponseRecorder {
	return v.serve(v.req(method, path, body))
}

func (v *env) serve(r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	v.h.ServeHTTP(w, r)
	return w
}

func wantStatus(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("status = %d, want %d; body %s", w.Code, want, w.Body)
	}
}

func wantError(t *testing.T, w *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	wantStatus(t, w, status)
	if got := decodeBody[map[string]any](t, w)["error"]; got != code {
		t.Fatalf("error = %v, want %q; body %s", got, code, w.Body)
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

// saveTest stores the test through the API and returns its id.
func (v *env) saveTest(t *testing.T, doc testfmt.Test) string {
	t.Helper()
	w := v.do("POST", "/api/tests", map[string]string{"title": doc.Title})
	wantStatus(t, w, 201)
	id := decodeBody[wire.TestDoc](t, w).ID
	doc.ID = id
	wantStatus(t, v.do("PUT", "/api/tests/"+id, doc), 200)
	return id
}

func TestRejectsForeignHost(t *testing.T) {
	v := setup(t, false)
	for _, host := range []string{"evil.example:4321", "127.0.0.1", "127.0.0.1:9999", "localhost", "evil.example"} {
		r := v.req("GET", "/api/tests", nil)
		r.Host = host
		wantError(t, v.serve(r), 403, "forbidden_host")
	}
	r := v.req("GET", "/?t="+token, nil)
	r.Host = "evil.example:4321"
	if w := v.serve(r); w.Code != 403 || w.Header().Get("Set-Cookie") != "" {
		t.Errorf("bootstrap on a foreign host = %d, cookie %q", w.Code, w.Header().Get("Set-Cookie"))
	}
	r = v.req("GET", "/api/tests", nil)
	r.Host = "localhost:4321"
	wantStatus(t, v.serve(r), 200)
}

func TestRejectsForeignOrigin(t *testing.T) {
	v := setup(t, false)
	for _, origin := range []string{"http://evil.example", "http://evil.example:4321", "https://127.0.0.1:4321", "http://127.0.0.1:9999", "null"} {
		r := v.req("POST", "/api/tests", map[string]string{"title": "x"})
		r.Header.Set("Origin", origin)
		wantError(t, v.serve(r), 403, "forbidden_origin")
	}
	for _, origin := range []string{"http://127.0.0.1:4321", "http://localhost:4321"} {
		r := v.req("POST", "/api/tests", map[string]string{"title": "x"})
		r.Header.Set("Origin", origin)
		wantStatus(t, v.serve(r), 201)
	}
}

func TestRejectsMissingToken(t *testing.T) {
	v := setup(t, false)
	for _, auth := range []string{"", "Bearer wrong", "Bearer", token, "Basic " + token} {
		r := v.req("GET", "/api/tests", nil)
		r.Header.Del("Authorization")
		if auth != "" {
			r.Header.Set("Authorization", auth)
		}
		wantError(t, v.serve(r), 401, "unauthorized")
	}
	// Static files are guarded too, with a plain-text body.
	r := v.req("GET", "/", nil)
	r.Header.Del("Authorization")
	w := v.serve(r)
	if w.Code != 401 || w.Body.String() != "Відкрийте Клац із програми." || strings.Contains(w.Body.String(), "teacher") {
		t.Errorf("/ without token = %d %q", w.Code, w.Body)
	}
	// The cookie authenticates too.
	r = v.req("GET", "/api/tests", nil)
	r.Header.Del("Authorization")
	r.AddCookie(&http.Cookie{Name: cookieName, Value: token})
	wantStatus(t, v.serve(r), 200)
	r.Header.Del("Cookie")
	r.AddCookie(&http.Cookie{Name: cookieName, Value: "wrong"})
	wantError(t, v.serve(r), 401, "unauthorized")
}

func TestTokenCookieBootstrap(t *testing.T) {
	v := setup(t, false)
	r := v.req("GET", "/?t="+token, nil)
	r.Header.Del("Authorization")
	w := v.serve(r)
	wantStatus(t, w, 302)
	if w.Header().Get("Location") != "/" {
		t.Errorf("Location = %q", w.Header().Get("Location"))
	}
	cs := w.Result().Cookies()
	if len(cs) != 1 || cs[0].Name != "klats_t" || cs[0].Value != token || !cs[0].HttpOnly || cs[0].SameSite != http.SameSiteStrictMode || cs[0].Path != "/" || cs[0].Secure {
		t.Fatalf("cookies = %+v", cs)
	}

	// With the cookie the app is served.
	r = v.req("GET", "/", nil)
	r.Header.Del("Authorization")
	r.AddCookie(cs[0])
	if w = v.serve(r); w.Code != 200 || !strings.Contains(w.Body.String(), "teacher") {
		t.Errorf("/ with cookie = %d %q", w.Code, w.Body)
	}

	r = v.req("GET", "/?t=wrong", nil)
	r.Header.Del("Authorization")
	if w = v.serve(r); w.Code != 401 || w.Header().Get("Set-Cookie") != "" {
		t.Errorf("wrong token = %d, cookie %q", w.Code, w.Header().Get("Set-Cookie"))
	}
}

func TestTestsCRUD(t *testing.T) {
	v := setup(t, false)
	w := v.do("POST", "/api/tests", nil)
	wantError(t, w, 400, "invalid") // a body is required
	w = v.do("POST", "/api/tests", map[string]string{})
	wantStatus(t, w, 201)
	doc := decodeBody[wire.TestDoc](t, w)
	if doc.Test.Title != "Новий тест" || doc.Test.Questions == nil || len(doc.Test.Questions) != 0 || doc.Problems == nil {
		t.Errorf("new test = %+v", doc)
	}
	id := v.saveTest(t, goodTest(""))

	list := decodeBody[[]wire.TestSummary](t, v.do("GET", "/api/tests", nil))
	if len(list) != 2 {
		t.Fatalf("list = %+v", list)
	}
	for _, s := range list {
		if s.ID == id && (s.Title != "Дроби" || s.QuestionCount != 1 || s.Blocking || s.UpdatedAt == 0) {
			t.Errorf("summary = %+v", s)
		}
	}
	got := decodeBody[wire.TestDoc](t, v.do("GET", "/api/tests/"+id, nil))
	if got.ID != id || got.Test.ID != id || got.Test.Title != "Дроби" || len(got.Test.Questions) != 1 || got.SavedAt == 0 {
		t.Errorf("get = %+v", got)
	}
	wantStatus(t, v.do("DELETE", "/api/tests/"+id, nil), 204)
	wantError(t, v.do("GET", "/api/tests/"+id, nil), 404, "not_found")
	wantError(t, v.do("DELETE", "/api/tests/"+id, nil), 404, "not_found")
	wantError(t, v.do("PUT", "/api/tests/"+id, goodTest(id)), 404, "not_found")
	wantError(t, v.do("GET", "/api/nope", nil), 404, "not_found")
}

func TestPutTestReturnsProblems(t *testing.T) {
	v := setup(t, false)
	id := v.saveTest(t, goodTest(""))
	bad := goodTest(id)
	bad.Title = "Нова назва"
	bad.Questions[0].Options[0].Correct = false
	w := v.do("PUT", "/api/tests/"+id, bad)
	wantStatus(t, w, 200)
	res := decodeBody[wire.SaveResult](t, w)
	if len(res.Problems) != 1 || res.Problems[0].Code != "no_correct" || res.SavedAt == 0 {
		t.Errorf("result = %+v", res)
	}
	// A problematic test is still saved, and the title column follows.
	got := decodeBody[wire.TestDoc](t, v.do("GET", "/api/tests/"+id, nil))
	if got.Test.Title != "Нова назва" || len(got.Problems) != 1 {
		t.Errorf("stored = %+v", got)
	}
	if list := decodeBody[[]wire.TestSummary](t, v.do("GET", "/api/tests", nil)); !list[0].Blocking || list[0].Title != "Нова назва" {
		t.Errorf("list = %+v", list)
	}
	// An undecodable document is refused and leaves the stored one alone.
	bad.Palette = "nope"
	wantError(t, v.do("PUT", "/api/tests/"+id, bad), 400, "invalid")
	wantError(t, v.do("PUT", "/api/tests/"+id, []byte(`{`)), 400, "invalid")
	if got = decodeBody[wire.TestDoc](t, v.do("GET", "/api/tests/"+id, nil)); got.Test.Palette != "teal" {
		t.Errorf("palette = %q", got.Test.Palette)
	}
}

func TestTestOfNewerVersion(t *testing.T) {
	v := setup(t, false)
	id := v.saveTest(t, goodTest(""))
	newer := goodTest(id)
	newer.Version = 2
	wantError(t, v.do("PUT", "/api/tests/"+id, newer), 422, "test_too_new")

	// One stored by a newer program, as an import might bring.
	doc, err := json.Marshal(newer)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.st.Q().UpdateTest(context.Background(), db.UpdateTestParams{ID: id, Title: newer.Title, Doc: string(doc), UpdatedAt: 1}); err != nil {
		t.Fatal(err)
	}
	wantError(t, v.do("GET", "/api/tests/"+id, nil), 422, "test_too_new")
}

func TestStartBlockedByProblems(t *testing.T) {
	v := setup(t, false)
	bad := goodTest("")
	bad.Questions[0].Options[0].Correct = false
	badID := v.saveTest(t, bad)
	w := v.do("POST", "/api/sittings", wire.StartRequest{TestID: badID})
	wantError(t, w, 409, "has_problems")
	probs := decodeBody[wire.ProblemsError](t, w).Problems
	if len(probs) != 1 || probs[0].Code != "no_correct" || probs[0].QuestionID != "q1" {
		t.Errorf("problems = %+v", probs)
	}

	goodID := v.saveTest(t, goodTest(""))
	wantError(t, v.do("POST", "/api/sittings", wire.StartRequest{TestID: "nope"}), 404, "not_found")
	w = v.do("POST", "/api/sittings", wire.StartRequest{TestID: goodID})
	wantStatus(t, w, 201)
	info := decodeBody[wire.SittingInfo](t, w)
	if info.Code == "" || info.TestTitle != "Дроби" {
		t.Errorf("info = %+v", info)
	}
	wantError(t, v.do("POST", "/api/sittings", wire.StartRequest{TestID: goodID}), 409, "sitting_active")

	live := decodeBody[wire.LiveSnapshot](t, v.do("GET", "/api/sittings/current", nil))
	if live.Sitting.SittingID != info.SittingID {
		t.Errorf("live sitting = %+v", live.Sitting)
	}
	wantStatus(t, v.do("POST", "/api/sittings/current/end", nil), 204)
	wantError(t, v.do("POST", "/api/sittings/current/end", nil), 404, "not_found")
}

func TestLiveWithoutSitting(t *testing.T) {
	v := setup(t, false)
	w := v.do("GET", "/api/sittings/current", nil)
	wantStatus(t, w, 200)
	if live := decodeBody[wire.LiveSnapshot](t, w); live.Sitting.SittingID != "" {
		t.Errorf("live = %+v", live)
	}
}

func TestParticipantAndDeviceRoutes(t *testing.T) {
	v := setup(t, false)
	wantError(t, v.do("POST", "/api/participants/nope/kick", nil), 404, "not_found")
	wantError(t, v.do("POST", "/api/participants/nope/move", wire.MoveRequest{Device: "d"}), 404, "not_found")
	wantError(t, v.do("POST", "/api/events/nope/resolve", wire.ResolveRequest{Action: "move"}), 404, "not_found")
	wantError(t, v.do("PUT", "/api/devices/nope", wire.LabelRequest{Label: "Стіл 1"}), 404, "not_found")
	for _, label := range []string{"", "   ", strings.Repeat("я", 21)} {
		wantError(t, v.do("PUT", "/api/devices/nope", wire.LabelRequest{Label: label}), 400, "invalid")
	}
	wantError(t, v.do("PUT", "/api/devices/nope", wire.LabelRequest{Label: strings.Repeat("я", 20)}), 404, "not_found")

	if err := v.st.Q().UpsertDevice(context.Background(), db.UpsertDeviceParams{Token: "dev1", LastSeenAt: 1}); err != nil {
		t.Fatal(err)
	}
	wantStatus(t, v.do("PUT", "/api/devices/dev1", wire.LabelRequest{Label: " Стіл 1 "}), 204)
	d, err := v.st.Q().GetDevice(context.Background(), "dev1")
	if err != nil || d.Label != "Стіл 1" {
		t.Errorf("device = %+v, %v", d, err)
	}
}

func TestClassesParse(t *testing.T) {
	v := setup(t, false)
	text := "№\tПІБ\n1\tШевченко  Тарас\n2.\tУкраїнка Леся\n\nКоцюбинський\tМихайло\n"
	w := v.do("POST", "/api/classes/parse", wire.ParseRequest{Text: text})
	wantStatus(t, w, 200)
	got := decodeBody[wire.ParseResult](t, w).Names
	want := []string{"Шевченко Тарас", "Українка Леся", "Коцюбинський Михайло"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("names = %q, want %q", got, want)
	}
	if got := decodeBody[wire.ParseResult](t, v.do("POST", "/api/classes/parse", wire.ParseRequest{})).Names; got == nil || len(got) != 0 {
		t.Errorf("empty text names = %#v, want []", got)
	}
}

func TestClassPutKeepsStudentIDs(t *testing.T) {
	v := setup(t, false)
	w := v.do("POST", "/api/classes", wire.Class{Name: " 7-А  ", Students: []wire.Student{{Name: "Шевченко  Тарас"}, {Name: "Андрієнко Оля"}, {Name: "  "}, {Name: "Бондар Іван"}}})
	wantStatus(t, w, 201)
	c := decodeBody[wire.Class](t, w)
	if c.ID == "" || c.Name != "7-А" || len(c.Students) != 3 {
		t.Fatalf("created = %+v", c)
	}
	// Students come back in Ukrainian collation order.
	order := []string{c.Students[0].Name, c.Students[1].Name, c.Students[2].Name}
	if strings.Join(order, "|") != "Андрієнко Оля|Бондар Іван|Шевченко Тарас" {
		t.Errorf("order = %q", order)
	}
	shevchenko, bondar := c.Students[2], c.Students[1]

	// Rename Shevchenko, drop Andriienko, keep Bondar, add Ґудзь.
	put := wire.Class{ID: c.ID, Name: "7-Б", Students: []wire.Student{
		{ID: shevchenko.ID, Name: "Шевченко Тарас Григорович"}, {ID: bondar.ID, Name: bondar.Name}, {Name: "Ґудзь Ада"},
	}}
	w = v.do("PUT", "/api/classes/"+c.ID, put)
	wantStatus(t, w, 200)
	got := decodeBody[wire.Class](t, w)
	if got.Name != "7-Б" || len(got.Students) != 3 {
		t.Fatalf("after put = %+v", got)
	}
	byName := map[string]string{}
	for _, s := range got.Students {
		byName[s.Name] = s.ID
	}
	if byName["Шевченко Тарас Григорович"] != shevchenko.ID || byName["Бондар Іван"] != bondar.ID {
		t.Errorf("ids changed: %+v", got.Students)
	}
	if id := byName["Ґудзь Ада"]; id == "" || id == shevchenko.ID || id == bondar.ID {
		t.Errorf("new student id = %q", id)
	}
	if _, ok := byName["Андрієнко Оля"]; ok {
		t.Error("removed student still listed")
	}
	if order := []string{got.Students[0].Name, got.Students[1].Name, got.Students[2].Name}; strings.Join(order, "|") != "Бондар Іван|Ґудзь Ада|Шевченко Тарас Григорович" {
		t.Errorf("order = %q", order)
	}

	list := decodeBody[[]wire.ClassSummary](t, v.do("GET", "/api/classes", nil))
	if len(list) != 1 || list[0].Name != "7-Б" || list[0].StudentCount != 3 {
		t.Errorf("list = %+v", list)
	}

	// A foreign or repeated id, and over-long names, are refused without changes.
	for _, bad := range []wire.Class{
		{ID: c.ID, Name: "x", Students: []wire.Student{{ID: "foreign", Name: "Хтось"}}},
		{ID: c.ID, Name: "x", Students: []wire.Student{{ID: bondar.ID, Name: "А"}, {ID: bondar.ID, Name: "Б"}}},
		{ID: c.ID, Name: "x", Students: []wire.Student{{Name: strings.Repeat("я", 61)}}},
		{ID: c.ID, Name: strings.Repeat("я", 61)},
		{ID: c.ID, Name: " "},
	} {
		wantError(t, v.do("PUT", "/api/classes/"+c.ID, bad), 400, "invalid")
	}
	if after := decodeBody[wire.Class](t, v.do("GET", "/api/classes/"+c.ID, nil)); after.Name != "7-Б" || len(after.Students) != 3 {
		t.Errorf("class changed by refused puts: %+v", after)
	}
	wantError(t, v.do("PUT", "/api/classes/nope", wire.Class{Name: "x"}), 404, "not_found")
	wantStatus(t, v.do("DELETE", "/api/classes/"+c.ID, nil), 204)
	wantError(t, v.do("GET", "/api/classes/"+c.ID, nil), 404, "not_found")
	wantError(t, v.do("DELETE", "/api/classes/"+c.ID, nil), 404, "not_found")
}

// startSitting runs a sitting of a good test and returns its assignment id.
func (v *env) startSitting(t *testing.T) string {
	t.Helper()
	id := v.saveTest(t, goodTest(""))
	w := v.do("POST", "/api/sittings", wire.StartRequest{TestID: id})
	wantStatus(t, w, 201)
	return decodeBody[wire.SittingInfo](t, w).AssignmentID
}

func (v *env) stale(t *testing.T, asg string) bool {
	t.Helper()
	for _, a := range decodeBody[[]wire.AssignmentSummary](t, v.do("GET", "/api/assignments", nil)) {
		if a.ID == asg {
			return a.ExportStale
		}
	}
	t.Fatalf("assignment %s not listed", asg)
	return false
}

func TestAssignmentsAndResults(t *testing.T) {
	v := setup(t, false)
	asg := v.startSitting(t)
	list := decodeBody[[]wire.AssignmentSummary](t, v.do("GET", "/api/assignments", nil))
	if len(list) != 1 || list[0].ID != asg || list[0].TestTitle != "Дроби" || list[0].Participants != 0 || list[0].CreatedAt == 0 || list[0].AverageGrade != nil {
		t.Errorf("list = %+v", list)
	}
	res := decodeBody[wire.AssignmentResults](t, v.do("GET", "/api/assignments/"+asg+"/results", nil))
	if res.AssignmentID != asg || len(res.Questions) != 1 {
		t.Errorf("results = %+v", res)
	}
	wantError(t, v.do("GET", "/api/assignments/nope/results", nil), 404, "not_found")
	wantError(t, v.do("PUT", "/api/assignments/"+asg+"/overrides", wire.OverrideRequest{ParticipantID: "nope", QuestionID: "q1"}), 404, "not_found")
}

func TestParticipantRoutesAndOverrides(t *testing.T) {
	v := setup(t, false)
	asg := v.startSitting(t)
	info := decodeBody[wire.LiveSnapshot](t, v.do("GET", "/api/sittings/current", nil)).Sitting
	var ids []string
	for _, dev := range []string{"dev1", "dev2"} {
		if _, err := v.e.Join(info.Code, dev, "10.0.0.5"); err != nil {
			t.Fatal(err)
		}
	}
	for i, dev := range []string{"dev1", "dev2"} {
		p, err := v.e.Pick(info.Code, dev, wire.PickRequest{Surname: fmt.Sprintf("Учень%d", i), FirstName: "А"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, p.ID)
	}
	wantError(t, v.do("PUT", "/api/assignments/"+asg+"/overrides", wire.OverrideRequest{ParticipantID: ids[0], QuestionID: "q1", Points: ptr(5)}), 400, "invalid")
	if v.stale(t, asg) {
		t.Fatal("a refused override marked the export stale")
	}
	pts := ptr(1)
	w := v.do("PUT", "/api/assignments/"+asg+"/overrides", wire.OverrideRequest{ParticipantID: ids[0], QuestionID: "q1", Points: pts})
	wantStatus(t, w, 200)
	res := decodeBody[wire.AssignmentResults](t, w)
	if !res.ExportStale || len(res.Rows) != 2 || res.Rows[0].Points[0] != 1 {
		t.Errorf("results = %+v", res)
	}
	// Grades 6 (1 of 2 points) and 1 (nothing answered). The average leaves
	// out the students still writing, whose grades are partial.
	average := func(when string, participants int, want *float64) {
		t.Helper()
		got := decodeBody[[]wire.AssignmentSummary](t, v.do("GET", "/api/assignments", nil))[0]
		if got.Participants != participants || (got.AverageGrade == nil) != (want == nil) || (want != nil && *got.AverageGrade != *want) {
			t.Errorf("list %s = %+v, want %d participants, average %v", when, got, participants, want)
		}
	}
	average("while both write", 2, nil)
	for _, step := range []struct {
		dev  string
		want float64
	}{{"dev2", 1}, {"dev1", 3.5}} {
		if _, err := v.e.Finish(step.dev); err != nil {
			t.Fatal(err)
		}
		average("after "+step.dev+" finished", 2, ptr(step.want))
	}

	wantStatus(t, v.do("POST", "/api/participants/"+ids[1]+"/kick", nil), 204)
	average("after the kick", 1, ptr(6))
	wantError(t, v.do("POST", "/api/participants/"+ids[0]+"/move", wire.MoveRequest{Device: "nope"}), 404, "not_found")
	wantStatus(t, v.do("PUT", "/api/devices/dev1", wire.LabelRequest{Label: "Стіл 1"}), 204)
	wantStatus(t, v.do("POST", "/api/participants/"+ids[0]+"/move", wire.MoveRequest{Device: "dev2"}), 204)
}

func ptr(f float64) *float64 { return &f }

func TestExportFallbackDownload(t *testing.T) {
	v := setup(t, false)
	asg := v.startSitting(t)
	if err := v.st.Q().SetExportStale(context.Background(), asg); err != nil {
		t.Fatal(err)
	}
	w := v.do("POST", "/api/assignments/"+asg+"/export", nil)
	wantStatus(t, w, 200)
	if ct := w.Header().Get("Content-Type"); ct != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" {
		t.Errorf("Content-Type = %q", ct)
	}
	cd := w.Header().Get("Content-Disposition")
	if !strings.HasPrefix(cd, `attachment; filename="`) || !strings.Contains(cd, "filename*=UTF-8''%D0%94%D1%80%D0%BE%D0%B1%D0%B8") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	for _, c := range strings.SplitN(cd, ";", 3)[1] {
		if c > 126 {
			t.Errorf("non-ASCII in the fallback filename: %q", cd)
			break
		}
	}
	if !bytes.HasPrefix(w.Body.Bytes(), []byte("PK")) {
		t.Errorf("body is not a zip: %.10q", w.Body)
	}
	if v.stale(t, asg) {
		t.Error("export_stale not cleared")
	}
	wantError(t, v.do("POST", "/api/assignments/nope/export", nil), 404, "not_found")
}

func TestExportThroughDialogs(t *testing.T) {
	v := setup(t, true)
	asg := v.startSitting(t)
	if err := v.st.Q().SetExportStale(context.Background(), asg); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "out.xlsx")
	if err := os.WriteFile(target, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	v.dialogs.path = target
	w := v.do("POST", "/api/assignments/"+asg+"/export", nil)
	wantStatus(t, w, 200)
	if got := decodeBody[wire.ExportResult](t, w).Path; got != target {
		t.Errorf("path = %q", got)
	}
	if !strings.HasPrefix(v.dialogs.name, "Дроби") || !strings.HasSuffix(v.dialogs.name, ".xlsx") {
		t.Errorf("default name = %q", v.dialogs.name)
	}
	data, err := os.ReadFile(target)
	if err != nil || !bytes.HasPrefix(data, []byte("PK")) {
		t.Errorf("file = %.10q, %v", data, err)
	}
	if v.stale(t, asg) {
		t.Error("export_stale not cleared")
	}
	if left, _ := filepath.Glob(filepath.Join(filepath.Dir(target), "*.tmp")); len(left) != 0 {
		t.Errorf("temp files left: %v", left)
	}
}

func TestClearStaleSkipsChangedResults(t *testing.T) {
	v := setup(t, false)
	asg := v.startSitting(t)
	info := decodeBody[wire.LiveSnapshot](t, v.do("GET", "/api/sittings/current", nil)).Sitting
	if _, err := v.e.Join(info.Code, "dev1", "10.0.0.5"); err != nil {
		t.Fatal(err)
	}
	p, err := v.e.Pick(info.Code, "dev1", wire.PickRequest{Surname: "Учень", FirstName: "А"})
	if err != nil {
		t.Fatal(err)
	}
	if err := v.e.SetOverride(asg, p.ID, "q1", ptr(1)); err != nil {
		t.Fatal(err)
	}
	read, err := v.e.Results(asg) // what an export in progress holds
	if err != nil {
		t.Fatal(err)
	}
	if err := v.e.SetOverride(asg, p.ID, "q1", ptr(2)); err != nil {
		t.Fatal(err)
	}
	clearStale := func(res wire.AssignmentResults) {
		t.Helper()
		if err := v.st.Q().ClearExportStale(context.Background(), db.ClearExportStaleParams{ID: asg, ResultsRev: res.ResultsRev}); err != nil {
			t.Fatal(err)
		}
	}
	clearStale(read)
	if !v.stale(t, asg) {
		t.Error("an export of older results cleared export_stale")
	}
	fresh, err := v.e.Results(asg)
	if err != nil || fresh.ResultsRev <= read.ResultsRev {
		t.Fatalf("rev %d after %d, %v", fresh.ResultsRev, read.ResultsRev, err)
	}
	clearStale(fresh)
	if v.stale(t, asg) {
		t.Error("an export of the current results left export_stale set")
	}
}

// enterStudent joins a typed-name student on a new device and returns the
// participant id.
func (v *env) enterStudent(t *testing.T) string {
	t.Helper()
	code := decodeBody[wire.LiveSnapshot](t, v.do("GET", "/api/sittings/current", nil)).Sitting.Code
	if _, err := v.e.Join(code, "dev1", "10.0.0.5"); err != nil {
		t.Fatal(err)
	}
	p, err := v.e.Pick(code, "dev1", wire.PickRequest{Surname: "Учень", FirstName: "А"})
	if err != nil {
		t.Fatal(err)
	}
	return p.ID
}

// An override made while the save dialog is open is not in the exported
// results, so the export must leave the assignment stale.
func TestExportKeepsStaleWhenResultsChangeDuringDialog(t *testing.T) {
	v := setup(t, true)
	asg := v.startSitting(t)
	pid := v.enterStudent(t)
	if err := v.e.SetOverride(asg, pid, "q1", ptr(1)); err != nil {
		t.Fatal(err)
	}
	v.dialogs.path = filepath.Join(t.TempDir(), "out.xlsx")
	v.dialogs.during = func() {
		if err := v.e.SetOverride(asg, pid, "q1", ptr(2)); err != nil {
			t.Error(err)
		}
	}
	wantStatus(t, v.do("POST", "/api/assignments/"+asg+"/export", nil), 200)
	if !v.stale(t, asg) {
		t.Error("export of older results cleared export_stale")
	}
	v.dialogs.during = nil
	wantStatus(t, v.do("POST", "/api/assignments/"+asg+"/export", nil), 200)
	if v.stale(t, asg) {
		t.Error("export of the current results left export_stale set")
	}
}

// failingWriter is a response whose body cannot be written.
type failingWriter struct{ *httptest.ResponseRecorder }

func (failingWriter) Write([]byte) (int, error) { return 0, errors.New("client went away") }

func TestDownloadFailureKeepsStale(t *testing.T) {
	v := setup(t, false)
	asg := v.startSitting(t)
	if err := v.st.Q().SetExportStale(context.Background(), asg); err != nil {
		t.Fatal(err)
	}
	v.h.ServeHTTP(failingWriter{httptest.NewRecorder()}, v.req("POST", "/api/assignments/"+asg+"/export", nil))
	if !v.stale(t, asg) {
		t.Error("a download that did not reach the client cleared export_stale")
	}
}

func TestExportCancelledKeepsStale(t *testing.T) {
	v := setup(t, true)
	asg := v.startSitting(t)
	if err := v.st.Q().SetExportStale(context.Background(), asg); err != nil {
		t.Fatal(err)
	}
	wantStatus(t, v.do("POST", "/api/assignments/"+asg+"/export", nil), 204) // dialogs return ("", nil)
	if !v.stale(t, asg) {
		t.Error("a cancelled export cleared export_stale")
	}
}

func TestExportWriteFailure(t *testing.T) {
	v := setup(t, true)
	asg := v.startSitting(t)
	if err := v.st.Q().SetExportStale(context.Background(), asg); err != nil {
		t.Fatal(err)
	}
	// The target is a directory, so the rename cannot replace it.
	dir := filepath.Join(t.TempDir(), "taken.xlsx")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	v.dialogs.path = dir
	wantError(t, v.do("POST", "/api/assignments/"+asg+"/export", nil), 409, "write_failed")
	if left, _ := filepath.Glob(filepath.Join(filepath.Dir(dir), "*.tmp")); len(left) != 0 {
		t.Errorf("temp files left: %v", left)
	}
	// So is a target in a folder that does not exist.
	v.dialogs.path = filepath.Join(t.TempDir(), "missing", "out.xlsx")
	wantError(t, v.do("POST", "/api/assignments/"+asg+"/export", nil), 409, "write_failed")
	if !v.stale(t, asg) {
		t.Error("a failed export cleared export_stale")
	}
	v.dialogs.err = errors.New("dialog crashed")
	wantError(t, v.do("POST", "/api/assignments/"+asg+"/export", nil), 500, "internal")
}

func TestNetwork(t *testing.T) {
	v := setup(t, false)
	n := decodeBody[wire.NetworkInfo](t, v.do("GET", "/api/network", nil))
	if n.Address != "192.168.1.20" || n.URL != "http://192.168.1.20:8080" || n.Port != 8080 || len(n.Candidates) != 2 || n.Error != "" {
		t.Errorf("network = %+v", n)
	}
	for _, bad := range []string{"8.8.8.8", "", "not-an-ip", "127.0.0.1"} {
		wantError(t, v.do("PUT", "/api/network", wire.NetworkRequest{Address: bad}), 400, "invalid")
	}
	if got := decodeBody[wire.NetworkInfo](t, v.do("GET", "/api/network", nil)); got.Address != "192.168.1.20" {
		t.Errorf("address changed by a refused put: %+v", got)
	}
	w := v.do("PUT", "/api/network", wire.NetworkRequest{Address: "10.0.0.7"})
	wantStatus(t, w, 200)
	if n = decodeBody[wire.NetworkInfo](t, w); n.Address != "10.0.0.7" || n.URL != "http://10.0.0.7:8080" {
		t.Errorf("network = %+v", n)
	}
	saved, err := config.Load(v.dir)
	if err != nil || saved.Address != "10.0.0.7" {
		t.Errorf("saved = %+v, %v", saved, err)
	}
}

func TestSettings(t *testing.T) {
	v := setup(t, false)
	if s := decodeBody[wire.SettingsInfo](t, v.do("GET", "/api/settings", nil)); s.Port != 8080 || s.Language != "uk" {
		t.Errorf("settings = %+v", s)
	}
	for _, bad := range []wire.SettingsInfo{{Port: 8080, Language: "de"}, {Port: 0, Language: "uk"}, {Port: 65536, Language: "uk"}, {Port: -1, Language: "en"}} {
		wantError(t, v.do("PUT", "/api/settings", bad), 400, "invalid")
	}
	w := v.do("PUT", "/api/settings", wire.SettingsInfo{Port: 9000, Language: "en"})
	wantStatus(t, w, 200)
	if s := decodeBody[wire.SettingsInfo](t, w); s.Port != 9000 || s.Language != "en" || !s.RestartRequired {
		t.Errorf("settings = %+v", s)
	}
	if s := decodeBody[wire.SettingsInfo](t, v.do("GET", "/api/settings", nil)); !s.RestartRequired {
		t.Errorf("GET settings = %+v", s)
	}
	// Saving the running port back needs no restart.
	if s := decodeBody[wire.SettingsInfo](t, v.do("PUT", "/api/settings", wire.SettingsInfo{Port: 8080, Language: "en"})); s.RestartRequired {
		t.Errorf("settings at the running port = %+v", s)
	}
	wantStatus(t, v.do("PUT", "/api/settings", wire.SettingsInfo{Port: 9000, Language: "en"}), 200)
	saved, err := config.Load(v.dir)
	if err != nil || saved.Port != 9000 || saved.Language != "en" {
		t.Errorf("saved = %+v, %v", saved, err)
	}
	// The running port is unchanged until the next launch.
	if n := decodeBody[wire.NetworkInfo](t, v.do("GET", "/api/network", nil)); n.Port != 8080 {
		t.Errorf("network port = %d", n.Port)
	}
	// The new language reaches the student pages at once.
	id := v.saveTest(t, goodTest(""))
	info := decodeBody[wire.SittingInfo](t, v.do("POST", "/api/sittings", wire.StartRequest{TestID: id}))
	jr, err := v.e.Join(info.Code, "dev", "10.0.0.5")
	if err != nil || jr.Language != "en" {
		t.Errorf("join = %+v, %v", jr, err)
	}
}

func TestLANPortIsTheRunningServer(t *testing.T) {
	// A -port override: the server runs on 8090 while the saved port is 8080.
	v := setup(t, false, func(d *Deps) { d.LANPort = 8090 })
	n := decodeBody[wire.NetworkInfo](t, v.do("GET", "/api/network", nil))
	if n.Port != 8090 || n.URL != "http://192.168.1.20:8090" {
		t.Errorf("network = %+v", n)
	}
	if s := decodeBody[wire.SettingsInfo](t, v.do("GET", "/api/settings", nil)); s.Port != 8080 || !s.RestartRequired {
		t.Errorf("settings = %+v", s)
	}

	// No LAN server: the saved port shows, and only a restart can start the server.
	v = setup(t, false, func(d *Deps) { d.LANPort = 0 })
	if n = decodeBody[wire.NetworkInfo](t, v.do("GET", "/api/network", nil)); n.Port != 8080 || n.URL != "" || n.Address != "192.168.1.20" || n.Error != "" {
		t.Errorf("network = %+v", n)
	}
	if s := decodeBody[wire.SettingsInfo](t, v.do("GET", "/api/settings", nil)); !s.RestartRequired {
		t.Errorf("settings = %+v", s)
	}
}

func TestNetworkReportsBusyPort(t *testing.T) {
	v := setup(t, false, func(d *Deps) {
		d.LANPort = 0
		d.LANError = func() string { return "port_busy" }
	})
	w := v.do("GET", "/api/network", nil)
	if n := decodeBody[wire.NetworkInfo](t, w); n.Error != "port_busy" || n.Port != 8080 || n.URL != "" {
		t.Errorf("network = %+v", n)
	}
	// The teacher picks another port; it takes effect at the next launch.
	w = v.do("PUT", "/api/settings", wire.SettingsInfo{Port: 8090, Language: "uk"})
	wantStatus(t, w, 200)
	if s := decodeBody[wire.SettingsInfo](t, w); s.Port != 8090 || !s.RestartRequired {
		t.Errorf("settings = %+v", s)
	}
	if n := decodeBody[wire.NetworkInfo](t, v.do("GET", "/api/network", nil)); n.Error != "port_busy" || n.Port != 8090 {
		t.Errorf("network after the change = %+v", n)
	}
}

func TestEventsStream(t *testing.T) {
	v := setup(t, false)
	srv := httptest.NewServer(v.h)
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/events", nil)
	req.Host = fmt.Sprintf("127.0.0.1:%d", port)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type = %q", ct)
	}
	v.hub.Publish(events.Event{Topic: "teacher", Name: "live"})
	buf := make([]byte, 64)
	n, err := resp.Body.Read(buf)
	if err != nil || !strings.HasPrefix(string(buf[:n]), "event: live") {
		t.Errorf("frame = %q, %v", buf[:n], err)
	}
}

func TestOversizeBodyIs413(t *testing.T) {
	v := setup(t, false)
	big := []byte(`{"title":"` + strings.Repeat("я", maxBodyBytes) + `"}`)
	wantError(t, v.do("POST", "/api/tests", big), 413, "too_large")
}

func TestNewToken(t *testing.T) {
	a, b := NewToken(), NewToken()
	if len(a) != 43 || a == b || strings.ContainsAny(a, "=+/") {
		t.Errorf("tokens %q %q", a, b)
	}
}

func TestQR(t *testing.T) {
	v := setup(t, false)
	w := v.do("GET", "/api/qr?text="+url.QueryEscape("http://192.168.1.20:8080/?code=1234"), nil)
	wantStatus(t, w, 200)
	if ct := w.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
	img, err := png.Decode(w.Body)
	if err != nil {
		t.Fatalf("not a PNG: %v", err)
	}
	if b := img.Bounds(); b.Dx() != 512 || b.Dy() != 512 {
		t.Errorf("size = %v, want 512×512", b.Size())
	}
	wantError(t, v.do("GET", "/api/qr?text=", nil), 400, "invalid")
	wantError(t, v.do("GET", "/api/qr", nil), 400, "invalid")
	wantError(t, v.do("GET", "/api/qr?text="+strings.Repeat("a", 513), nil), 400, "invalid")
	wantStatus(t, v.do("GET", "/api/qr?text="+strings.Repeat("a", 512), nil), 200)
}

// The UI says «Експорт застарів» while Exported and ExportStale are both set:
// never before the first export, after an export once an answer is stored,
// and no more after the next export. Both export paths record the export.
func TestExportedFlag(t *testing.T) {
	for _, withDialogs := range []bool{false, true} {
		v := setup(t, withDialogs)
		if withDialogs {
			v.dialogs.path = filepath.Join(v.dir, "out.xlsx")
		}
		asg := v.startSitting(t)
		code := decodeBody[wire.LiveSnapshot](t, v.do("GET", "/api/sittings/current", nil)).Sitting.Code
		if _, err := v.e.Join(code, "dev1", "10.0.0.5"); err != nil {
			t.Fatal(err)
		}
		p, err := v.e.Pick(code, "dev1", wire.PickRequest{Surname: "Учень", FirstName: "А"})
		if err != nil {
			t.Fatal(err)
		}
		answer := func(seq int64, option string) {
			t.Helper()
			ch := wire.AnswerChange{ChangeID: fmt.Sprintf("c%d", seq), ParticipantID: p.ID, QuestionID: "q1", OptionIDs: []string{option}, Seq: seq}
			if _, err := v.e.Submit("dev1", []wire.AnswerChange{ch}, 0); err != nil {
				t.Fatal(err)
			}
		}
		flags := func(when string, exported, stale bool) {
			t.Helper()
			res := decodeBody[wire.AssignmentResults](t, v.do("GET", "/api/assignments/"+asg+"/results", nil))
			if res.Exported != exported || res.ExportStale != stale {
				t.Errorf("dialogs %v, %s: exported %v, stale %v; want %v, %v", withDialogs, when, res.Exported, res.ExportStale, exported, stale)
			}
		}

		answer(1, "o0")
		flags("before any export", false, true)
		wantStatus(t, v.do("POST", "/api/assignments/"+asg+"/export", nil), 200)
		flags("after the export", true, false)
		answer(2, "o1")
		flags("after an answer stored since", true, true)
		wantStatus(t, v.do("POST", "/api/assignments/"+asg+"/export", nil), 200)
		flags("after the next export", true, false)
	}
}
