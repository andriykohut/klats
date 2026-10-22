package sitting

import (
	"context"
	"errors"
	"math"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"

	"klats/internal/store/db"
	"klats/internal/wire"
)

func liveOf(t *testing.T, e *Engine) wire.LiveSnapshot {
	t.Helper()
	l, err := e.Live()
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func resultsOf(t *testing.T, e *Engine, assignmentID string) wire.AssignmentResults {
	t.Helper()
	r, err := e.Results(assignmentID)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestLiveCellsAndPct(t *testing.T) {
	e, st, _ := setup(t)
	info := start(t, e, addClass(t, st, "Петренко Тарас", "Іваненко Олена", "Бойко Марія", "Коваль Дмитро", "Антоненко Ірина"))
	names := join(t, e, info.Code, devA, "10.0.0.101").Names // Антоненко, Бойко, Іваненко, Коваль, Петренко
	join(t, e, info.Code, devB, "10.0.0.102")
	join(t, e, info.Code, devC, "10.0.0.103")
	const devD = "dddddddddddddddddddddddddd"
	join(t, e, info.Code, devD, "10.0.0.104")
	if l := liveOf(t, e); !slices.Equal(l.QuestionPct, []*int{nil, nil}) || l.Counts.ClassSize != 5 || len(l.Counts.NotJoined) != 5 || len(l.Rows) != 0 {
		t.Fatalf("live before anyone picked = %+v", l)
	}

	petrenko := pick(t, e, info.Code, devA, wire.PickRequest{StudentID: names[4].StudentID})
	ivanenko := pick(t, e, info.Code, devB, wire.PickRequest{StudentID: names[2].StudentID})
	pick(t, e, info.Code, devC, wire.PickRequest{StudentID: names[1].StudentID}) // Бойко answers nothing
	koval := pick(t, e, info.Code, devD, wire.PickRequest{StudentID: names[3].StudentID})
	submit(t, e, devD, change(koval, "q1", 1, "o1"))
	if err := e.Kick(koval.ID); err != nil {
		t.Fatal(err)
	}
	submit(t, e, devA, change(petrenko, "q1", 1, "o0"))
	submit(t, e, devB, change(ivanenko, "q1", 1, "o1"), change(ivanenko, "q2", 1, "o0"))
	finish(t, e, devB)

	l := liveOf(t, e)
	seven := 7 // 3 of 5 points
	want := []wire.LiveRow{
		{Name: "Бойко Марія", DeviceLabel: "103", Cells: []string{"current", "empty"}, Status: "writing"},
		{Name: "Іваненко Олена", DeviceLabel: "102", Cells: []string{"wrong", "correct"}, Status: "finished", Grade: &seven},
		{Name: "Петренко Тарас", DeviceLabel: "101", Cells: []string{"correct", "current"}, Status: "writing"},
	}
	if len(l.Rows) != len(want) {
		t.Fatalf("rows = %+v", l.Rows)
	}
	for i, w := range want {
		r := l.Rows[i]
		if r.Name != w.Name || r.DeviceLabel != w.DeviceLabel || r.DeviceToken != map[string]string{"101": devA, "102": devB, "103": devC}[w.DeviceLabel] || !slices.Equal(r.Cells, w.Cells) || r.Status != w.Status || (r.Grade == nil) != (w.Grade == nil) || (r.Grade != nil && *r.Grade != *w.Grade) {
			t.Errorf("row %d = %+v, want %+v", i, r, w)
		}
	}
	// q1: Петренко right, Іваненко wrong; q2: Іваненко right.
	if len(l.QuestionPct) != 2 || *l.QuestionPct[0] != 50 || *l.QuestionPct[1] != 100 {
		t.Errorf("question pct = %v", l.QuestionPct)
	}
	if c := l.Counts; c.InTest != 3 || c.ClassSize != 5 || c.Finished != 1 || c.Offline != 0 || !slices.Equal(c.NotJoined, []string{"Антоненко Ірина", "Коваль Дмитро"}) {
		t.Errorf("counts = %+v", c)
	}
	if l.Sitting != info {
		t.Errorf("sitting = %+v, want %+v", l.Sitting, info)
	}
	if r := resultsOf(t, e, info.AssignmentID); len(r.Rows) != 3 || slices.ContainsFunc(r.Rows, func(r wire.ResultRow) bool { return r.ParticipantID == koval.ID }) {
		t.Errorf("results rows = %+v, want the kicked participant left out", r.Rows)
	}
}

func TestLiveEvents(t *testing.T) {
	e, st, _, info, p, eventID := startClash(t)
	for range 25 {
		e.Focus(devA, true)
	}
	e.Focus(devA, false)

	l := liveOf(t, e)
	if len(l.Events) != 21 {
		t.Fatalf("%d events, want the pinned one and 20 others", len(l.Events))
	}
	if ev := l.Events[0]; ev.ID != eventID || ev.Kind != "name_clash" || !ev.Pinned || !slices.Equal(ev.Actions, ClashActions) || ev.Params["name"] != "Петренко Тарас" {
		t.Errorf("first event = %+v, want the pending clash", ev)
	}
	for i, ev := range l.Events[1:] {
		if want := strconv.Itoa(25 - i); ev.Kind != "window_switch" || ev.Params["count"] != want || ev.Params["name"] != p.Name || ev.Pinned || len(ev.Actions) != 0 {
			t.Errorf("event %d = %+v, want window switch %s", i+1, ev, want)
		}
	}
	if l.Rows[0].WindowSwitches != 25 || participantRow(t, st, info.SittingID, p.ID).WindowSwitches != 25 {
		t.Errorf("window switches = %d", l.Rows[0].WindowSwitches)
	}

	// Once finished, leaving the window no longer counts.
	finish(t, e, devA)
	e.Focus(devA, true)
	if n := participantRow(t, st, info.SittingID, p.ID).WindowSwitches; n != 25 {
		t.Errorf("window switches after finishing = %d", n)
	}
	if err := e.ResolveEvent(eventID, ActionKickNew); err != nil {
		t.Fatal(err)
	}
	if evs := liveOf(t, e).Events; len(evs) != 20 || evs[0].Pinned {
		t.Errorf("events after resolving = %+v", evs)
	}
}

func TestEndFinishesWritersAndSnapshots(t *testing.T) {
	e, st, hub := setup(t)
	if err := e.End(); !errors.Is(err, ErrNotFound) {
		t.Errorf("End without a sitting: err = %v, want ErrNotFound", err)
	}
	dir := t.TempDir()
	e.SetSnapshotDir(dir)
	info := start(t, e, nil)
	pa := enter(t, e, info.Code, devA, "Шевченко")
	pb := enter(t, e, info.Code, devB, "Франко")
	finish(t, e, devB)
	ch, unsub := hub.Subscribe("device:" + devA)
	defer unsub()

	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	if !received(ch) {
		t.Error("writing device not told the sitting ended")
	}
	if a, b := participantRow(t, st, info.SittingID, pa.ID), participantRow(t, st, info.SittingID, pb.ID); a.FinishedBy.String != "end" || b.FinishedBy.String != "student" {
		t.Errorf("finished by %q and %q, want end and student", a.FinishedBy.String, b.FinishedBy.String)
	}
	s, err := st.Q().GetSitting(context.Background(), info.SittingID)
	if err != nil || s.EndedAt.Int64 != clock().UnixMilli() {
		t.Errorf("sitting = %+v (err %v), want ended now", s, err)
	}
	if snaps, _ := filepath.Glob(filepath.Join(dir, "snapshots", "klats-*.db")); len(snaps) != 1 {
		t.Errorf("snapshots = %v, want one", snaps)
	}
	if l := liveOf(t, e); !l.Sitting.Ended || l.Sitting.SittingID != info.SittingID || len(l.Rows) != 2 || l.Counts.Finished != 2 {
		t.Errorf("live after the end = %+v, want the ended sitting", l)
	}
	want := wire.FinishResult{Grade: 1, Correct: 0, Total: 2}
	if got := finish(t, e, devA); got != want {
		t.Errorf("Finish after the end = %+v, want %+v", got, want)
	}
	if _, err := e.Finish(devC); !errors.Is(err, ErrNotJoined) {
		t.Errorf("Finish from an unknown device: err = %v, want ErrNotJoined", err)
	}
	if err := e.End(); !errors.Is(err, ErrNotFound) {
		t.Errorf("End twice: err = %v, want ErrNotFound", err)
	}
	next := start(t, e, nil)
	if l := liveOf(t, e); l.Sitting != next || len(l.Rows) != 0 || l.Rows == nil {
		t.Errorf("live after the next start = %+v", l)
	}
}

func TestActiveWhileSittingRuns(t *testing.T) {
	e, st, hub := setup(t)
	if e.Active() {
		t.Fatal("active before any sitting")
	}
	start(t, e, nil)
	if !e.Active() {
		t.Fatal("not active after Start")
	}
	if !newEngine(t, st, hub).Active() {
		t.Error("a resumed sitting is not active")
	}
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	if e.Active() || newEngine(t, st, hub).Active() {
		t.Error("active after End")
	}
}

func TestOverrideChangesResults(t *testing.T) {
	clk := newClock()
	e, st, _ := setupAt(t, clk)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	enter(t, e, info.Code, devB, "Франко")
	submit(t, e, devA, change(p, "q1", 1, "o1"), change(p, "q2", 1, "o0"))
	clk.add(90 * time.Second)
	finish(t, e, devA)

	r := resultsOf(t, e, info.AssignmentID)
	if r.TestTitle != "Дроби" || r.ClassName != "" || !r.ExportStale || len(r.Questions) != 2 || r.Questions[0].ID != "q1" || r.Questions[0].CorrectPct != 0 || r.Questions[1].CorrectPct != 50 || r.Questions[0].Correct != 0 || r.Questions[1].Correct != 1 {
		t.Errorf("results = %+v", r)
	}
	if len(r.Rows) != 2 || r.Rows[0].Name != "Франко Учень" || r.Rows[1].Name != p.Name {
		t.Fatalf("rows = %+v, want Ukrainian order", r.Rows)
	}
	row := r.Rows[1]
	if !slices.Equal(row.Points, []float64{0, 3}) || row.Earned != 3 || row.Max != 5 || row.Grade != 7 || row.DurationSec != 90 || row.SittingDate != info.StartedAt || len(row.Overridden) != 0 {
		t.Errorf("row = %+v", row)
	}
	if r.Rows[0].DurationSec != 0 || r.Rows[0].Grade != 1 || len(r.Rows[0].Answers) != 0 {
		t.Errorf("unfinished row = %+v", r.Rows[0])
	}

	// Pretend the results were exported, so the override is what marks them stale.
	if err := st.Q().ClearExportStale(context.Background(), db.ClearExportStaleParams{ID: r.AssignmentID, ResultsRev: r.ResultsRev}); err != nil {
		t.Fatal(err)
	}
	two := 2.0
	if err := e.SetOverride(info.AssignmentID, p.ID, "q1", &two); err != nil {
		t.Fatal(err)
	}
	r = resultsOf(t, e, info.AssignmentID)
	if row := r.Rows[1]; !slices.Equal(row.Points, []float64{2, 3}) || row.Earned != 5 || row.Grade != 12 || !slices.Equal(row.Overridden, []string{"q1"}) || !r.ExportStale {
		t.Errorf("overridden row = %+v, stale %v", row, r.ExportStale)
	}
	if r.Questions[0].CorrectPct != 50 {
		t.Errorf("q1 correct pct = %d, want 50", r.Questions[0].CorrectPct)
	}
	if r.Questions[0].Correct != 1 {
		t.Errorf("q1 correct = %d, want 1", r.Questions[0].Correct)
	}
	if s := heartbeat(t, e, devA, 0); s.Result == nil || s.Result.Grade != 12 {
		t.Errorf("status = %+v, want the overridden grade", s)
	}
	if l := liveOf(t, e); !slices.Equal(l.Rows[1].Cells, []string{"correct", "correct"}) {
		t.Errorf("live cells = %v", l.Rows[1].Cells)
	}

	for _, bad := range []float64{2.5, -1, math.NaN()} {
		if err := e.SetOverride(info.AssignmentID, p.ID, "q1", &bad); !errors.Is(err, ErrInvalid) {
			t.Errorf("points %v: err = %v, want ErrInvalid", bad, err)
		}
	}
	for _, ids := range [][3]string{{"nope", p.ID, "q1"}, {info.AssignmentID, "nobody", "q1"}, {info.AssignmentID, p.ID, "q9"}} {
		if err := e.SetOverride(ids[0], ids[1], ids[2], &two); !errors.Is(err, ErrNotFound) {
			t.Errorf("SetOverride%v: err = %v, want ErrNotFound", ids, err)
		}
	}
	if _, err := e.Results("nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Results of an unknown assignment: err = %v, want ErrNotFound", err)
	}

	if err := e.SetOverride(info.AssignmentID, p.ID, "q1", nil); err != nil {
		t.Fatal(err)
	}
	if row := resultsOf(t, e, info.AssignmentID).Rows[1]; !slices.Equal(row.Points, []float64{0, 3}) || len(row.Overridden) != 0 {
		t.Errorf("cleared row = %+v", row)
	}
	if assignment(t, st, info.AssignmentID).ExportStale != 1 {
		t.Error("export not stale")
	}

	// Overrides still apply once the sitting has ended.
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	one := 1.0
	if err := e.SetOverride(info.AssignmentID, p.ID, "q2", &one); err != nil {
		t.Fatal(err)
	}
	if row := resultsOf(t, e, info.AssignmentID).Rows[1]; !slices.Equal(row.Points, []float64{0, 1}) || row.Grade != 2 {
		t.Errorf("row overridden after the end = %+v", row)
	}
	if l := liveOf(t, e); !slices.Equal(l.Rows[1].Cells, []string{"wrong", "wrong"}) {
		t.Errorf("ended live cells = %v", l.Rows[1].Cells)
	}
	if s := heartbeat(t, e, devA, 0); s.Result == nil || s.Result.Grade != 2 {
		t.Errorf("status = %+v, want the overridden grade", s)
	}
}

func TestLiveAfterEndClassMode(t *testing.T) {
	e, st, hub := setup(t)
	info := start(t, e, addClass(t, st, "Петренко Тарас", "Іваненко Олена", "Бойко Марія"))
	names := join(t, e, info.Code, devA, "10.0.0.101").Names // Бойко, Іваненко, Петренко
	join(t, e, info.Code, devB, "10.0.0.102")
	pick(t, e, info.Code, devA, wire.PickRequest{StudentID: names[2].StudentID})
	pick(t, e, info.Code, devB, wire.PickRequest{StudentID: names[1].StudentID})
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	for i, e := range []*Engine{e, newEngine(t, st, hub)} {
		l := liveOf(t, e)
		if c := l.Counts; !l.Sitting.Ended || len(l.Rows) != 2 || c.ClassSize != 3 || c.Finished != 2 || !slices.Equal(c.NotJoined, []string{"Бойко Марія"}) {
			t.Errorf("engine %d: live after the end = %+v", i, l)
		}
	}
}

func TestEndResolvesClashes(t *testing.T) {
	e, st, hub, info, _, eventID := startClash(t)
	newcomer, unsub := hub.Subscribe("device:" + devB)
	defer unsub()
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	if len(openClashes(t, st, info.SittingID)) != 0 {
		t.Error("clash left open after the end")
	}
	if !received(newcomer) {
		t.Error("newcomer device not told")
	}
	for i, e := range []*Engine{e, newEngine(t, st, hub)} {
		for _, ev := range liveOf(t, e).Events {
			if ev.Pinned || len(ev.Actions) != 0 {
				t.Errorf("engine %d: event %+v still waits for a decision", i, ev)
			}
		}
		if err := e.ResolveEvent(eventID, ActionMove); !errors.Is(err, ErrNotFound) {
			t.Errorf("engine %d: resolving after the end: err = %v, want ErrNotFound", i, err)
		}
	}
}
