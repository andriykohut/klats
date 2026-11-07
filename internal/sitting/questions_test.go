package sitting

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strconv"
	"testing"

	"github.com/andriykohut/klats/internal/events"
	"github.com/andriykohut/klats/internal/store"
	"github.com/andriykohut/klats/internal/store/db"
	"github.com/andriykohut/klats/internal/testfmt"
	"github.com/andriykohut/klats/internal/wire"
)

// singles returns n single-choice questions q1…qn of one point each, whose
// correct option is o0.
func singles(n int) []testfmt.Question {
	var qs []testfmt.Question
	for i := range n {
		qs = append(qs, testfmt.Question{ID: "q" + strconv.Itoa(i+1), Type: "single", Text: rich("Питання"), Points: 1, Options: []testfmt.Option{
			{ID: "o0", Content: rich("так"), Correct: true},
			{ID: "o1", Content: rich("ні")},
		}})
	}
	return qs
}

// setupSettings returns an engine over a database holding test "t1" of n
// questions (see singles) with the settings s, which Start completes with the
// defaults.
func setupSettings(t *testing.T, n int, s testfmt.Settings) (*Engine, *store.Store) {
	t.Helper()
	st := openStore(t)
	doc, err := json.Marshal(testfmt.Test{ID: "t1", Version: 1, Title: "Тест", Palette: "teal", Settings: s, Questions: singles(n)})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Q().InsertTest(context.Background(), db.InsertTestParams{ID: "t1", Title: "Тест", Doc: string(doc)}); err != nil {
		t.Fatal(err)
	}
	return newEngine(t, st, events.New()), st
}

func questionIDs[T any](qs []T, id func(T) string) []string {
	out := make([]string, len(qs))
	for i, q := range qs {
		out[i] = id(q)
	}
	return out
}

func testIDs(qs []testfmt.Question) []string {
	return questionIDs(qs, func(q testfmt.Question) string { return q.ID })
}

// resumed returns the ids of the questions the device gets, in its order, and
// its stored answers.
func resumed(t *testing.T, e *Engine, device string) ([]string, []wire.StoredAnswer) {
	t.Helper()
	res, err := e.Resume(device)
	if err != nil {
		t.Fatal(err)
	}
	return questionIDs(res.Test.Questions, func(q wire.StudentQuestion) string { return q.ID }), res.Answers
}

// qIndex returns the test position of the question qN.
func qIndex(id string) int {
	n, _ := strconv.Atoi(id[1:])
	return n - 1
}

func TestQuestionsFor(t *testing.T) {
	five := testfmt.Test{Questions: singles(5)}
	all := testIDs(five.Questions)
	with := func(s testfmt.Settings) testfmt.Test {
		c := five
		c.Settings = s
		return c
	}

	if got := testIDs(questionsFor(five, "p1")); !slices.Equal(got, all) {
		t.Errorf("no settings: %v, want the test's order", got)
	}
	for _, draw := range [][]testfmt.DrawLine{nil, {{Count: 9}}} {
		if got := testIDs(questionsFor(with(testfmt.Settings{Draw: draw}), "p1")); !slices.Equal(got, all) {
			t.Errorf("draw %v of 5: %v, want every question", draw, got)
		}
	}

	subset := with(testfmt.Settings{Draw: []testfmt.DrawLine{{Count: 3}}})
	drawn := map[string]bool{}
	for i := range 20 {
		id := "p" + strconv.Itoa(i)
		got := testIDs(questionsFor(subset, id))
		if len(got) != 3 || !slices.IsSortedFunc(got, func(a, b string) int { return qIndex(a) - qIndex(b) }) || len(slices.Compact(slices.Sorted(slices.Values(got)))) != 3 {
			t.Errorf("subset 3 of 5 for %s: %v, want 3 distinct questions in test order", id, got)
		}
		if again := testIDs(questionsFor(subset, id)); !slices.Equal(again, got) {
			t.Errorf("subset for %s: %v, then %v", id, got, again)
		}
		drawn[fmt.Sprint(got)] = true
	}
	if len(drawn) < 2 {
		t.Errorf("20 ids all drew %v", drawn)
	}

	shuffled := with(testfmt.Settings{ShuffleQuestions: true})
	other := 0
	for i := range 20 {
		id := "p" + strconv.Itoa(i)
		got := testIDs(questionsFor(shuffled, id))
		if sorted := slices.SortedFunc(slices.Values(got), func(a, b string) int { return qIndex(a) - qIndex(b) }); !slices.Equal(sorted, all) {
			t.Errorf("shuffle for %s: %v is not a permutation of %v", id, got, all)
		}
		if again := testIDs(questionsFor(shuffled, id)); !slices.Equal(again, got) {
			t.Errorf("shuffle for %s: %v, then %v", id, got, again)
		}
		if !slices.Equal(got, all) {
			other++
		}
	}
	if other == 0 {
		t.Error("shuffle: all 20 ids got the test's order")
	}

	both := with(testfmt.Settings{ShuffleQuestions: true, Draw: []testfmt.DrawLine{{Count: 3}}})
	if got := testIDs(questionsFor(both, "p1")); len(got) != 3 || len(slices.Compact(slices.Sorted(slices.Values(got)))) != 3 {
		t.Errorf("shuffled subset 3 of 5: %v", got)
	}
}

