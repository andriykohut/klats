package grading

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"

	"klats/internal/testfmt"
)

// highlightQ makes a highlight question whose body holds the words w0 to
// w(n-1), separated by spaces, with the target mark on the marked ones.
func highlightQ(n int, partial bool, marked ...int) testfmt.Question {
	var nodes []string
	for i := range n {
		mark := ""
		if slices.Contains(marked, i) {
			mark = `,"marks":[{"type":"target"}]`
		}
		nodes = append(nodes, fmt.Sprintf(`{"type":"text","text":"w%d"%s},{"type":"text","text":" "}`, i, mark))
	}
	body := `{"type":"doc","content":[{"type":"paragraph","content":[` + strings.Join(nodes, ",") + `]}]}`
	return testfmt.Question{ID: "q", Type: "highlight", Points: 3, Partial: partial, Body: json.RawMessage(body)}
}

func chosen(ids ...string) testfmt.Answer { return testfmt.Answer{Items: ids} }

func TestJudgeHighlight(t *testing.T) {
	h := highlightQ(10, true, 2, 5, 7)
	v := Judge(h, chosen("2", "5", "0"))
	near(t, v.Points, 1) // 3 × (2 − 1) / 3
	if want := map[string]bool{"2": true, "5": true, "0": false}; !reflect.DeepEqual(v.Items, want) {
		t.Errorf("Items = %v, want %v", v.Items, want)
	}
	near(t, Judge(h, chosen("2", "5", "7")).Points, 3)
	near(t, Judge(highlightQ(10, false, 2, 5, 7), chosen("2", "5", "0")).Points, 0)
	near(t, Judge(highlightQ(10, false, 2, 5, 7), chosen("7", "5", "2")).Points, 3)
}

func TestOpenIsPending(t *testing.T) {
	open := testfmt.Question{ID: "q1", Type: "open", Points: 4}
	single := q("single", false, "a")
	single.ID = "q2"
	test := testfmt.Test{Questions: []testfmt.Question{open, single}}
	answers := map[string]testfmt.Answer{"q1": {Text: "Тому що…"}, "q2": {Items: []string{"a"}}}

	r := Total(test, answers, nil)
	if r.Pending != 1 || r.PerQuestion["q1"] != 0 || r.Earned != 1 {
		t.Errorf("answered, no override: %+v", r)
	}
	if _, ok := r.Verdicts["q1"]; ok {
		t.Errorf("a written answer has a verdict: %v", r.Verdicts)
	}

	r = Total(test, answers, map[string]float64{"q1": 2})
	if r.Pending != 0 || r.Earned != 3 {
		t.Errorf("override 2: %+v", r)
	}
	if r := Total(test, answers, map[string]float64{"q1": 0}); r.Pending != 0 {
		t.Errorf("an override of 0 grades the answer: %+v", r)
	}

	for _, a := range []testfmt.Answer{{Text: "  \n"}, {}} {
		r = Total(test, map[string]testfmt.Answer{"q1": a}, nil)
		if r.Pending != 0 || r.PerQuestion["q1"] != 0 {
			t.Errorf("blank answer %q: %+v", a.Text, r)
		}
	}
}
