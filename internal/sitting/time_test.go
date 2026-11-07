package sitting

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/andriykohut/klats/internal/events"
	"github.com/andriykohut/klats/internal/store"
	"github.com/andriykohut/klats/internal/testfmt"
	"github.com/andriykohut/klats/internal/wire"
)

// setupTimed returns an engine reading the time from clk over a database
// holding test "t1" of two questions (see singles) with the time limit tl.
func setupTimed(t *testing.T, clk *fakeClock, tl testfmt.TimeLimit) (*Engine, *store.Store, *events.Hub) {
	t.Helper()
	_, st := setupSettings(t, 2, testfmt.Settings{TimeLimit: tl})
	hub := events.New()
	e, err := New(st, hub, clk.now)
	if err != nil {
		t.Fatal(err)
	}
	return e, st, hub
}

func startEnding(t *testing.T, e *Engine, endsAt int64) wire.SittingInfo {
	t.Helper()
	info, err := e.Start("t1", nil, endsAt)
	if err != nil {
		t.Fatal(err)
	}
	return info
}

// remaining returns the device's remaining time from a heartbeat, or -1 for
// none.
func remaining(t *testing.T, e *Engine, device string) int64 {
	t.Helper()
	if r := heartbeat(t, e, device, 0).RemainingMs; r != nil {
		return *r
	}
	return -1
}

func TestRemainingPerStudent(t *testing.T) {
	clk := newClock()
	e, st, hub := setupTimed(t, clk, testfmt.TimeLimit{Mode: testfmt.TimeStudent, Minutes: 20})
	info := startEnding(t, e, 0)
	if info.TimeMode != "student" || info.Minutes != 20 || info.EndsAt != 0 {
		t.Errorf("sitting info = %+v, want 20 min per student", info)
	}
	if j := join(t, e, info.Code, devA, "10.0.0.1"); j.TimeMode != "student" || j.Minutes != 20 || j.EndClock != "" {
		t.Errorf("join info = %+v, want 20 min per student", j)
	}
	p := pick(t, e, info.Code, devA, wire.PickRequest{Surname: "Шевченко", FirstName: "Учень"})

	clk.add(5 * time.Minute)
	if got := remaining(t, e, devA); got != 15*60_000 {
		t.Errorf("remaining after 5 min = %d, want 15 min", got)
	}
	ch, unsub := hub.Subscribe("device:" + devA)
	defer unsub()
	if err := e.AddTime(p.ID, 5); err != nil {
		t.Fatal(err)
	}
	if !received(ch) {
		t.Error("device not told its status changed")
	}
	if got := remaining(t, e, devA); got != 20*60_000 {
		t.Errorf("remaining after +5 min = %d, want 20 min", got)
	}
	if evs := eventParams(t, st, info.SittingID, "extra_time"); len(evs) != 1 || evs[0]["name"] != "Шевченко Учень" || evs[0]["minutes"] != "5" {
		t.Errorf("extra_time events = %v", evs)
	}
	clk.add(time.Hour)
	if got := remaining(t, e, devA); got != 0 {
		t.Errorf("remaining past the deadline = %d, want 0", got)
	}
	if err := e.AddTime(p.ID, 5); err != nil {
		t.Fatal(err)
	}
	if got := remaining(t, e, devA); got != 5*60_000 {
		t.Errorf("remaining after +5 min past the deadline = %d, want 5 min", got)
	}
	finish(t, e, devA)
	if got := remaining(t, e, devA); got != -1 {
		t.Errorf("remaining once finished = %d, want none", got)
	}
}

func TestRemainingCommon(t *testing.T) {
	clk := newClock()
	e, _, _ := setupTimed(t, clk, testfmt.TimeLimit{Mode: testfmt.TimeCommon, Minutes: 45})
	endsAt := clk.now().Add(30 * time.Minute).UnixMilli()
	info := startEnding(t, e, endsAt)
	if info.TimeMode != "common" || info.EndsAt != endsAt {
		t.Errorf("sitting info = %+v, want common, ending at %d", info, endsAt)
	}
	clk.add(10 * time.Minute)
	wantClock := time.UnixMilli(endsAt).Local().Format("15:04")
	if j := join(t, e, info.Code, devA, "10.0.0.1"); j.TimeMode != "common" || j.EndClock != wantClock {
		t.Errorf("join info = %+v, want common, ending at %s", j, wantClock)
	}
	p := pick(t, e, info.Code, devA, wire.PickRequest{Surname: "Шевченко", FirstName: "Учень"})
	if got := remaining(t, e, devA); got != 20*60_000 {
		t.Errorf("remaining = %d, want 20 min", got)
	}
	clk.add(27 * time.Minute)
	if err := e.AddTime(p.ID, 5); err != nil {
		t.Fatal(err)
	}
	if got := remaining(t, e, devA); got != 5*60_000 {
		t.Errorf("remaining after +5 min 7 min past the end = %d, want 5 min", got)
	}
}

