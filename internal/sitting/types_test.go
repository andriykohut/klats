package sitting

import (
	"context"
	"encoding/json"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/andriykohut/klats/internal/events"
	"github.com/andriykohut/klats/internal/store"
	"github.com/andriykohut/klats/internal/store/db"
	"github.com/andriykohut/klats/internal/testfmt"
	"github.com/andriykohut/klats/internal/wire"
)

// setupTypes returns an engine over a database holding test "t1" with a
// true/false question q1 (statements s1 true, s2 false) and a grid question q2
// (eight rows r0..r7, row ri → column c(i mod 2)), shuffled when shuffle is set.
func setupTypes(t *testing.T, shuffle bool) (*Engine, *store.Store) {
	t.Helper()
	st := openStore(t)
	var rows []testfmt.Option
	for i := range 8 {
		rows = append(rows, testfmt.Option{ID: "r" + strconv.Itoa(i), Content: rich("рядок " + strconv.Itoa(i)), Target: "c" + strconv.Itoa(i%2)})
	}
	doc, err := json.Marshal(testfmt.Test{ID: "t1", Version: 1, Title: "Типи", Palette: "teal", Questions: []testfmt.Question{
		{ID: "q1", Type: "truefalse", Text: rich("Правда?"), Points: 2, Partial: true, ShuffleOptions: shuffle, Options: []testfmt.Option{
			{ID: "s1", Content: rich("перше"), Correct: true}, {ID: "s2", Content: rich("друге")},
		}},
		{ID: "q2", Type: "grid", Text: rich("Куди?"), Points: 3, ShuffleOptions: shuffle, Options: rows, Targets: []testfmt.Target{
			{ID: "c0", Content: rich("нуль"), X: 0.25}, {ID: "c1", Content: rich("один")},
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Q().InsertTest(context.Background(), db.InsertTestParams{ID: "t1", Title: "Типи", Doc: string(doc)}); err != nil {
		t.Fatal(err)
	}
	return newEngine(t, st, events.New()), st
}

var rowIDs = []string{"r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"}

func TestStudentPayloadTrueFalseGrid(t *testing.T) {
	e, _ := setupTypes(t, false)
	code := start(t, e, nil).Code
	enter(t, e, code, devA, "Шевченко")
	res, err := testFor(e, devA)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(res)
	if err != nil {
		t.Fatal(err)
	}
	for _, banned := range []string{`"correct"`, `"target"`, "Correct", "points", "partial"} {
		if strings.Contains(string(b), banned) {
			t.Errorf("payload contains %s: %s", banned, b)
		}
	}
	grid := res.Questions[1]
	// Only label points keep a position.
	if len(grid.Targets) != 2 || grid.Targets[0].ID != "c0" || grid.Targets[0].X != 0 {
		t.Errorf("grid targets = %+v", grid.Targets)
	}
	if got := optionIDs(res.Questions[0]); !slices.Equal(got, []string{"s1", "s2"}) {
		t.Errorf("unshuffled order = %v", got)
	}
	if got := optionIDs(grid); !slices.Equal(got, rowIDs) {
		t.Errorf("unshuffled grid order = %v", got)
	}
}

func TestStudentPayloadShufflesOnlyWithShuffleOptions(t *testing.T) {
	e, _ := setupTypes(t, true)
	code := start(t, e, nil).Code
	order := func(device string) []string {
		res, err := testFor(e, device)
		if err != nil {
			t.Fatal(err)
		}
		return optionIDs(res.Questions[1])
	}
	enter(t, e, code, devA, "Шевченко")
	enter(t, e, code, devB, "Франко")
	a, b := order(devA), order(devB)
	if slices.Equal(a, b) || slices.Equal(a, rowIDs) {
		t.Errorf("orders %v and %v are not shuffled per device", a, b)
	}
	res, err := testFor(e, devA)
	if err != nil {
		t.Fatal(err)
	}
	if got := res.Questions[1].Targets; got[0].ID != "c0" {
		t.Errorf("targets were shuffled: %+v", got)
	}
}

func typedChange(p wire.Participant, question string, seq int64, a testfmt.Answer) wire.AnswerChange {
	c := change(p, question, seq)
	c.Answer = a
	return c
}

func TestSubmitCleansTypedAnswers(t *testing.T) {
	e, st := setupTypes(t, false)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	res := submit(t, e, devA,
		typedChange(p, "q1", 1, testfmt.Answer{Pairs: map[string]string{"s1": "true"}, Items: []string{"s2"}}),
		typedChange(p, "q1", 2, testfmt.Answer{Pairs: map[string]string{"s1": "maybe"}}),
		typedChange(p, "q2", 1, testfmt.Answer{Pairs: map[string]string{"r0": "c9"}}),
	)
	if res.Rejected != 2 || len(res.Acks) != 3 {
		t.Fatalf("result = %+v, want 2 rejected", res)
	}
	var got testfmt.Answer
	if err := json.Unmarshal([]byte(stored(t, st, info.SittingID, p.ID, "q1").Value), &got); err != nil {
		t.Fatal(err)
	}
	if want := (testfmt.Answer{Pairs: map[string]string{"s1": "true"}}); !reflect.DeepEqual(got, want) {
		t.Errorf("stored = %+v, want %+v", got, want)
	}
}

func TestResultsCarryVerdicts(t *testing.T) {
	e, _ := setupTypes(t, false)
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	submit(t, e, devA, typedChange(p, "q1", 1, testfmt.Answer{Pairs: map[string]string{"s1": "true", "s2": "true"}}))

	res := resultsOf(t, e, info.AssignmentID)
	want := map[string]bool{"s1": true, "s2": false}
	if got := res.Rows[0].Verdicts["q1"]; !reflect.DeepEqual(got, want) {
		t.Errorf("Verdicts[q1] = %v, want %v", got, want)
	}
	if q := res.Questions[1].Question; q.Type != "grid" || len(q.Targets) != 2 || q.Options[0].Target != "c0" {
		t.Errorf("results question = %+v", q)
	}
}
