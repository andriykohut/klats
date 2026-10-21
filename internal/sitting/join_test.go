package sitting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"klats/internal/events"
	"klats/internal/roster"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

const (
	devA = "aaaaaaaaaaaaaaaaaaaaaaaaaa"
	devB = "bbbbbbbbbbbbbbbbbbbbbbbbbb"
	devC = "cccccccccccccccccccccccccc"
)

var clock = func() time.Time { return time.UnixMilli(1_790_000_000_000) }

func rich(s string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q}]}]}`, s))
}

func openStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "klats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

// setup returns an engine over a fresh database holding test "t1": q1 is a
// single-choice question with two options in fixed order, q2 a multi-choice
// question with six shuffled options.
func setup(t *testing.T) (*Engine, *store.Store, *events.Hub) {
	t.Helper()
	st := openStore(t)
	opts := func(n int) []testfmt.Option {
		var os []testfmt.Option
		for i := range n {
			os = append(os, testfmt.Option{ID: "o" + strconv.Itoa(i), Content: rich("варіант " + strconv.Itoa(i)), Correct: i == 0})
		}
		return os
	}
	doc, err := json.Marshal(testfmt.Test{ID: "t1", Version: 1, Title: "Дроби", Palette: "teal", Questions: []testfmt.Question{
		{ID: "q1", Type: "single", Text: rich("Скільки?"), Points: 2, Options: opts(2)},
		{ID: "q2", Type: "multi", Text: rich("Оберіть"), Points: 3, Partial: true, ShuffleOptions: true, Options: opts(6)},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Q().InsertTest(context.Background(), db.InsertTestParams{ID: "t1", Title: "Дроби", Doc: string(doc)}); err != nil {
		t.Fatal(err)
	}
	hub := events.New()
	return newEngine(t, st, hub), st, hub
}

func newEngine(t *testing.T, st *store.Store, hub *events.Hub) *Engine {
	t.Helper()
	e, err := New(st, hub, clock)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func assignment(t *testing.T, st *store.Store, id string) db.Assignment {
	t.Helper()
	a, err := st.Q().GetAssignment(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func addClass(t *testing.T, st *store.Store, names ...string) *string {
	t.Helper()
	ctx := context.Background()
	id := store.NewID()
	if err := st.Q().InsertClass(ctx, db.InsertClassParams{ID: id, Name: "7-А"}); err != nil {
		t.Fatal(err)
	}
	for _, n := range names {
		if err := st.Q().InsertStudent(ctx, db.InsertStudentParams{ID: store.NewID(), ClassID: id, Name: n, SortKey: roster.SortKey(n)}); err != nil {
			t.Fatal(err)
		}
	}
	return &id
}

func start(t *testing.T, e *Engine, classID *string) wire.SittingInfo {
	t.Helper()
	info, err := e.Start("t1", classID)
	if err != nil {
		t.Fatal(err)
	}
	return info
}

func join(t *testing.T, e *Engine, code, device, ip string) wire.JoinInfo {
	t.Helper()
	info, err := e.Join(code, device, ip)
	if err != nil {
		t.Fatal(err)
	}
	return info
}

func pick(t *testing.T, e *Engine, code, device string, req wire.PickRequest) wire.Participant {
	t.Helper()
	p, err := e.Pick(code, device, req)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func openClashes(t *testing.T, st *store.Store, sittingID string) []db.Event {
	t.Helper()
	evs, err := st.Q().ListOpenClashes(context.Background(), sittingID)
	if err != nil {
		t.Fatal(err)
	}
	return evs
}

func participantRow(t *testing.T, st *store.Store, sittingID, id string) db.Participant {
	t.Helper()
	ps, err := st.Q().ListParticipants(context.Background(), sittingID)
	if err != nil {
		t.Fatal(err)
	}
	i := slices.IndexFunc(ps, func(p db.Participant) bool { return p.ID == id })
	if i < 0 {
		t.Fatalf("participant %s not stored", id)
	}
	return ps[i]
}

func TestStartRejectsSecondSitting(t *testing.T) {
	e, _, _ := setup(t)
	info := start(t, e, nil)
	if len(info.Code) != 4 || strings.Trim(info.Code, "0123456789") != "" {
		t.Errorf("code = %q, want 4 digits", info.Code)
	}
	if info.TestTitle != "Дроби" || info.QuestionCount != 2 || info.ClassName != "" || info.StartedAt != clock().UnixMilli() {
		t.Errorf("info = %+v", info)
	}
	if _, err := e.Start("t1", nil); !errors.Is(err, ErrSittingActive) {
		t.Fatalf("second Start: err = %v, want ErrSittingActive", err)
	}
}

func TestStartRefusesTestWithProblems(t *testing.T) {
	e, st, _ := setup(t)
	doc := `{"id":"t2","version":1,"title":"Порожній","questions":[{"id":"q1","type":"single","points":1,"options":[]}]}`
	if err := st.Q().InsertTest(context.Background(), db.InsertTestParams{ID: "t2", Title: "Порожній", Doc: doc}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Start("t2", nil); !errors.Is(err, ErrHasProblems) {
		t.Fatalf("err = %v, want ErrHasProblems", err)
	}
	start(t, e, nil) // the refused start left no sitting behind
}

func TestJoinWrongCode(t *testing.T) {
	e, _, _ := setup(t)
	if _, err := e.Join("1234", devA, "10.0.0.7"); !errors.Is(err, ErrBadCode) {
		t.Fatalf("no sitting: err = %v, want ErrBadCode", err)
	}
	code := start(t, e, nil).Code
	n, _ := strconv.Atoi(code)
	if _, err := e.Join(fmt.Sprintf("%04d", (n+1)%10000), devA, "10.0.0.7"); !errors.Is(err, ErrBadCode) {
		t.Fatalf("err = %v, want ErrBadCode", err)
	}
	if _, err := e.Pick("", devA, wire.PickRequest{Surname: "Шевченко", FirstName: "Тарас"}); !errors.Is(err, ErrBadCode) {
		t.Fatalf("Pick: err = %v, want ErrBadCode", err)
	}
}

func TestJoinLabelsDevice(t *testing.T) {
	for ip, want := range map[string]string{
		"192.168.1.107":    "107",
		"::ffff:10.0.0.9":  "9",
		"fe80::1:2b%eth0":  "2b",
		"192.168.1.7:5000": "?",
		"":                 "?",
	} {
		if got := deviceLabel(ip); got != want {
			t.Errorf("deviceLabel(%q) = %q, want %q", ip, got, want)
		}
	}

	e, st, _ := setup(t)
	code := start(t, e, nil).Code
	join(t, e, code, devA, "192.168.1.107")
	if err := e.RenameDevice(devA, "  ПК-07 "); err != nil {
		t.Fatal(err)
	}
	join(t, e, code, devA, "192.168.1.200") // a known device keeps its label
	p := pick(t, e, code, devA, wire.PickRequest{Surname: "Шевченко", FirstName: "Тарас"})
	if p.DeviceLabel != "ПК-07" {
		t.Errorf("label = %q, want ПК-07", p.DeviceLabel)
	}
	d, err := st.Q().GetDevice(context.Background(), devA)
	if err != nil {
		t.Fatal(err)
	}
	if d.LastIp != "192.168.1.200" {
		t.Errorf("last ip = %q", d.LastIp)
	}
	if err := e.RenameDevice(devB, "ПК-08"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown device: err = %v, want ErrNotFound", err)
	}
	if _, err := e.Pick(code, devB, wire.PickRequest{Surname: "Франко", FirstName: "Іван"}); !errors.Is(err, ErrNotJoined) {
		t.Errorf("Pick before Join: err = %v, want ErrNotJoined", err)
	}
}

func TestPickLocksNameToDevice(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, addClass(t, st, "Петренко Тарас", "Іваненко Олена"))
	if a := assignment(t, st, info.AssignmentID); info.ClassName != "7-А" || a.ClassName.String != "7-А" {
		t.Errorf("class name: info %q, stored %+v", info.ClassName, a.ClassName)
	}
	join(t, e, info.Code, devA, "10.0.0.107")
	names := join(t, e, info.Code, devB, "10.0.0.108").Names
	if len(names) != 2 || names[0].Name != "Іваненко Олена" || names[1].Name != "Петренко Тарас" {
		t.Fatalf("names = %+v", names)
	}
	olena := names[0].StudentID

	p := pick(t, e, info.Code, devA, wire.PickRequest{StudentID: olena})
	if p.Name != "Іваненко Олена" || p.DeviceLabel != "107" || p.State != "writing" {
		t.Errorf("participant = %+v", p)
	}
	if !join(t, e, info.Code, devB, "10.0.0.108").Names[0].Taken {
		t.Error("name not shown as taken to another device")
	}
	if join(t, e, info.Code, devA, "10.0.0.107").Names[0].Taken {
		t.Error("name shown as taken to the device holding it")
	}

	for range 2 {
		_, err := e.Pick(info.Code, devB, wire.PickRequest{StudentID: olena})
		var taken ErrNameTaken
		if !errors.As(err, &taken) || taken.Label != "107" {
			t.Fatalf("err = %v, want ErrNameTaken{107}", err)
		}
	}
	evs := openClashes(t, st, info.SittingID)
	if len(evs) != 1 || evs[0].Pinned != 1 {
		t.Fatalf("events = %+v, want one pinned name_clash", evs)
	}
	var params map[string]string
	if err := json.Unmarshal([]byte(evs[0].Params), &params); err != nil {
		t.Fatal(err)
	}
	if params["name"] != "Іваненко Олена" || params["holder"] != "107" || params["newcomer"] != "108" {
		t.Errorf("params = %v", params)
	}

	if _, err := e.Pick(info.Code, devA, wire.PickRequest{StudentID: names[1].StudentID}); !errors.Is(err, ErrInvalid) {
		t.Errorf("second name on one device: err = %v, want ErrInvalid", err)
	}
	if _, err := e.Pick(info.Code, devB, wire.PickRequest{StudentID: "nobody"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown student: err = %v, want ErrInvalid", err)
	}
}

func TestPickSameDeviceIsIdempotent(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, addClass(t, st, "Петренко Тарас"))
	names := join(t, e, info.Code, devA, "10.0.0.107").Names
	first := pick(t, e, info.Code, devA, wire.PickRequest{StudentID: names[0].StudentID})
	again := pick(t, e, info.Code, devA, wire.PickRequest{StudentID: names[0].StudentID})
	if again != first {
		t.Errorf("second pick = %+v, want %+v", again, first)
	}
	ps, err := st.Q().ListParticipants(context.Background(), info.SittingID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 1 {
		t.Errorf("%d participants stored, want 1", len(ps))
	}
}

func TestDuplicateNamesHaveDistinctEntries(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, addClass(t, st, "Коваль Дмитро", "Антоненко Ірина", "Коваль Дмитро"))
	names := join(t, e, info.Code, devA, "10.0.0.107").Names
	join(t, e, info.Code, devB, "10.0.0.108")
	var got []string
	for _, n := range names {
		got = append(got, n.Name)
	}
	if want := []string{"Антоненко Ірина", "Коваль Дмитро", "Коваль Дмитро (2)"}; !slices.Equal(got, want) {
		t.Fatalf("names = %q, want %q", got, want)
	}
	if names[1].StudentID == names[2].StudentID {
		t.Fatal("duplicate names share a student id")
	}

	p1 := pick(t, e, info.Code, devA, wire.PickRequest{StudentID: names[1].StudentID})
	p2 := pick(t, e, info.Code, devB, wire.PickRequest{StudentID: names[2].StudentID})
	if p1.Name != "Коваль Дмитро" || p2.Name != "Коваль Дмитро (2)" {
		t.Errorf("participants = %q, %q", p1.Name, p2.Name)
	}
	if row := participantRow(t, st, info.SittingID, p2.ID); row.DisplayName != "Коваль Дмитро (2)" || row.StudentID.String != names[2].StudentID {
		t.Errorf("stored participant = %+v", row)
	}
}

func TestTypedModeWithoutClass(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	ji := join(t, e, info.Code, devA, "10.0.0.107")
	if ji.Mode != "typed" || ji.Names == nil || len(ji.Names) != 0 || ji.Language != "uk" || ji.SittingID != info.SittingID {
		t.Fatalf("join = %+v", ji)
	}
	join(t, e, info.Code, devB, "10.0.0.108")

	if _, err := e.Pick(info.Code, devA, wire.PickRequest{Surname: "Шевченко", FirstName: "  "}); !errors.Is(err, ErrInvalid) {
		t.Errorf("blank first name: err = %v, want ErrInvalid", err)
	}
	p := pick(t, e, info.Code, devA, wire.PickRequest{Surname: " Шевченко ", FirstName: "Тарас", ClassName: " 7-А"})
	if p.Name != "Шевченко Тарас" {
		t.Errorf("name = %q", p.Name)
	}
	row := participantRow(t, st, info.SittingID, p.ID)
	if row.DisplayName != "Шевченко Тарас" || row.TypedName.String != "Шевченко Тарас" || row.TypedClass.String != "7-А" || row.StudentID.Valid {
		t.Errorf("stored participant = %+v", row)
	}
	if assignment(t, st, info.AssignmentID).ClassName.Valid {
		t.Error("class name stored for a sitting without a class")
	}
	var taken ErrNameTaken
	if _, err := e.Pick(info.Code, devB, wire.PickRequest{Surname: "шевченко", FirstName: " ТАРАС", ClassName: "7-а"}); !errors.As(err, &taken) || taken.Label != "107" {
		t.Errorf("same typed name in another case: err = %v, want ErrNameTaken{107}", err)
	}
	if _, err := e.Pick(info.Code, devB, wire.PickRequest{Surname: "Шевченко", FirstName: "Тарас", ClassName: strings.Repeat("А", 61)}); !errors.Is(err, ErrInvalid) {
		t.Errorf("over-long class: err = %v, want ErrInvalid", err)
	}
	if namesake := pick(t, e, info.Code, devB, wire.PickRequest{Surname: "Шевченко", FirstName: "Тарас", ClassName: "7-Б"}); namesake.ID == p.ID {
		t.Error("namesake in another class got the same participant")
	}

	e.SetLanguage("en")
	if ji := join(t, e, info.Code, devB, "10.0.0.108"); ji.Language != "en" {
		t.Errorf("language = %q, want en", ji.Language)
	}
}

func TestStudentPayloadHasNoAnswers(t *testing.T) {
	e, _, _ := setup(t)
	code := start(t, e, nil).Code
	join(t, e, code, devA, "10.0.0.107")
	if _, err := e.TestFor(devA); !errors.Is(err, ErrNotJoined) {
		t.Fatalf("before pick: err = %v, want ErrNotJoined", err)
	}
	pick(t, e, code, devA, wire.PickRequest{Surname: "Шевченко", FirstName: "Тарас"})
	st, err := e.TestFor(devA)
	if err != nil {
		t.Fatal(err)
	}
	if st.Title != "Дроби" || st.Palette != "teal" || len(st.Questions) != 2 || len(st.Questions[1].Options) != 6 {
		t.Fatalf("test = %+v", st)
	}
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	for _, banned := range []string{"correct", "Correct", "points", "partial"} {
		if strings.Contains(string(b), banned) {
			t.Errorf("payload contains %q: %s", banned, b)
		}
	}
}

func optionIDs(q wire.StudentQuestion) []string {
	var ids []string
	for _, o := range q.Options {
		ids = append(ids, o.ID)
	}
	return ids
}

func TestShuffleStablePerDevice(t *testing.T) {
	e, _, _ := setup(t)
	code := start(t, e, nil).Code
	for i, d := range []string{devA, devB} {
		join(t, e, code, d, "10.0.0.1")
		pick(t, e, code, d, wire.PickRequest{Surname: "Учень", FirstName: strconv.Itoa(i)})
	}
	order := func(device string, q int) []string {
		st, err := e.TestFor(device)
		if err != nil {
			t.Fatal(err)
		}
		return optionIDs(st.Questions[q])
	}
	a, b := order(devA, 1), order(devB, 1)
	if !slices.Equal(a, order(devA, 1)) {
		t.Error("same device got a different order")
	}
	if slices.Equal(a, b) {
		t.Errorf("both devices got %v", a)
	}
	if sorted := slices.Sorted(slices.Values(a)); !slices.Equal(sorted, []string{"o0", "o1", "o2", "o3", "o4", "o5"}) {
		t.Errorf("shuffled options = %v", a)
	}
	if got := order(devA, 0); !slices.Equal(got, []string{"o0", "o1"}) {
		t.Errorf("unshuffled question order = %v", got)
	}
}

// startClash starts a list sitting where devA holds the only name and devB has
// asked for it, and returns the sitting, devA's participant and the event.
func startClash(t *testing.T) (*Engine, *store.Store, *events.Hub, wire.SittingInfo, wire.Participant, string) {
	t.Helper()
	e, st, hub := setup(t)
	info := start(t, e, addClass(t, st, "Петренко Тарас"))
	names := join(t, e, info.Code, devA, "10.0.0.107").Names
	join(t, e, info.Code, devB, "10.0.0.108")
	p := pick(t, e, info.Code, devA, wire.PickRequest{StudentID: names[0].StudentID})
	if _, err := e.Pick(info.Code, devB, wire.PickRequest{StudentID: names[0].StudentID}); err == nil {
		t.Fatal("clash expected")
	}
	evs := openClashes(t, st, info.SittingID)
	if len(evs) != 1 {
		t.Fatalf("%d clashes, want 1", len(evs))
	}
	return e, st, hub, info, p, evs[0].ID
}

func received(ch <-chan events.Event) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

func TestResolveClashMove(t *testing.T) {
	e, st, hub, info, p, eventID := startClash(t)
	oldCh, unsubOld := hub.Subscribe("device:" + devA)
	defer unsubOld()
	newCh, unsubNew := hub.Subscribe("device:" + devB)
	defer unsubNew()

	if err := e.ResolveEvent(eventID, "move"); err != nil {
		t.Fatal(err)
	}
	if !received(oldCh) || !received(newCh) {
		t.Error("both devices should get a status event")
	}
	if row := participantRow(t, st, info.SittingID, p.ID); row.DeviceToken != devB || row.State != "writing" {
		t.Errorf("participant = %+v", row)
	}
	moved, err := st.Q().ListMovedDevices(context.Background(), info.SittingID)
	if err != nil {
		t.Fatal(err)
	}
	if len(moved) != 1 || moved[0] != (db.MovedDevice{DeviceToken: devA, ParticipantID: p.ID}) {
		t.Errorf("moved devices = %+v", moved)
	}
	if len(openClashes(t, st, info.SittingID)) != 0 {
		t.Error("event still open")
	}
	if _, err := e.TestFor(devB); err != nil {
		t.Errorf("new device: %v", err)
	}
	if _, err := e.TestFor(devA); !errors.Is(err, ErrNotJoined) {
		t.Errorf("old device: err = %v, want ErrNotJoined", err)
	}
	if e.DeviceStatus(devA) != "moved" || e.DeviceStatus(devB) != "writing" || !slices.Equal(e.cur.movedFrom[devA], []string{p.ID}) {
		t.Errorf("statuses %q, %q; moved from devA %v", e.DeviceStatus(devA), e.DeviceStatus(devB), e.cur.movedFrom[devA])
	}
	if err := e.ResolveEvent(eventID, "move"); !errors.Is(err, ErrNotFound) {
		t.Errorf("resolving twice: err = %v, want ErrNotFound", err)
	}
}

func TestResolveClashKick(t *testing.T) {
	e, st, hub, info, p, eventID := startClash(t)
	newCh, unsub := hub.Subscribe("device:" + devB)
	defer unsub()
	if err := e.ResolveEvent(eventID, "shrug"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown action: err = %v, want ErrInvalid", err)
	}
	if err := e.ResolveEvent(eventID, "kick_old"); err != nil {
		t.Fatal(err)
	}
	if !received(newCh) {
		t.Error("newcomer not told the name is free")
	}
	if row := participantRow(t, st, info.SittingID, p.ID); row.State != "kicked" {
		t.Errorf("holder state = %q, want kicked", row.State)
	}
	if got := e.DeviceStatus(devA); got != "kicked" {
		t.Errorf("holder device status = %q, want kicked", got)
	}
	if _, err := e.TestFor(devA); !errors.Is(err, ErrNotJoined) {
		t.Errorf("kicked device: err = %v, want ErrNotJoined", err)
	}
	fresh := pick(t, e, info.Code, devB, wire.PickRequest{StudentID: participantRow(t, st, info.SittingID, p.ID).StudentID.String})
	if fresh.ID == p.ID {
		t.Error("newcomer reused the kicked participant")
	}

	// devA asks for the name back and the teacher turns it away.
	if _, err := e.Pick(info.Code, devA, wire.PickRequest{StudentID: participantRow(t, st, info.SittingID, p.ID).StudentID.String}); err == nil {
		t.Fatal("clash expected")
	}
	evs := openClashes(t, st, info.SittingID)
	if len(evs) != 1 {
		t.Fatalf("%d clashes, want 1", len(evs))
	}
	if err := e.ResolveEvent(evs[0].ID, "kick_new"); err != nil {
		t.Fatal(err)
	}
	if row := participantRow(t, st, info.SittingID, fresh.ID); row.State != "writing" || row.DeviceToken != devB {
		t.Errorf("holder after kick_new = %+v", row)
	}
	if got := e.DeviceStatus(devA); got != "kicked" {
		t.Errorf("newcomer device status = %q, want kicked", got)
	}
	if got := e.DeviceStatus(devB); got != "writing" {
		t.Errorf("holder device status = %q, want writing", got)
	}
}

func TestKickOrMoveResolvesClash(t *testing.T) {
	for _, action := range []string{"kick", "move"} {
		e, st, hub, info, p, eventID := startClash(t)
		newCh, unsub := hub.Subscribe("device:" + devB)
		join(t, e, info.Code, devC, "10.0.0.109")
		var err error
		if action == "kick" {
			err = e.Kick(p.ID)
		} else {
			err = e.Move(p.ID, devC)
		}
		unsub()
		if err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		if len(openClashes(t, st, info.SittingID)) != 0 {
			t.Errorf("%s left the clash open", action)
		}
		if !received(newCh) {
			t.Errorf("%s: newcomer not notified", action)
		}
		if err := e.ResolveEvent(eventID, "kick_new"); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: resolving the clash: err = %v, want ErrNotFound", action, err)
		}
	}
}

func TestKickAndMoveErrors(t *testing.T) {
	e, st, _ := setup(t)
	if err := e.Kick("nobody"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Kick without a sitting: err = %v, want ErrNotFound", err)
	}
	info := start(t, e, addClass(t, st, "Петренко Тарас", "Іваненко Олена"))
	names := join(t, e, info.Code, devA, "10.0.0.107").Names
	join(t, e, info.Code, devB, "10.0.0.108")
	pa := pick(t, e, info.Code, devA, wire.PickRequest{StudentID: names[0].StudentID})
	pb := pick(t, e, info.Code, devB, wire.PickRequest{StudentID: names[1].StudentID})

	if err := e.Kick("nobody"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Kick unknown participant: err = %v, want ErrNotFound", err)
	}
	if err := e.Move("nobody", devB); !errors.Is(err, ErrNotFound) {
		t.Errorf("Move unknown participant: err = %v, want ErrNotFound", err)
	}
	if err := e.Move(pa.ID, devC); !errors.Is(err, ErrNotFound) {
		t.Errorf("Move to unknown device: err = %v, want ErrNotFound", err)
	}
	if err := e.Move(pa.ID, devB); !errors.Is(err, ErrInvalid) {
		t.Errorf("Move onto a writing device: err = %v, want ErrInvalid", err)
	}
	if err := e.Kick(pb.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.Kick(pb.ID); err != nil {
		t.Errorf("Kick twice: %v", err)
	}
	if err := e.Move(pb.ID, devB); !errors.Is(err, ErrInvalid) {
		t.Errorf("Move a kicked participant: err = %v, want ErrInvalid", err)
	}
	if row := participantRow(t, st, info.SittingID, pa.ID); row.DeviceToken != devA {
		t.Errorf("failed moves changed the participant: %+v", row)
	}
}

func TestPickNotifiesTeacherDebounced(t *testing.T) {
	e, _, hub := setup(t)
	ch, unsub := hub.Subscribe("teacher")
	defer unsub()
	code := start(t, e, nil).Code
	join(t, e, code, devA, "10.0.0.1")
	join(t, e, code, devB, "10.0.0.2")
	time.Sleep(2 * liveDebounce)
	if !received(ch) {
		t.Fatal("Start published no live event")
	}

	pick(t, e, code, devA, wire.PickRequest{Surname: "Учень", FirstName: "Один"})
	pick(t, e, code, devB, wire.PickRequest{Surname: "Учень", FirstName: "Два"})
	if received(ch) {
		t.Fatal("live event published before the debounce interval")
	}
	time.Sleep(2 * liveDebounce)
	if !received(ch) {
		t.Fatal("no live event after the debounce interval")
	}
	if received(ch) {
		t.Error("burst of changes produced more than one live event")
	}
}

func TestRestartResumesSitting(t *testing.T) {
	_, st, hub, info, p, eventID := startClash(t)

	e2 := newEngine(t, st, hub)
	if _, err := e2.TestFor(devA); err != nil {
		t.Fatalf("TestFor after restart: %v", err)
	}
	if _, err := e2.Start("t1", nil); !errors.Is(err, ErrSittingActive) {
		t.Errorf("Start after restart: err = %v, want ErrSittingActive", err)
	}
	names := join(t, e2, info.Code, devB, "10.0.0.108").Names
	if len(names) != 1 || !names[0].Taken {
		t.Errorf("names after restart = %+v", names)
	}
	if again := pick(t, e2, info.Code, devA, wire.PickRequest{StudentID: names[0].StudentID}); again.ID != p.ID {
		t.Errorf("pick after restart = %+v, want participant %s", again, p.ID)
	}
	if err := e2.ResolveEvent(eventID, "kick_new"); err != nil {
		t.Errorf("resolve after restart: %v", err)
	}
}

func TestRestartRebuildsDeviceStatus(t *testing.T) {
	e, st, hub := setup(t)
	info := start(t, e, addClass(t, st, "Петренко Тарас", "Іваненко Олена", "Бойко Марія"))
	names := join(t, e, info.Code, devA, "10.0.0.107").Names
	join(t, e, info.Code, devB, "10.0.0.108")
	join(t, e, info.Code, devC, "10.0.0.109")
	pa := pick(t, e, info.Code, devA, wire.PickRequest{StudentID: names[0].StudentID})
	pb := pick(t, e, info.Code, devB, wire.PickRequest{StudentID: names[1].StudentID})
	if err := e.Kick(pa.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.Move(pb.ID, devC); err != nil {
		t.Fatal(err)
	}

	e2 := newEngine(t, st, hub)
	for device, want := range map[string]string{devA: "kicked", devB: "moved", devC: "writing", "unknown": "unjoined"} {
		if got := e2.DeviceStatus(device); got != want {
			t.Errorf("status of %s after restart = %q, want %q", device, got, want)
		}
	}
	if !slices.Equal(e2.cur.movedFrom[devB], []string{pb.ID}) {
		t.Errorf("moved from devB = %v, want [%s]", e2.cur.movedFrom[devB], pb.ID)
	}

	// Picking clears a kicked or moved status.
	pick(t, e2, info.Code, devA, wire.PickRequest{StudentID: names[0].StudentID})
	pick(t, e2, info.Code, devB, wire.PickRequest{StudentID: names[2].StudentID})
	if a, b := e2.DeviceStatus(devA), e2.DeviceStatus(devB); a != "writing" || b != "writing" {
		t.Errorf("statuses after picking = %q, %q, want writing", a, b)
	}
}

func TestRestartReportsUnreadableSitting(t *testing.T) {
	st := openStore(t)
	ctx := context.Background()
	if err := st.Q().InsertAssignment(ctx, db.InsertAssignmentParams{ID: "a1", TestSnapshot: "[]"}); err != nil {
		t.Fatal(err)
	}
	if err := st.Q().InsertSitting(ctx, db.InsertSittingParams{ID: "s1", AssignmentID: "a1", JoinCode: "1234"}); err != nil {
		t.Fatal(err)
	}
	if e, err := New(st, events.New(), clock); err == nil || e != nil {
		t.Fatalf("New = %v, %v; want an error", e, err)
	}
}