func TestRemainingAfterRestart(t *testing.T) {
	clk := newClock()
	e, st, hub := setupTimed(t, clk, testfmt.TimeLimit{Mode: testfmt.TimeCommon, Minutes: 45})
	info := startEnding(t, e, clk.now().Add(30*time.Minute).UnixMilli())
	p := enter(t, e, info.Code, devA, "Шевченко")
	if err := e.AddTime(p.ID, 5); err != nil {
		t.Fatal(err)
	}

	e2, err := New(st, hub, clk.now)
	if err != nil {
		t.Fatal(err)
	}
	if got := remaining(t, e2, devA); got != 35*60_000 {
		t.Errorf("remaining after a restart = %d, want 35 min", got)
	}
}

func TestOvertimeLate(t *testing.T) {
	clk := newClock()
	e, st, _ := setupTimed(t, clk, testfmt.TimeLimit{Mode: testfmt.TimeStudent, Minutes: 20})
	info := startEnding(t, e, 0)
	p := enter(t, e, info.Code, devA, "Шевченко")

	clk.add(20*time.Minute + 5*time.Second)
	submit(t, e, devA, change(p, "q1", 1, "o0"))
	if a := stored(t, st, info.SittingID, p.ID, "q1"); a.Seq != 1 || a.Late != 0 {
		t.Errorf("q1 within the grace = %+v, want on time", a)
	}
	clk.add(6 * time.Second)
	res := submit(t, e, devA, change(p, "q1", 2, "o1"), change(p, "q2", 1, "o0"))
	if res.Status.State != "writing" || res.Rejected != 0 {
		t.Errorf("overtime submit = %+v, want stored and still writing", res)
	}
	for _, q := range []string{"q1", "q2"} {
		if a := stored(t, st, info.SittingID, p.ID, q); a.Late != 1 {
			t.Errorf("%s past the grace = %+v, want late", q, a)
		}
	}
	if evs := eventParams(t, st, info.SittingID, "overtime_answers"); len(evs) != 1 || evs[0]["name"] != "Шевченко Учень" || evs[0]["count"] != "2" {
		t.Errorf("overtime_answers events = %v, want one for both answers", evs)
	}
	if evs := eventParams(t, st, info.SittingID, "late_answers"); len(evs) != 0 {
		t.Errorf("late_answers events = %v, want none while the sitting runs", evs)
	}
	if r := resultsOf(t, e, info.AssignmentID).Rows[0]; !slices.Equal(r.Late, []string{"q1", "q2"}) {
		t.Errorf("late = %v, want both questions", r.Late)
	}
}

func TestStartEndsAt(t *testing.T) {
	clk := newClock()
	e, _, _ := setupTimed(t, clk, testfmt.TimeLimit{Mode: testfmt.TimeCommon, Minutes: 45})
	now := clk.now().UnixMilli()
	const hour = 60 * 60_000
	for _, endsAt := range []int64{0, now - 60_000, now, now + 12*hour + 1} {
		if _, err := e.Start("t1", nil, endsAt); !errors.Is(err, ErrInvalid) {
			t.Errorf("common end time %d: err = %v, want ErrInvalid", endsAt, err)
		}
	}
	if e.Active() {
		t.Fatal("a refused start left a sitting running")
	}
	startEnding(t, e, now+12*hour)

	e, st, _ := setupTimed(t, clk, testfmt.TimeLimit{Mode: testfmt.TimeStudent, Minutes: 20})
	info := startEnding(t, e, now+hour)
	if s, err := st.Q().GetSitting(context.Background(), info.SittingID); err != nil || s.EndsAt.Valid || info.EndsAt != 0 {
		t.Errorf("per-student sitting = %+v (%v), info %+v, want no end time", s, err, info)
	}
}

func TestAddTimeRefused(t *testing.T) {
	e, _, _ := setup(t)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	if err := e.AddTime(p.ID, 5); !errors.Is(err, ErrInvalid) {
		t.Errorf("untimed test: err = %v, want ErrInvalid", err)
	}

	clk := newClock()
	e, _, _ = setupTimed(t, clk, testfmt.TimeLimit{Mode: testfmt.TimeStudent, Minutes: 20})
	info = startEnding(t, e, 0)
	p = enter(t, e, info.Code, devA, "Шевченко")
	done := enter(t, e, info.Code, devB, "Франко")
	finish(t, e, devB)
	gone := enter(t, e, info.Code, devC, "Бойко")
	if err := e.Kick(gone.ID); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name    string
		id      string
		minutes int
		want    error
	}{
		{"0 minutes", p.ID, 0, ErrInvalid},
		{"61 minutes", p.ID, 61, ErrInvalid},
		{"a finished participant", done.ID, 5, ErrInvalid},
		{"a kicked participant", gone.ID, 5, ErrInvalid},
		{"an unknown participant", "nobody", 5, ErrNotFound},
	} {
		if err := e.AddTime(c.id, c.minutes); !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", c.name, err, c.want)
		}
	}
	if err := e.AddTime(p.ID, 60); err != nil {
		t.Errorf("60 minutes: %v", err)
	}
}