func TestDrawLines(t *testing.T) {
	qs := singles(6) // q1,q2: A; q3,q4: B; q5: A and B; q6: none
	for i, tags := range [][]string{{"A"}, {"A"}, {"B"}, {"B"}, {"A", "B"}, nil} {
		qs[i].Tags = tags
	}
	with := func(lines ...testfmt.DrawLine) testfmt.Test {
		return testfmt.Test{Questions: qs, Settings: testfmt.Settings{Draw: lines}}
	}

	ab := with(testfmt.DrawLine{Tag: "A", Count: 2}, testfmt.DrawLine{Tag: "B", Count: 1})
	for i := range 20 {
		id := "p" + strconv.Itoa(i)
		got := testIDs(questionsFor(ab, id))
		if len(got) != 3 || !slices.IsSortedFunc(got, func(a, b string) int { return qIndex(a) - qIndex(b) }) || len(slices.Compact(slices.Sorted(slices.Values(got)))) != 3 || slices.Contains(got, "q6") {
			t.Errorf("2 of A, 1 of B for %s: %v, want 3 distinct tagged questions in test order", id, got)
		}
		if again := testIDs(questionsFor(ab, id)); !slices.Equal(again, got) {
			t.Errorf("2 of A, 1 of B for %s: %v, then %v", id, got, again)
		}
	}

	if got := testIDs(questionsFor(with(testfmt.DrawLine{Tag: "A", Count: 5}), "p1")); !slices.Equal(got, []string{"q1", "q2", "q5"}) {
		t.Errorf("5 of A: %v, want the 3 tagged A", got)
	}
	if got := testIDs(questionsFor(with(testfmt.DrawLine{Tag: "Z", Count: 2}, testfmt.DrawLine{Count: 1}), "p1")); len(got) != 1 {
		t.Errorf("2 of a missing tag, 1 of all: %v, want one question", got)
	}

	// The «усіх питань» line runs after the tag line although it is written first.
	allFirst := with(testfmt.DrawLine{Count: 2}, testfmt.DrawLine{Tag: "A", Count: 3})
	for i := range 20 {
		id := "p" + strconv.Itoa(i)
		got := testIDs(questionsFor(allFirst, id))
		if len(got) != 5 || !slices.Contains(got, "q1") || !slices.Contains(got, "q2") || !slices.Contains(got, "q5") {
			t.Errorf("2 of all, then 3 of A, for %s: %v, want all 3 of A and 2 others", id, got)
		}
	}

	shuffled := with(testfmt.DrawLine{Count: 2})
	shuffled.Settings.ShuffleQuestions = true
	got := testIDs(questionsFor(shuffled, "p1"))
	if len(got) != 2 || len(slices.Compact(slices.Sorted(slices.Values(got)))) != 2 {
		t.Errorf("shuffled 2 of all: %v, want 2 distinct questions", got)
	}
	if again := testIDs(questionsFor(shuffled, "p1")); !slices.Equal(again, got) {
		t.Errorf("shuffled 2 of all: %v, then %v", got, again)
	}
}

func TestSubsetGrading(t *testing.T) {
	e, _ := setupSettings(t, 5, testfmt.Settings{Draw: []testfmt.DrawLine{{Count: 3}}})
	info := start(t, e, nil)
	if info.PerStudent != 3 || info.QuestionCount != 5 {
		t.Errorf("PerStudent %d of %d, want 3 of 5", info.PerStudent, info.QuestionCount)
	}
	right := enter(t, e, info.Code, devA, "Шевченко")
	wrong := enter(t, e, info.Code, devB, "Франко")
	got := map[string][]string{} // participant id → the ids of its questions
	got[right.ID], _ = resumed(t, e, devA)
	got[wrong.ID], _ = resumed(t, e, devB)
	for _, q := range got[right.ID] {
		submit(t, e, devA, change(right, q, 1, "o0"))
	}
	for _, q := range got[wrong.ID] {
		submit(t, e, devB, change(wrong, q, 1, "o1"))
	}
	if r := finish(t, e, devA); !reflect.DeepEqual(r, wire.FinishResult{Scale: "points12", Show: "grade", Grade: 12, Correct: 3, Total: 3}) {
		t.Errorf("Finish = %+v, want 12 for 3 of 3", r)
	}

	// pct returns the percent of rows that got q and scored full points on it.
	pct := func(q string) *int {
		a, b := slices.Contains(got[right.ID], q), slices.Contains(got[wrong.ID], q)
		v := map[[2]bool]int{{true, true}: 50, {true, false}: 100, {false, true}: 0}
		if !a && !b {
			return nil
		}
		return new(v[[2]bool{a, b}])
	}
	l := liveOf(t, e)
	cell := map[string]string{right.ID: "correct", wrong.ID: "wrong"} // each answered all three alike
	for _, row := range l.Rows {
		if want := slices.Repeat([]string{cell[row.ParticipantID]}, 3); !slices.Equal(row.Cells, want) {
			t.Errorf("%s: live cells %v, want %v", row.Name, row.Cells, want)
		}
	}
	for i, p := range l.QuestionPct {
		if want := pct("q" + strconv.Itoa(i+1)); !reflect.DeepEqual(p, want) {
			t.Errorf("live pct of q%d = %v, want %v", i+1, p, want)
		}
	}

	res := resultsOf(t, e, info.AssignmentID)
	for _, row := range res.Rows {
		notAsked := slices.DeleteFunc(testIDs(singles(5)), func(q string) bool { return slices.Contains(got[row.ParticipantID], q) })
		if !slices.Equal(row.NotAsked, notAsked) {
			t.Errorf("%s: NotAsked = %v, want %v", row.Name, row.NotAsked, notAsked)
		}
		for _, q := range notAsked {
			if row.Points[qIndex(q)] != 0 {
				t.Errorf("%s: points of the not-asked %s = %v", row.Name, q, row.Points[qIndex(q)])
			}
		}
		if row.ParticipantID == right.ID && (row.Earned != 3 || row.Max != 3 || row.Grade != 12) {
			t.Errorf("%s: %v of %v, grade %d; want 3 of 3, grade 12", row.Name, row.Earned, row.Max, row.Grade)
		}
	}
	for _, rq := range res.Questions {
		q := rq.Question.ID
		correct := 0
		if slices.Contains(got[right.ID], q) {
			correct = 1
		}
		if rq.Correct != correct || !reflect.DeepEqual(rq.CorrectPct, pct(q)) {
			t.Errorf("%s: correct %d, pct %v; want %d, %v", q, rq.Correct, rq.CorrectPct, correct, pct(q))
		}
	}
}

