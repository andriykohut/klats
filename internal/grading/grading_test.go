package grading

import (
	"math"
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
	near(t, Score(q("multi", true, "a", "b", "c"), []string{"a", "b", "c", "d"}), 2.0/3)
}

func TestScoreMultiPartialOneWrong(t *testing.T) {
	near(t, Score(q("multi", true, "a", "b", "c"), []string{"a", "b", "d"}), 1.0/3)
}

func TestScoreMultiPartialFloorsAtZero(t *testing.T) {
	near(t, Score(q("multi", true, "a", "b", "c"), []string{"d"}), 0)
}

func TestScoreMultiAllOrNothing(t *testing.T) {
	m := q("multi", false, "a", "b")
	near(t, Score(m, []string{"b", "a"}), 1)
	near(t, Score(m, []string{"a"}), 0)
	near(t, Score(m, []string{"a", "b", "c"}), 0)
}

func TestScoreSingle(t *testing.T) {
	s := q("single", false, "a")
	near(t, Score(s, []string{"a"}), 1)
	near(t, Score(s, []string{"b"}), 0)
	near(t, Score(s, []string{"a", "b"}), 0)
	near(t, Score(s, nil), 0)
}

func TestScoreIgnoresUnknownAndDuplicateIDs(t *testing.T) {
	near(t, Score(q("single", false, "a"), []string{"a", "zzz"}), 1)
	near(t, Score(q("single", false, "a"), []string{"a", "a"}), 1)
	near(t, Score(q("multi", false, "a", "b"), []string{"a", "a"}), 0)
	near(t, Score(q("multi", true, "a", "b"), []string{"a", "a"}), 0.5)
}

func TestTotalOverrideReplacesScore(t *testing.T) {
	q1, q2, q3 := q("single", false, "a"), q("single", false, "a"), q("single", false, "a")
	q1.ID, q2.ID, q3.ID = "q1", "q2", "q3"
	q2.Points, q3.Points = 2, 2
	test := testfmt.Test{Questions: []testfmt.Question{q1, q2, q3}}

	r := Total(test, map[string][]string{"q1": {"a"}, "q2": {"b"}}, map[string]float64{"q2": 0.5, "q3": 2})

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

func TestGrade12(t *testing.T) {
	for _, c := range []struct {
		earned, max float64
		want        int
	}{{9, 9, 12}, {8, 9, 10}, {11, 12, 11}, {2, 12, 2}, {1, 12, 1}, {0, 9, 1}, {0, 0, 1},
		// 12 × earned / max lands just below the boundary in float64.
		{3.3, 3.6, 11}, {0.6, 3.6, 2}} {
		if got := Grade12(c.earned, c.max); got != c.want {
			t.Errorf("Grade12(%v, %v) = %d, want %d", c.earned, c.max, got, c.want)
		}
	}
}
