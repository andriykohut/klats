package sitting

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"

	"klats/internal/events"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

// fakeClock is a clock the test moves by hand.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func newClock() *fakeClock { return &fakeClock{t: clock()} }

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) add(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// setupAt is setup with the engine reading the time from clk.
func setupAt(t *testing.T, clk *fakeClock) (*Engine, *store.Store, *events.Hub) {
	t.Helper()
	_, st, hub := setup(t)
	e, err := New(st, hub, clk.now)
	if err != nil {
		t.Fatal(err)
	}
	return e, st, hub
}

// insertTest stores the test id with n single-choice questions q1…qn of one
// point each, whose correct option is o0.
func insertTest(t *testing.T, st *store.Store, id string, n int) {
	t.Helper()
	var qs []testfmt.Question
	for i := range n {
		qs = append(qs, testfmt.Question{ID: "q" + strconv.Itoa(i+1), Type: "single", Text: rich("Питання"), Points: 1, Options: []testfmt.Option{
			{ID: "o0", Content: rich("так"), Correct: true},
			{ID: "o1", Content: rich("ні")},
		}})
	}
	doc, err := json.Marshal(testfmt.Test{ID: id, Version: 1, Title: "Тест", Palette: "teal", Questions: qs})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Q().InsertTest(context.Background(), db.InsertTestParams{ID: id, Title: "Тест", Doc: string(doc)}); err != nil {
		t.Fatal(err)
	}
}

// enter joins the device to the running typed-name sitting as «<surname> Учень».
func enter(t *testing.T, e *Engine, code, device, surname string) wire.Participant {
	t.Helper()
	join(t, e, code, device, "10.0.0.1")
	return pick(t, e, code, device, wire.PickRequest{Surname: surname, FirstName: "Учень"})
}

// change returns p's change of the answer to question, with a fresh change id.
func change(p wire.Participant, question string, seq int64, options ...string) wire.AnswerChange {
	return wire.AnswerChange{ChangeID: store.NewID(), ParticipantID: p.ID, QuestionID: question, OptionIDs: options, Seq: seq}
}

func submit(t *testing.T, e *Engine, device string, changes ...wire.AnswerChange) wire.SubmitResult {
	t.Helper()
	res, err := e.Submit(device, changes)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func heartbeat(t *testing.T, e *Engine, device string) wire.Status {
	t.Helper()
	s, err := e.Heartbeat(device)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func finish(t *testing.T, e *Engine, device string) wire.FinishResult {
	t.Helper()
	r, err := e.Finish(device)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// stored returns the participant's stored answer to the question, or a zero
// Answer if none is stored.
func stored(t *testing.T, st *store.Store, sittingID, participantID, question string) db.Answer {
	t.Helper()
	answers, err := st.Q().ListAnswers(context.Background(), sittingID)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range answers {
		if a.ParticipantID == participantID && a.QuestionID == question {
			return a
		}
	}
	return db.Answer{}
}

// eventParams returns the params of the sitting's events of the kind, oldest
// first, among its 20 newest events.
func eventParams(t *testing.T, st *store.Store, sittingID, kind string) []map[string]string {
	t.Helper()
	evs, err := st.Q().ListRecentEvents(context.Background(), sittingID)
	if err != nil {
		t.Fatal(err)
	}
	var out []map[string]string
	for _, ev := range slices.Backward(evs) {
		if ev.Kind != kind {
			continue
		}
		var p map[string]string
		if err := json.Unmarshal([]byte(ev.Params), &p); err != nil {
			t.Fatal(err)
		}
		out = append(out, p)
	}
	return out
}

func TestSubmitKeepsHighestSeq(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")

	submit(t, e, devA, change(p, "q1", 3, "o1"))
	res := submit(t, e, devA, change(p, "q1", 2, "o0"), change(p, "q2", 2, "o0", "o1"), change(p, "q2", 1, "o2"))
	if len(res.Acks) != 3 || res.Rejected != 0 {
		t.Errorf("result = %+v, want 3 acks and none rejected", res)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 3 || a.OptionIds != `["o1"]` {
		t.Errorf("q1 = %+v, want seq 3's options", a)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q2"); a.Seq != 2 || a.OptionIds != `["o0","o1"]` {
		t.Errorf("q2 = %+v, want seq 2's options", a)
	}
	if res.Status.State != "writing" || res.Status.Result != nil || res.Status.RemainingMs != nil {
		t.Errorf("status = %+v", res.Status)
	}
}

func TestSubmitDuplicateChangeIDAckedOnce(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")

	c := change(p, "q1", 1, "o0")
	submit(t, e, devA, c)
	again := c
	again.Seq, again.OptionIDs = 2, []string{"o1"}
	res := submit(t, e, devA, again, again)
	if !slices.Equal(res.Acks, []string{c.ChangeID, c.ChangeID}) || res.Rejected != 0 {
		t.Errorf("result = %+v, want both repeats acked", res)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 1 || a.OptionIds != `["o0"]` || a.ChangeID != c.ChangeID {
		t.Errorf("q1 = %+v, want the first delivery only", a)
	}
}

func TestSubmitRejectsInvalidChanges(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	other := enter(t, e, info.Code, devB, "Франко")

	bad := []wire.AnswerChange{
		change(p, "q9", 1, "o0"),                                 // unknown question
		change(p, "q1", 1, "o5"),                                 // an option of q2
		change(p, "q1", 0, "o0"),                                 // seq below 1
		change(p, "q2", 1, slices.Repeat([]string{"o0"}, 21)...), // too many option ids
		{ParticipantID: p.ID, QuestionID: "q1", OptionIDs: []string{"o0"}, Seq: 1}, // no change id
		change(wire.Participant{ID: "nobody"}, "q1", 1, "o0"),                      // unknown participant
		change(other, "q1", 1, "o0"),                                               // another device's participant
	}
	res := submit(t, e, devA, bad...)
	if len(res.Acks) != len(bad) || res.Rejected != len(bad) {
		t.Errorf("result = %+v, want all %d acked and rejected", res, len(bad))
	}
	if answers, err := st.Q().ListAnswers(context.Background(), info.SittingID); err != nil || len(answers) != 0 {
		t.Errorf("stored %+v (err %v), want nothing", answers, err)
	}

	submit(t, e, devA, change(p, "q2", 1, "o0", "o0", "o1"))
	if a := stored(t, st, info.SittingID, p.ID, "q2"); a.OptionIds != `["o0","o1"]` {
		t.Errorf("q2 = %s, want repeats stored once", a.OptionIds)
	}
	if _, err := e.Submit(devA, make([]wire.AnswerChange, 201)); !errors.Is(err, ErrInvalid) {
		t.Errorf("201 changes: err = %v, want ErrInvalid", err)
	}
}

func TestLateFlagUsesServerClock(t *testing.T) {
	// A change carries nothing a device clock could set.
	typ := reflect.TypeFor[wire.AnswerChange]()
	var fields []string
	for i := range typ.NumField() {
		fields = append(fields, typ.Field(i).Name)
	}
	if want := []string{"ChangeID", "ParticipantID", "QuestionID", "OptionIDs", "Seq"}; !slices.Equal(fields, want) {
		t.Fatalf("AnswerChange fields = %v, want %v", fields, want)
	}

	clk := newClock()
	e, st, _ := setupAt(t, clk)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	t0 := clk.now().UnixMilli()

	submit(t, e, devA, change(p, "q1", 2, "o0"))
	submit(t, e, devA, change(p, "q1", 1, "o1")) // an older edit arriving second
	clk.add(time.Minute)
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	clk.add(time.Minute)
	submit(t, e, devA, change(p, "q1", 1, "o1")) // an older edit arriving after the end
	submit(t, e, devA, change(p, "q2", 1, "o0"))

	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 2 || a.Late != 0 || a.ReceivedAt != t0 {
		t.Errorf("q1 = %+v, want seq 2, on time, received at %d", a, t0)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q2"); a.Late != 1 || a.ReceivedAt != clk.now().UnixMilli() {
		t.Errorf("q2 = %+v, want late, received at the server's time", a)
	}
	submit(t, e, devA, change(p, "q1", 3, "o1"))
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 3 || a.Late != 1 {
		t.Errorf("q1 = %+v, want seq 3, late", a)
	}
}

func TestKickedDeviceRejected(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	if err := e.Kick(p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Submit(devA, []wire.AnswerChange{change(p, "q1", 1, "o0")}); !errors.Is(err, ErrKicked) {
		t.Errorf("Submit: err = %v, want ErrKicked", err)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.ChangeID != "" {
		t.Errorf("stored %+v from a kicked device", a)
	}
	if _, err := e.Finish(devA); !errors.Is(err, ErrKicked) {
		t.Errorf("Finish: err = %v, want ErrKicked", err)
	}
	if s := heartbeat(t, e, devA); s.State != "kicked" {
		t.Errorf("state = %q, want kicked", s.State)
	}
	if s := heartbeat(t, e, devC); s.State != "unjoined" {
		t.Errorf("unknown device: state = %q, want unjoined", s.State)
	}
	// Picking again makes a fresh participant; the kicked one stays shut.
	fresh := pick(t, e, info.Code, devA, wire.PickRequest{Surname: "Шевченко", FirstName: "Учень"})
	if res := submit(t, e, devA, change(p, "q1", 1, "o0"), change(fresh, "q1", 1, "o0")); res.Rejected != 1 {
		t.Errorf("result = %+v, want the kicked participant's change rejected", res)
	}
}

func TestMovedDeviceStillDelivers(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	join(t, e, info.Code, devB, "10.0.0.2")
	join(t, e, info.Code, devC, "10.0.0.3")
	if err := e.Move(p.ID, devB); err != nil {
		t.Fatal(err)
	}

	res := submit(t, e, devA, change(p, "q1", 1, "o0"))
	if res.Rejected != 0 || res.Status.State != "moved" || stored(t, st, info.SittingID, p.ID, "q1").Seq != 1 {
		t.Errorf("late delivery from the old device: %+v", res)
	}
	// The old device picks another name and still delivers for p.
	q := pick(t, e, info.Code, devA, wire.PickRequest{Surname: "Франко", FirstName: "Іван"})
	if res := submit(t, e, devA, change(p, "q2", 1, "o0"), change(q, "q1", 1, "o1")); res.Rejected != 0 {
		t.Errorf("after a re-pick: %+v", res)
	}
	if stored(t, st, info.SittingID, p.ID, "q2").Seq != 1 || stored(t, st, info.SittingID, q.ID, "q1").Seq != 1 {
		t.Error("changes for the moved and the new participant were not both stored")
	}
	if res := submit(t, e, devC, change(p, "q1", 2, "o1")); res.Rejected != 1 {
		t.Errorf("a device p was never on: %+v, want rejected", res)
	}
	if res := submit(t, e, devB, change(p, "q1", 2, "o1")); res.Rejected != 0 || stored(t, st, info.SittingID, p.ID, "q1").Seq != 2 {
		t.Errorf("the new device: %+v", res)
	}
}

func TestFinishGrades(t *testing.T) {
	e, st, hub := setup(t)
	insertTest(t, st, "t9", 9)
	info, err := e.Start("t9", nil)
	if err != nil {
		t.Fatal(err)
	}
	p := enter(t, e, info.Code, devA, "Шевченко")
	var cs []wire.AnswerChange
	for i := range 9 {
		cs = append(cs, change(p, "q"+strconv.Itoa(i+1), 1, map[bool]string{true: "o1", false: "o0"}[i == 8]))
	}
	submit(t, e, devA, cs...)

	ch, unsub := hub.Subscribe("device:" + devA)
	defer unsub()
	want := wire.FinishResult{Grade: 10, Correct: 8, Total: 9}
	if got := finish(t, e, devA); got != want {
		t.Fatalf("Finish = %+v, want %+v", got, want)
	}
	if !received(ch) {
		t.Error("device not told its status changed")
	}
	if row := participantRow(t, st, info.SittingID, p.ID); row.State != "finished" || row.FinishedBy.String != "student" || row.FinishedAt.Int64 != clock().UnixMilli() {
		t.Errorf("participant = %+v", row)
	}
	if evs := eventParams(t, st, info.SittingID, "finished"); len(evs) != 1 || evs[0]["name"] != "Шевченко Учень" || evs[0]["grade"] != "10" {
		t.Errorf("finished events = %v", evs)
	}

	// The student's own finish locks the answers.
	if res := submit(t, e, devA, change(p, "q9", 2, "o0")); len(res.Acks) != 1 || res.Rejected != 0 || stored(t, st, info.SittingID, p.ID, "q9").Seq != 1 {
		t.Errorf("change after finishing: %+v, want acked and ignored", res)
	}
	if got := finish(t, e, devA); got != want {
		t.Errorf("second Finish = %+v", got)
	}
	if s := heartbeat(t, e, devA); s.State != "finished" || s.Result == nil || *s.Result != want {
		t.Errorf("status = %+v", s)
	}
	if evs := eventParams(t, st, info.SittingID, "finished"); len(evs) != 1 {
		t.Errorf("%d finished events, want 1", len(evs))
	}
}

func TestEndThenLateAnswersRegrade(t *testing.T) {
	clk := newClock()
	e, st, hub := setupAt(t, clk)
	info := start(t, e, nil)
	pa := enter(t, e, info.Code, devA, "Шевченко") // goes offline before the end
	pb := enter(t, e, info.Code, devB, "Франко")   // finishes on her own
	submit(t, e, devA, change(pa, "q1", 1, "o1"))
	submit(t, e, devB, change(pb, "q1", 1, "o0"))
	finish(t, e, devB)

	ch, unsub := hub.Subscribe("device:" + devA)
	defer unsub()
	clk.add(time.Minute)
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	if !received(ch) {
		t.Error("device not told the sitting ended")
	}
	if row := participantRow(t, st, info.SittingID, pa.ID); row.State != "finished" || row.FinishedBy.String != "end" || row.FinishedAt.Int64 != clk.now().UnixMilli() {
		t.Errorf("participant writing at the end = %+v", row)
	}
	grade := func() int {
		t.Helper()
		r, err := e.Results(info.AssignmentID)
		if err != nil {
			t.Fatal(err)
		}
		i := slices.IndexFunc(r.Rows, func(r wire.ResultRow) bool { return r.ParticipantID == pa.ID })
		return r.Rows[i].Grade
	}
	if g := grade(); g != 1 {
		t.Errorf("grade at the end = %d, want 1", g)
	}
	if s := heartbeat(t, e, devA); s.State != "ended" || s.Result == nil || *s.Result != (wire.FinishResult{Grade: 1, Correct: 0, Total: 2}) {
		t.Errorf("status after the end = %+v", s)
	}

	// devA comes back online with the fix it made offline.
	res := submit(t, e, devA, change(pa, "q1", 2, "o0"), change(pa, "q2", 1, "o0"))
	if res.Rejected != 0 || res.Status.State != "ended" || res.Status.Result == nil || *res.Status.Result != (wire.FinishResult{Grade: 12, Correct: 2, Total: 2}) {
		t.Errorf("late submit = %+v", res)
	}
	if a := stored(t, st, info.SittingID, pa.ID, "q1"); a.Seq != 2 || a.Late != 1 {
		t.Errorf("q1 = %+v, want seq 2, late", a)
	}
	if g := grade(); g != 12 {
		t.Errorf("regraded = %d, want 12", g)
	}
	if evs := eventParams(t, st, info.SittingID, "late_answers"); len(evs) != 1 || evs[0]["name"] != "Шевченко Учень" || evs[0]["count"] != "2" {
		t.Errorf("late_answers events = %v", evs)
	}
	if assignment(t, st, info.AssignmentID).ExportStale != 1 {
		t.Error("export not marked stale")
	}
	// A student who finished on her own stays locked.
	submit(t, e, devB, change(pb, "q2", 1, "o0"))
	if a := stored(t, st, info.SittingID, pb.ID, "q2"); a.ChangeID != "" {
		t.Errorf("stored %+v after the student's own finish", a)
	}

	// Late answers still land after the next sitting has started.
	start(t, e, nil)
	if res := submit(t, e, devA, change(pa, "q1", 3, "o1")); res.Rejected != 0 {
		t.Errorf("late submit during the next sitting = %+v", res)
	}
	if g := grade(); g != 7 {
		t.Errorf("regraded = %d, want 7", g)
	}
}

func TestOfflineOnlineEvents(t *testing.T) {
	clk := newClock()
	e, st, _ := setupAt(t, clk)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	enter(t, e, info.Code, devB, "Франко")
	join(t, e, info.Code, devC, "10.0.0.3")
	silent := func(kind string) []map[string]string {
		t.Helper()
		var out []map[string]string
		for _, ev := range eventParams(t, st, info.SittingID, kind) {
			if ev["name"] == p.Name {
				out = append(out, ev)
			}
		}
		return out
	}

	clk.add(10 * time.Second)
	heartbeat(t, e, devB)
	clk.add(6 * time.Second)
	e.Tick()
	e.Tick()
	if got := silent("offline"); len(got) != 1 {
		t.Fatalf("offline events = %v, want one", got)
	}
	if got := eventParams(t, st, info.SittingID, "offline"); len(got) != 1 {
		t.Errorf("offline events = %v, want only the silent device's", got)
	}
	live := liveOf(t, e)
	if live.Counts.Offline != 1 || live.Rows[1].Status != "offline" || live.Rows[0].Status != "writing" {
		t.Errorf("live = %+v", live)
	}

	submit(t, e, devA, change(p, "q1", 1, "o0"), change(p, "q2", 1, "o0"))
	if got := silent("online"); len(got) != 1 || got[0]["synced"] != "2" {
		t.Errorf("online events = %v, want one with synced 2", got)
	}
	if live := liveOf(t, e); live.Counts.Offline != 0 {
		t.Errorf("offline = %d after coming back", live.Counts.Offline)
	}

	// Changes the old device delivers while p is offline count when p is back.
	clk.add(time.Minute)
	e.Tick()
	if err := e.Move(p.ID, devC); err != nil {
		t.Fatal(err)
	}
	submit(t, e, devA, change(p, "q1", 2, "o1"))
	heartbeat(t, e, devC)
	if got := silent("online"); len(got) != 2 || got[1]["synced"] != "1" {
		t.Errorf("online events = %v, want a second one with synced 1", got)
	}
}

func TestEditTestDuringSittingUsesSnapshot(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	before, err := e.TestFor(devA)
	if err != nil {
		t.Fatal(err)
	}

	// The teacher makes o1 the correct option of q1 and retitles the test.
	row, err := st.Q().GetTest(context.Background(), "t1")
	if err != nil {
		t.Fatal(err)
	}
	var doc testfmt.Test
	if err := json.Unmarshal([]byte(row.Doc), &doc); err != nil {
		t.Fatal(err)
	}
	doc.Title, doc.Questions[0].Options[0].Correct, doc.Questions[0].Options[1].Correct = "Дроби 2", false, true
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Q().UpdateTest(context.Background(), db.UpdateTestParams{Title: doc.Title, Doc: string(b), ID: "t1"}); err != nil {
		t.Fatal(err)
	}

	after, err := e.TestFor(devA)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Errorf("TestFor changed with the edit:\n%+v\n%+v", before, after)
	}
	submit(t, e, devA, change(p, "q1", 1, "o0"), change(p, "q2", 1, "o0"))
	if got := finish(t, e, devA); got != (wire.FinishResult{Grade: 12, Correct: 2, Total: 2}) {
		t.Errorf("Finish = %+v, want graded against the snapshot", got)
	}
	r, err := e.Results(info.AssignmentID)
	if err != nil {
		t.Fatal(err)
	}
	if r.TestTitle != "Дроби" || r.Rows[0].Grade != 12 {
		t.Errorf("results = %+v", r)
	}
}

func TestRestartKeepsAnswers(t *testing.T) {
	e, st, hub := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	submit(t, e, devA, change(p, "q1", 2, "o0"), change(p, "q2", 1, "o0", "o1"))

	e2 := newEngine(t, st, hub)
	r, err := e2.Results(info.AssignmentID)
	if err != nil {
		t.Fatal(err)
	}
	if want := map[string][]string{"q1": {"o0"}, "q2": {"o0", "o1"}}; len(r.Rows) != 1 || !reflect.DeepEqual(r.Rows[0].Answers, want) {
		t.Errorf("results after restart = %+v, want answers %v", r.Rows, want)
	}
	if live := liveOf(t, e2); len(live.Rows) != 1 || !slices.Equal(live.Rows[0].Cells, []string{"correct", "wrong"}) {
		t.Errorf("live after restart = %+v", live.Rows)
	}
	submit(t, e2, devA, change(p, "q1", 1, "o1"))
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 2 {
		t.Errorf("q1 = %+v, want the stored seq 2 kept", a)
	}
}