func TestChangeForQuestionNotAsked(t *testing.T) {
	e, st := setupSettings(t, 5, testfmt.Settings{Draw: []testfmt.DrawLine{{Count: 3}}})
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	asked, _ := resumed(t, e, devA)
	i := slices.IndexFunc(testIDs(singles(5)), func(q string) bool { return !slices.Contains(asked, q) })
	if i < 0 {
		t.Fatalf("the participant got every question: %v", asked)
	}

	c := change(p, "q"+strconv.Itoa(i+1), 1, "o0")
	if res := submit(t, e, devA, c); !slices.Equal(res.Acks, []string{c.ChangeID}) || res.Rejected != 1 {
		t.Errorf("result = %+v, want the change acked and rejected", res)
	}
	if a := stored(t, st, info.SittingID, p.ID, c.QuestionID); a.Value != "" {
		t.Errorf("stored %+v, want nothing", a)
	}
}

func TestMoveKeepsQuestions(t *testing.T) {
	e, st := setupSettings(t, 6, testfmt.Settings{ShuffleQuestions: true, Draw: []testfmt.DrawLine{{Count: 3}}})
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	before, _ := resumed(t, e, devA)
	submit(t, e, devA, change(p, before[0], 1, "o0"), change(p, before[2], 1, "o1"))
	_, answers := resumed(t, e, devA)

	join(t, e, info.Code, devB, "10.0.0.2")
	if err := e.Move(p.ID, devB); err != nil {
		t.Fatal(err)
	}
	after, moved := resumed(t, e, devB)
	if !slices.Equal(after, before) {
		t.Errorf("questions after the move = %v, want %v", after, before)
	}
	if len(moved) != 2 || !reflect.DeepEqual(moved, answers) {
		t.Errorf("answers after the move = %+v, want %+v", moved, answers)
	}
	if restarted, _ := resumed(t, newEngine(t, st, events.New()), devB); !slices.Equal(restarted, before) {
		t.Errorf("questions after a restart = %v, want %v", restarted, before)
	}
}

func TestCurrentCellFollowsStudentOrder(t *testing.T) {
	e, _ := setupSettings(t, 5, testfmt.Settings{ShuffleQuestions: true})
	info := start(t, e, nil)
	// A student whose second question does not follow their first in the
	// test, so the test's order would put the current cell elsewhere.
	var device string
	var p wire.Participant
	var order []string
	for i := 0; ; i++ {
		if i == 30 {
			t.Fatalf("for 30 students the second question followed the first in the test, the last order %v", order)
		}
		device = fmt.Sprintf("%026d", i)
		p = enter(t, e, info.Code, device, "Учень"+strconv.Itoa(i))
		if order, _ = resumed(t, e, device); qIndex(order[1]) != qIndex(order[0])+1 {
			break
		}
	}
	submit(t, e, device, change(p, order[0], 1, "o0"))

	want := []string{"empty", "empty", "empty", "empty", "empty"}
	want[qIndex(order[0])], want[qIndex(order[1])] = "correct", "current"
	l := liveOf(t, e)
	i := slices.IndexFunc(l.Rows, func(r wire.LiveRow) bool { return r.ParticipantID == p.ID })
	if !slices.Equal(l.Rows[i].Cells, want) {
		t.Errorf("cells = %v for the order %v, want %v", l.Rows[i].Cells, order, want)
	}
}
