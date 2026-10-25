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
	return wire.AnswerChange{ChangeID: store.NewID(), ParticipantID: p.ID, QuestionID: question, Answer: testfmt.Answer{Items: options}, Seq: seq}
}

// submit sends the changes as a device that holds no others.
func submit(t *testing.T, e *Engine, device string, changes ...wire.AnswerChange) wire.SubmitResult {
	t.Helper()
	return submitPending(t, e, device, 0, changes...)
}

func submitPending(t *testing.T, e *Engine, device string, pending int, changes ...wire.AnswerChange) wire.SubmitResult {
	t.Helper()
	res, err := e.Submit(device, changes, pending)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// heartbeat beats as a device holding pending unacked changes.
func heartbeat(t *testing.T, e *Engine, device string, pending int) wire.Status {
	t.Helper()
	s, err := e.Heartbeat(device, pending)
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
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 3 || a.Value != `{"items":["o1"]}` {
		t.Errorf("q1 = %+v, want seq 3's options", a)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q2"); a.Seq != 2 || a.Value != `{"items":["o0","o1"]}` {
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
	again.Seq, again.Answer = 2, testfmt.Answer{Items: []string{"o1"}}
	res := submit(t, e, devA, again, again)
	if !slices.Equal(res.Acks, []string{c.ChangeID, c.ChangeID}) || res.Rejected != 0 {
		t.Errorf("result = %+v, want both repeats acked", res)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 1 || a.Value != `{"items":["o0"]}` || a.ChangeID != c.ChangeID {
		t.Errorf("q1 = %+v, want the first delivery only", a)
	}
}

func TestSubmitRejectsInvalidChanges(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	other := enter(t, e, info.Code, devB, "Франко")

	bad := []wire.AnswerChange{
		change(p, "q9", 1, "o0"), // unknown question
		change(p, "q1", 1, "o5"), // an option of q2
		change(p, "q1", 0, "o0"), // seq below 1
		{ParticipantID: p.ID, QuestionID: "q1", Answer: testfmt.Answer{Items: []string{"o0"}}, Seq: 1}, // no change id
		change(wire.Participant{ID: "nobody"}, "q1", 1, "o0"),                                          // unknown participant
		change(other, "q1", 1, "o0"),                                                                   // another device's participant
	}
	res := submit(t, e, devA, bad...)
	if len(res.Acks) != len(bad) || res.Rejected != len(bad) {
		t.Errorf("result = %+v, want all %d acked and rejected", res, len(bad))
	}
	if answers, err := st.Q().ListAnswers(context.Background(), info.SittingID); err != nil || len(answers) != 0 {
		t.Errorf("stored %+v (err %v), want nothing", answers, err)
	}

	submit(t, e, devA, change(p, "q2", 1, "o0", "o0", "o1"))
	if a := stored(t, st, info.SittingID, p.ID, "q2"); a.Value != `{"items":["o0","o1"]}` {
		t.Errorf("q2 = %s, want repeats stored once", a.Value)
	}
	if _, err := e.Submit(devA, make([]wire.AnswerChange, 201), 0); !errors.Is(err, ErrInvalid) {
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
	if want := []string{"ChangeID", "ParticipantID", "QuestionID", "Answer", "Seq"}; !slices.Equal(fields, want) {
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
	// The device still holds changes, so it stays open for late ones.
	submitPending(t, e, devA, 2, change(p, "q1", 1, "o1")) // an older edit arriving after the end
	submitPending(t, e, devA, 1, change(p, "q2", 1, "o0"))

	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 2 || a.Late != 0 || a.ReceivedAt != t0 {
		t.Errorf("q1 = %+v, want seq 2, on time, received at %d", a, t0)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q2"); a.Late != 1 || a.ReceivedAt != clk.now().UnixMilli() {
		t.Errorf("q2 = %+v, want late, received at the server's time", a)
	}
	submitPending(t, e, devA, 1, change(p, "q1", 3, "o1"))
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
	if _, err := e.Submit(devA, []wire.AnswerChange{change(p, "q1", 1, "o0")}, 0); !errors.Is(err, ErrKicked) {
		t.Errorf("Submit: err = %v, want ErrKicked", err)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.ChangeID != "" {
		t.Errorf("stored %+v from a kicked device", a)
	}
	if _, err := e.Finish(devA); !errors.Is(err, ErrKicked) {
		t.Errorf("Finish: err = %v, want ErrKicked", err)
	}
	if s := heartbeat(t, e, devA, 0); s.State != "kicked" {
		t.Errorf("state = %q, want kicked", s.State)
	}
	if s := heartbeat(t, e, devC, 0); s.State != "unjoined" {
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
	if s := heartbeat(t, e, devA, 0); s.State != "finished" || s.Result == nil || *s.Result != want {
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
	pc := enter(t, e, info.Code, devC, "Бойко")    // stays offline until the next sitting
	submit(t, e, devA, change(pa, "q1", 1, "o1"))
	submit(t, e, devB, change(pb, "q1", 1, "o0"))
	submit(t, e, devC, change(pc, "q1", 1, "o1"))
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
	row := func(p wire.Participant) wire.ResultRow {
		t.Helper()
		r := resultsOf(t, e, info.AssignmentID)
		return r.Rows[slices.IndexFunc(r.Rows, func(r wire.ResultRow) bool { return r.ParticipantID == p.ID })]
	}
	if g := row(pa).Grade; g != 1 {
		t.Errorf("grade at the end = %d, want 1", g)
	}

	// devA comes back online with the fix it made offline.
	res := submitPending(t, e, devA, 0, change(pa, "q1", 2, "o0"), change(pa, "q2", 1, "o0"))
	if res.Rejected != 0 || res.Status.State != "ended" || res.Status.Result == nil || *res.Status.Result != (wire.FinishResult{Grade: 12, Correct: 2, Total: 2}) {
		t.Errorf("late submit = %+v", res)
	}
	if a := stored(t, st, info.SittingID, pa.ID, "q1"); a.Seq != 2 || a.Late != 1 {
		t.Errorf("q1 = %+v, want seq 2, late", a)
	}
	if r := row(pa); r.Grade != 12 || !slices.Equal(r.Late, []string{"q1", "q2"}) {
		t.Errorf("regraded row = %+v, want grade 12, both answers late", r)
	}
	if r := row(pb); len(r.Late) != 0 {
		t.Errorf("on-time row late = %v", r.Late)
	}
	if evs := eventParams(t, st, info.SittingID, "late_answers"); len(evs) != 1 || evs[0]["name"] != "Шевченко Учень" || evs[0]["count"] != "2" {
		t.Errorf("late_answers events = %v", evs)
	}
	if assignment(t, st, info.AssignmentID).ExportStale != 1 {
		t.Error("export not marked stale")
	}
	// The teacher still sees the ended sitting, late answers included.
	l := liveOf(t, e)
	if !l.Sitting.Ended || l.Sitting.SittingID != info.SittingID || len(l.Rows) != 3 || l.Events[0].Kind != "late_answers" {
		t.Fatalf("live after the end = %+v", l)
	}
	if i := slices.IndexFunc(l.Rows, func(r wire.LiveRow) bool { return r.ParticipantID == pa.ID }); !slices.Equal(l.Rows[i].Cells, []string{"correct", "correct"}) {
		t.Errorf("late cells = %v", l.Rows[i].Cells)
	}
	// A student who finished on her own stays locked.
	submit(t, e, devB, change(pb, "q2", 1, "o0"))
	if a := stored(t, st, info.SittingID, pb.ID, "q2"); a.ChangeID != "" {
		t.Errorf("stored %+v after the student's own finish", a)
	}

	// Late answers still land after the next sitting has started.
	start(t, e, nil)
	if res := submit(t, e, devC, change(pc, "q1", 2, "o0")); res.Rejected != 0 || res.Status.State != "unjoined" {
		t.Errorf("late submit during the next sitting = %+v", res)
	}
	if r := row(pc); r.Grade != 4 || !slices.Equal(r.Late, []string{"q1"}) {
		t.Errorf("regraded row = %+v, want grade 4", r)
	}
}

func TestResultWithheldUntilSynced(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	q := enter(t, e, info.Code, devB, "Франко")
	submit(t, e, devA, change(p, "q1", 1, "o1"))
	if err := e.End(); err != nil {
		t.Fatal(err)
	}

	if s := heartbeat(t, e, devA, 2); s.State != "ended" || s.Result != nil {
		t.Errorf("status with changes pending = %+v, want no result", s)
	}
	if res := submitPending(t, e, devA, 1, change(p, "q1", 2, "o0")); res.Status.Result != nil {
		t.Errorf("status with one change pending = %+v, want no result", res.Status)
	}
	if by := participantRow(t, st, info.SittingID, p.ID).FinishedBy.String; by != "end" {
		t.Errorf("finished by %q before syncing, want end", by)
	}
	want := wire.FinishResult{Grade: 12, Correct: 2, Total: 2}
	if res := submitPending(t, e, devA, 0, change(p, "q2", 1, "o0")); res.Status.Result == nil || *res.Status.Result != want {
		t.Errorf("status once synced = %+v, want %+v", res.Status, want)
	}
	if by := participantRow(t, st, info.SittingID, p.ID).FinishedBy.String; by != "end_synced" {
		t.Errorf("finished by %q once synced, want end_synced", by)
	}
	// Locked: a further change is acked and ignored, and the grade stays.
	res := submit(t, e, devA, change(p, "q1", 3, "o1"))
	if len(res.Acks) != 1 || res.Rejected != 0 || res.Status.Result == nil || *res.Status.Result != want || stored(t, st, info.SittingID, p.ID, "q1").Seq != 2 {
		t.Errorf("change after the lock = %+v", res)
	}

	// Finishing after the end locks at once.
	if got := finish(t, e, devB); got != (wire.FinishResult{Grade: 1, Correct: 0, Total: 2}) {
		t.Errorf("Finish after the end = %+v", got)
	}
	submitPending(t, e, devB, 3, change(q, "q1", 1, "o0"))
	if s := heartbeat(t, e, devB, 3); s.Result == nil || s.Result.Grade != 1 || stored(t, st, info.SittingID, q.ID, "q1").ChangeID != "" {
		t.Errorf("after finishing post-end: status %+v; the change must be ignored", s)
	}
}

func TestEndedStatusIsTheDevicesOwn(t *testing.T) {
	e, st, hub := setup(t)
	s1 := start(t, e, nil)
	enter(t, e, s1.Code, devA, "Шевченко")
	finish(t, e, devA)
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	if s := heartbeat(t, e, devA, 0); s.State != "ended" || s.Result == nil {
		t.Errorf("own result = %+v", s)
	}

	// The next lesson: the same lab PC joins, but nobody has picked yet.
	s2 := start(t, e, nil)
	join(t, e, s2.Code, devA, "10.0.0.1")
	if s := heartbeat(t, e, devA, 0); s.State != "unjoined" || s.Result != nil {
		t.Errorf("joined, not picked = %+v, want unjoined", s)
	}
	if _, err := e.Finish(devA); !errors.Is(err, ErrNotJoined) {
		t.Errorf("Finish before picking: err = %v, want ErrNotJoined", err)
	}
	f := pick(t, e, s2.Code, devA, wire.PickRequest{Surname: "Франко", FirstName: "Іван"})
	if err := e.Kick(f.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	for _, e := range []*Engine{e, newEngine(t, st, hub)} {
		if s := heartbeat(t, e, devA, 0); s.State != "unjoined" || s.Result != nil {
			t.Errorf("kicked in the last sitting = %+v, want unjoined, no earlier student's result", s)
		}
		if _, err := e.Finish(devA); !errors.Is(err, ErrNotJoined) {
			t.Errorf("Finish: err = %v, want ErrNotJoined", err)
		}
	}
}

func TestLateDeliveryFromMovedOffDevice(t *testing.T) {
	e, st, hub := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	join(t, e, info.Code, devB, "10.0.0.2")
	if err := e.Move(p.ID, devB); err != nil {
		t.Fatal(err)
	}
	if err := e.End(); err != nil {
		t.Fatal(err)
	}

	// The dead old device comes back after the end with a change it held.
	if res := submitPending(t, e, devA, 0, change(p, "q1", 1, "o0")); res.Rejected != 0 || res.Status.State != "unjoined" {
		t.Errorf("late delivery from the moved-off device = %+v", res)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 1 || a.Late != 1 {
		t.Errorf("q1 = %+v, want stored late", a)
	}
	if s := heartbeat(t, e, devB, 1); s.State != "ended" || s.Result != nil {
		t.Errorf("new device, a change pending = %+v", s)
	}
	for _, e := range []*Engine{e, newEngine(t, st, hub)} {
		if s := heartbeat(t, e, devA, 0); s.State != "unjoined" {
			t.Errorf("moved-off device = %+v, want unjoined", s)
		}
		if s := heartbeat(t, e, devB, 0); s.State != "ended" || s.Result == nil || s.Result.Grade != 4 {
			t.Errorf("new device = %+v, want its result with the late answer", s)
		}
	}
}

func TestMovedOffDeliveryAfterLock(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	join(t, e, info.Code, devB, "10.0.0.2")
	if err := e.Move(p.ID, devB); err != nil {
		t.Fatal(err)
	}
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	// The new device syncs first and is shown the result, which locks p.
	if s := heartbeat(t, e, devB, 0); s.Result == nil || *s.Result != (wire.FinishResult{Grade: 1, Correct: 0, Total: 2}) {
		t.Fatalf("new device = %+v", s)
	}
	if by := participantRow(t, st, info.SittingID, p.ID).FinishedBy.String; by != "end_synced" {
		t.Fatalf("finished by %q, want end_synced", by)
	}

	// The dead old device comes back with a change it held: still taken.
	if res := submit(t, e, devA, change(p, "q1", 1, "o0")); res.Rejected != 0 {
		t.Errorf("moved-off delivery after the lock = %+v", res)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 1 || a.Late != 1 {
		t.Errorf("q1 = %+v, want stored late", a)
	}
	want := wire.FinishResult{Grade: 4, Correct: 1, Total: 2}
	if s := heartbeat(t, e, devB, 0); s.Result == nil || *s.Result != want {
		t.Errorf("regraded = %+v, want %+v", s, want)
	}
	if evs := eventParams(t, st, info.SittingID, "late_answers"); len(evs) != 1 || evs[0]["name"] != p.Name || evs[0]["count"] != "1" {
		t.Errorf("late_answers events = %v", evs)
	}
	if assignment(t, st, info.AssignmentID).ExportStale != 1 {
		t.Error("export not marked stale")
	}
	// The participant's own device stays locked.
	submit(t, e, devB, change(p, "q2", 1, "o0"))
	if a := stored(t, st, info.SittingID, p.ID, "q2"); a.ChangeID != "" {
		t.Errorf("stored %+v from the locked device", a)
	}
}

func TestConcurrentTickSubmitLive(t *testing.T) {
	clk := newClock()
	e, st, _ := setupAt(t, clk)
	info := start(t, e, nil)
	devices := []string{devA, devB, devC}
	ps := make([]wire.Participant, len(devices))
	for i, d := range devices {
		ps[i] = enter(t, e, info.Code, d, "Учень"+strconv.Itoa(i))
	}

	const edits = 40
	errs := make(chan error, 4*edits*len(devices))
	var wg sync.WaitGroup
	for i, d := range devices {
		wg.Go(func() {
			for seq := int64(1); seq <= edits; seq++ {
				if _, err := e.Submit(d, []wire.AnswerChange{change(ps[i], "q2", seq, "o"+strconv.Itoa(int(seq)%6))}, 0); err != nil {
					errs <- err
				}
				if _, err := e.Heartbeat(d, 0); err != nil {
					errs <- err
				}
			}
		})
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range 2 * edits {
			clk.add(time.Second)
			e.Tick()
			if _, err := e.Live(); err != nil {
				errs <- err
			}
		}
	}()
	wg.Wait()
	<-done
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	for _, p := range ps {
		if a := stored(t, st, info.SittingID, p.ID, "q2"); a.Seq != edits {
			t.Errorf("%s: stored seq %d, want %d", p.Name, a.Seq, edits)
		}
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
	heartbeat(t, e, devB, 0)
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
	heartbeat(t, e, devC, 0)
	if got := silent("online"); len(got) != 2 || got[1]["synced"] != "1" {
		t.Errorf("online events = %v, want a second one with synced 1", got)
	}
}

func TestEditTestDuringSittingUsesSnapshot(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	before, err := testFor(e, devA)
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
	if _, err := st.Q().UpdateTest(context.Background(), db.UpdateTestParams{Title: doc.Title, Doc: string(b), ID: "t1"}); err != nil {
		t.Fatal(err)
	}

	after, err := testFor(e, devA)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Errorf("test payload changed with the edit:\n%+v\n%+v", before, after)
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
	if want := map[string]testfmt.Answer{"q1": {Items: []string{"o0"}}, "q2": {Items: []string{"o0", "o1"}}}; len(r.Rows) != 1 || !reflect.DeepEqual(r.Rows[0].Answers, want) {
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

func TestSubmitStoresAnswerValue(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")

	submit(t, e, devA, change(p, "q1", 1, "o1"))
	res, err := e.Resume(devA)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Answers) != 1 || !slices.Equal(res.Answers[0].Answer.Items, []string{"o1"}) {
		t.Errorf("answers = %+v, want the stored items", res.Answers)
	}

	text := change(p, "q2", 1)
	text.Answer = testfmt.Answer{Text: "x"}
	if res := submit(t, e, devA, text); res.Rejected != 0 {
		t.Errorf("result = %+v, want the text dropped, not rejected", res)
	}
	if a := stored(t, st, info.SittingID, p.ID, "q2"); a.Value != `{}` {
		t.Errorf("q2 = %s, want text dropped", a.Value)
	}
}

func TestResumeReturnsStoredAnswers(t *testing.T) {
	e, _, _ := setup(t)
	info := start(t, e, nil)
	if _, err := e.Resume(devA); !errors.Is(err, ErrNotJoined) {
		t.Fatalf("Resume before joining = %v, want ErrNotJoined", err)
	}
	p := enter(t, e, info.Code, devA, "Шевченко")
	submit(t, e, devA, change(p, "q1", 3, "o1"))

	res, err := e.Resume(devA)
	if err != nil {
		t.Fatal(err)
	}
	if res.ParticipantID != p.ID || len(res.Test.Questions) != 2 || res.Status.State != "writing" {
		t.Errorf("Resume = %+v", res)
	}
	if len(res.Answers) != 1 || res.Answers[0].QuestionID != "q1" || res.Answers[0].Seq != 3 || !slices.Equal(res.Answers[0].Answer.Items, []string{"o1"}) {
		t.Errorf("answers = %+v", res.Answers)
	}

	if err := e.Kick(p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Resume(devA); !errors.Is(err, ErrKicked) {
		t.Errorf("Resume after kick = %v, want ErrKicked", err)
	}
}

func TestStoredAnswerMarksExportStale(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	export := func() {
		t.Helper()
		res, err := e.Results(info.AssignmentID)
		if err != nil {
			t.Fatal(err)
		}
		if err := st.Q().ClearExportStale(context.Background(), db.ClearExportStaleParams{ID: res.AssignmentID, ResultsRev: res.ResultsRev}); err != nil {
			t.Fatal(err)
		}
	}
	if assignment(t, st, info.AssignmentID).ExportStale != 0 {
		t.Fatal("stale before any answer")
	}
	submit(t, e, devA, change(p, "q1", 1, "o0"))
	if a := assignment(t, st, info.AssignmentID); a.ExportStale != 1 || a.ResultsRev != 1 {
		t.Errorf("after a live answer: stale %d, rev %d", a.ExportStale, a.ResultsRev)
	}
	export()
	if assignment(t, st, info.AssignmentID).ExportStale != 0 {
		t.Fatal("export did not clear")
	}
	// A repeat stores nothing and leaves the export current.
	submit(t, e, devA, change(p, "q1", 1, "o0"))
	if assignment(t, st, info.AssignmentID).ExportStale != 0 {
		t.Error("a change that stored nothing marked the export stale")
	}
	submit(t, e, devA, change(p, "q2", 1, "o0"))
	if a := assignment(t, st, info.AssignmentID); a.ExportStale != 1 || a.ResultsRev != 2 {
		t.Errorf("after a second live answer: stale %d, rev %d", a.ExportStale, a.ResultsRev)
	}
}

// clearExport pretends the current results were exported.
func clearExport(t *testing.T, e *Engine, st *store.Store, assignmentID string) {
	t.Helper()
	res, err := e.Results(assignmentID)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Q().ClearExportStale(context.Background(), db.ClearExportStaleParams{ID: assignmentID, ResultsRev: res.ResultsRev}); err != nil {
		t.Fatal(err)
	}
}

func TestUnstoredChangesLeaveExportCurrent(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	q := enter(t, e, info.Code, devB, "Франко")
	submit(t, e, devA, change(p, "q1", 1, "o0"))
	finish(t, e, devA)
	clearExport(t, e, st, info.AssignmentID)
	before := assignment(t, st, info.AssignmentID)
	if before.ExportStale != 0 {
		t.Fatal("export still stale after clearing")
	}

	// A locked participant's change, a repeat, and a change for an unknown question store nothing.
	repeat := change(q, "q1", 1, "o0")
	submit(t, e, devB, repeat)
	clearExport(t, e, st, info.AssignmentID)
	before = assignment(t, st, info.AssignmentID)
	res := submit(t, e, devA, change(p, "q2", 1, "o0"))
	if res.Rejected != 0 {
		t.Errorf("locked change rejected = %d, want it acked and ignored", res.Rejected)
	}
	submit(t, e, devB, repeat)
	res = submit(t, e, devB, change(q, "nope", 1, "o0"))
	if res.Rejected != 1 {
		t.Fatalf("unknown question rejected = %d, want 1", res.Rejected)
	}
	if after := assignment(t, st, info.AssignmentID); after.ExportStale != 0 || after.ResultsRev != before.ResultsRev {
		t.Errorf("stale %d, rev %d -> %d after changes that stored nothing", after.ExportStale, before.ResultsRev, after.ResultsRev)
	}
}

func TestOneSubmitBumpsResultsRevOnce(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	before := assignment(t, st, info.AssignmentID).ResultsRev
	submit(t, e, devA, change(p, "q1", 1, "o0"), change(p, "q2", 1, "o0"), change(p, "q1", 2, "o1"))
	if after := assignment(t, st, info.AssignmentID); after.ResultsRev != before+1 || after.ExportStale != 1 {
		t.Errorf("rev %d -> %d, stale %d; want one bump", before, after.ResultsRev, after.ExportStale)
	}
}
