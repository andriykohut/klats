package grading

import (
	"math"
	"reflect"
	"testing"

	"klats/internal/testfmt"
)

func q(typ string, partial bool, correct ...string) testfmt.Question {
	opts := []testfmt.Option{{ID: "a"}, {ID: "b"}, {ID: "c"}, {ID: "d"}}
	for i := range opts {
		for _, id := range correct {
			if opts[i].ID == id {
				opts[i].Correct = true
			}
		}
	}
	return testfmt.Question{ID: "q", Type: typ, Points: 1, Partial: partial, Options: opts}
}

func near(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestScoreMultiPartialTickAll(t *testing.T) {
	near(t, Score(q("multi", true, "a", "b", "c"), testfmt.Answer{Items: []string{"a", "b", "c", "d"}}), 2.0/3)
}

func TestScoreMultiPartialOneWrong(t *testing.T) {
	near(t, Score(q("multi", true, "a", "b", "c"), testfmt.Answer{Items: []string{"a", "b", "d"}}), 1.0/3)
}

func TestScoreMultiPartialFloorsAtZero(t *testing.T) {
	near(t, Score(q("multi", true, "a", "b", "c"), testfmt.Answer{Items: []string{"d"}}), 0)
}

func TestScoreMultiAllOrNothing(t *testing.T) {
	m := q("multi", false, "a", "b")
	near(t, Score(m, testfmt.Answer{Items: []string{"b", "a"}}), 1)
	near(t, Score(m, testfmt.Answer{Items: []string{"a"}}), 0)
	near(t, Score(m, testfmt.Answer{Items: []string{"a", "b", "c"}}), 0)
}

func TestScoreSingle(t *testing.T) {
	s := q("single", false, "a")
	near(t, Score(s, testfmt.Answer{Items: []string{"a"}}), 1)
	near(t, Score(s, testfmt.Answer{Items: []string{"b"}}), 0)
	near(t, Score(s, testfmt.Answer{Items: []string{"a", "b"}}), 0)
	near(t, Score(s, testfmt.Answer{}), 0)
}

func TestScoreIgnoresUnknownAndDuplicateIDs(t *testing.T) {
	near(t, Score(q("single", false, "a"), testfmt.Answer{Items: []string{"a", "zzz"}}), 1)
	near(t, Score(q("single", false, "a"), testfmt.Answer{Items: []string{"a", "a"}}), 1)
	near(t, Score(q("multi", false, "a", "b"), testfmt.Answer{Items: []string{"a", "a"}}), 0)
	near(t, Score(q("multi", true, "a", "b"), testfmt.Answer{Items: []string{"a", "a"}}), 0.5)
}

func TestTotalOverrideReplacesScore(t *testing.T) {
	q1, q2, q3 := q("single", false, "a"), q("single", false, "a"), q("single", false, "a")
	q1.ID, q2.ID, q3.ID = "q1", "q2", "q3"
	q2.Points, q3.Points = 2, 2
	test := testfmt.Test{Settings: testfmt.DefaultSettings(), Questions: []testfmt.Question{q1, q2, q3}}

	r := Total(test, map[string]testfmt.Answer{"q1": {Items: []string{"a"}}, "q2": {Items: []string{"b"}}}, map[string]float64{"q2": 0.5, "q3": 2})

	near(t, r.Earned, 3.5)
	near(t, r.Max, 5)
	near(t, r.PerQuestion["q2"], 0.5)
	near(t, r.PerQuestion["q3"], 2)
	if r.Correct != 2 {
		t.Fatalf("Correct = %d, want 2 (q1 and the fully overridden q3)", r.Correct)
	}
	if r.Grade != 8 {
		t.Fatalf("Grade = %d, want 8", r.Grade)
	}
}

func TestTotalUnanswered(t *testing.T) {
	test := testfmt.Test{Questions: []testfmt.Question{q("single", false, "a")}}
	r := Total(test, nil, nil)
	if v, ok := r.PerQuestion["q"]; !ok || v != 0 || r.Correct != 0 || r.Grade != 1 {
		t.Fatalf("unexpected result %+v", r)
	}
}

func TestGradeScales(t *testing.T) {
	def := testfmt.DefaultSettings().Scale
	custom := testfmt.Scale{Kind: "points12", Thresholds: []int{5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95}}
	pct, pass := testfmt.Scale{Kind: "percent"}, testfmt.Scale{Kind: "pass", Pass: 60}
	for _, c := range []struct {
		s           testfmt.Scale
		earned, max float64
		want        int
	}{
		{def, 0, 12, 1}, {def, 2, 12, 2}, {def, 4, 12, 4}, {def, 11, 12, 11}, {def, 11.9, 12, 11}, {def, 12, 12, 12}, {def, 0, 0, 1},
		{def, 9, 9, 12}, {def, 8, 9, 10}, {def, 1, 12, 1}, {def, 0, 9, 1},
		// 12 × earned / max lands just below the boundary in float64.
		{def, 3.3, 3.6, 11}, {def, 0.6, 3.6, 2},
		{custom, 9.6, 10, 12}, {custom, 9.4, 10, 11},
		{pct, 7, 8, 88}, {pct, 0, 5, 0}, {pct, 0, 0, 0},
		{pass, 5.99, 10, 0}, {pass, 6, 10, 1}, {pass, 0, 0, 0},
	} {
		if got := Grade(c.s, c.earned, c.max); got != c.want {
			t.Errorf("Grade(%s, %v, %v) = %d, want %d", c.s.Kind, c.earned, c.max, got, c.want)
		}
	}
}

func tfQuestion(partial bool) testfmt.Question {
	return testfmt.Question{ID: "q", Type: "truefalse", Points: 2, Partial: partial, Options: []testfmt.Option{
		{ID: "s1", Correct: true}, {ID: "s2"}, {ID: "s3", Correct: true}, {ID: "s4"},
	}}
}

func pairs(kv ...string) testfmt.Answer {
	a := testfmt.Answer{Pairs: map[string]string{}}
	for i := 0; i < len(kv); i += 2 {
		a.Pairs[kv[i]] = kv[i+1]
	}
	return a
}

func TestJudgeTrueFalse(t *testing.T) {
	v := Judge(tfQuestion(true), pairs("s1", "true", "s2", "false", "s3", "false"))
	near(t, v.Points, 0.5) // 2 × (2 − 1) / 4: s4 is unanswered
	if want := map[string]bool{"s1": true, "s2": true, "s3": false}; !reflect.DeepEqual(v.Items, want) {
		t.Errorf("Items = %v, want %v", v.Items, want)
	}

	all := pairs("s1", "true", "s2", "false", "s3", "true", "s4", "false")
	near(t, Judge(tfQuestion(false), all).Points, 2)
	one := pairs("s1", "true", "s2", "false", "s3", "true", "s4", "true")
	near(t, Judge(tfQuestion(false), one).Points, 0)
	near(t, Judge(tfQuestion(false), pairs("s1", "true")).Points, 0)
	near(t, Judge(tfQuestion(true), pairs("s1", "false", "s2", "true", "s3", "false")).Points, 0)
	near(t, Judge(tfQuestion(true), testfmt.Answer{}).Points, 0)
}

func TestJudgeGrid(t *testing.T) {
	g := testfmt.Question{ID: "q", Type: "grid", Points: 3, Partial: true, Options: []testfmt.Option{
		{ID: "r1", Target: "A"}, {ID: "r2", Target: "B"}, {ID: "r3", Target: "A"}, {ID: "r4"},
	}}
	v := Judge(g, pairs("r1", "A", "r2", "A", "r3", "A"))
	near(t, v.Points, 1) // 3 × (2 − 1) / 3: the row without a target is not counted
	if want := map[string]bool{"r1": true, "r2": false, "r3": true}; !reflect.DeepEqual(v.Items, want) {
		t.Errorf("Items = %v, want %v", v.Items, want)
	}
	g.Partial = false
	near(t, Judge(g, pairs("r1", "A", "r2", "A", "r3", "A")).Points, 0)
	near(t, Judge(g, pairs("r1", "A", "r2", "B", "r3", "A")).Points, 3)
}

func TestJudgePickItems(t *testing.T) {
	v := Judge(q("multi", true, "a", "b"), testfmt.Answer{Items: []string{"a", "c", "zzz"}})
	if want := map[string]bool{"a": true, "c": false}; !reflect.DeepEqual(v.Items, want) {
		t.Errorf("Items = %v, want %v", v.Items, want)
	}
}

func TestTotalCarriesVerdicts(t *testing.T) {
	test := testfmt.Test{Questions: []testfmt.Question{tfQuestion(true)}}
	r := Total(test, map[string]testfmt.Answer{"q": pairs("s1", "true")}, nil)
	if want := map[string]map[string]bool{"q": {"s1": true}}; !reflect.DeepEqual(r.Verdicts, want) {
		t.Errorf("Verdicts = %v, want %v", r.Verdicts, want)
	}
}
