package sitting

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/andriykohut/klats/internal/store/db"
	"github.com/andriykohut/klats/internal/testfmt"
)

func TestResultsOrder(t *testing.T) {
	// order returns the Order of the only row of a sitting of five questions
	// with the settings s, and the ids of the questions its student got.
	order := func(s testfmt.Settings) (got, own []string) {
		e, _ := setupSettings(t, 5, s)
		info := start(t, e, nil)
		enter(t, e, info.Code, devA, "Шевченко")
		own, _ = resumed(t, e, devA)
		return resultsOf(t, e, info.AssignmentID).Rows[0].Order, own
	}

	if got, _ := order(testfmt.Settings{}); !slices.Equal(got, testIDs(singles(5))) {
		t.Errorf("no settings: Order = %v, want the test's order", got)
	}
	if got, own := order(testfmt.Settings{ShuffleQuestions: true}); !slices.Equal(got, own) {
		t.Errorf("shuffle: Order = %v, want the student's %v", got, own)
	}
	if got, own := order(testfmt.Settings{Draw: []testfmt.DrawLine{{Count: 3}}}); len(got) != 3 || !slices.Equal(got, own) {
		t.Errorf("subset 3 of 5: Order = %v, want the student's %v", got, own)
	}
}

func TestResultsDrawn(t *testing.T) {
	for _, draw := range [][]testfmt.DrawLine{nil, {{Count: 3}}} {
		e, _ := setupSettings(t, 5, testfmt.Settings{Draw: draw})
		info := start(t, e, nil)
		if got := resultsOf(t, e, info.AssignmentID).Drawn; got != (draw != nil) {
			t.Errorf("draw %v: Drawn = %v", draw, got)
		}
	}
}

func TestDeleteParticipant(t *testing.T) {
	e, st, _ := setupAt(t, newClock())
	info := start(t, e, nil)
	a := enter(t, e, info.Code, devA, "Шевченко")
	b := enter(t, e, info.Code, devB, "Франко")
	submit(t, e, devA, change(a, "q1", 1, "o1"))
	finish(t, e, devA)
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	asg := info.AssignmentID
	if err := st.Q().ClearExportStale(context.Background(), db.ClearExportStaleParams{ID: asg, ResultsRev: resultsOf(t, e, asg).ResultsRev}); err != nil {
		t.Fatal(err)
	}

	if err := e.DeleteParticipant(asg, a.ID); err != nil {
		t.Fatal(err)
	}
	r := resultsOf(t, e, asg)
	if len(r.Rows) != 1 || r.Rows[0].ParticipantID != b.ID || !r.ExportStale {
		t.Errorf("results after the delete = %+v", r)
	}
	if rows := liveOf(t, e).Rows; len(rows) != 1 || rows[0].ParticipantID != b.ID {
		t.Errorf("live rows after the delete = %+v", rows)
	}
	if err := e.DeleteParticipant("nope", b.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown assignment: err = %v, want ErrNotFound", err)
	}
	if err := e.DeleteParticipant(asg, "nobody"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown participant: err = %v, want ErrNotFound", err)
	}
	if err := e.DeleteParticipant(asg, a.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleted participant: err = %v, want ErrNotFound", err)
	}
}

func TestDeleteRefusedWhileRunning(t *testing.T) {
	e, _, _ := setupAt(t, newClock())
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	if err := e.DeleteParticipant(info.AssignmentID, p.ID); !errors.Is(err, ErrSittingActive) {
		t.Errorf("DeleteParticipant: err = %v, want ErrSittingActive", err)
	}
	if err := e.DeleteAssignment(info.AssignmentID); !errors.Is(err, ErrSittingActive) {
		t.Errorf("DeleteAssignment: err = %v, want ErrSittingActive", err)
	}
	if rows := resultsOf(t, e, info.AssignmentID).Rows; len(rows) != 1 {
		t.Errorf("rows = %+v, want the participant kept", rows)
	}
}

func TestDeleteAssignmentOfEndedSitting(t *testing.T) {
	e, _, _ := setupAt(t, newClock())
	info := start(t, e, nil)
	enter(t, e, info.Code, devA, "Шевченко")
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	if err := e.DeleteAssignment(info.AssignmentID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Results(info.AssignmentID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Results after the delete: err = %v, want ErrNotFound", err)
	}
	if rows := liveOf(t, e).Rows; len(rows) != 0 {
		t.Errorf("live rows = %+v, want none", rows)
	}
	heartbeat(t, e, devA, 0)
	if err := e.DeleteAssignment(info.AssignmentID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete: err = %v, want ErrNotFound", err)
	}
}
