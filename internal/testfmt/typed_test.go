package testfmt

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func shortQ(accepted ...string) Question {
	return Question{ID: "q1", Type: "short", Text: rj("Q"), Points: 1, Accepted: accepted}
}

func numQ(k *NumberKey) Question {
	return Question{ID: "q1", Type: "number", Text: rj("Q"), Points: 1, Number: k}
}

// gapsQ makes a gaps question whose body holds the given gaps, in order.
func gapsQ(gaps ...Gap) Question {
	nodes := []string{`{"type":"text","text":"Q "}`}
	for _, g := range gaps {
		nodes = append(nodes, fmt.Sprintf(`{"type":"gap","attrs":{"id":%q}}`, g.ID))
	}
	body := `{"type":"doc","content":[{"type":"paragraph","content":[` + strings.Join(nodes, ",") + `]}]}`
	return Question{ID: "q1", Type: "gaps", Points: 3, Body: json.RawMessage(body), Gaps: gaps}
}

func TestDecodeSyncsGapsWithBody(t *testing.T) {
	q := gapsQ(Gap{ID: "g1"}, Gap{ID: "g2"})
	q.Gaps = []Gap{{ID: "g2", Accepted: []string{"x"}}, {ID: "g3", Accepted: []string{"y"}}}
	got := mustDecodeQ(t, q).Gaps
	want := []Gap{{ID: "g1"}, {ID: "g2", Accepted: []string{"x"}}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("gaps = %+v, want %+v", got, want)
	}
}

func TestDecodeCapsGapsOfBody(t *testing.T) {
	many := func(n int) Question {
		gaps := make([]Gap, n)
		for i := range gaps {
			gaps[i] = Gap{ID: fmt.Sprintf("g%d", i), Accepted: []string{"x"}}
		}
		return gapsQ(gaps...)
	}
	q := mustDecodeQ(t, many(50))
	if len(q.Gaps) != 50 {
		t.Fatalf("gaps = %d", len(q.Gaps))
	}
	// A decoded test is stored and decoded again.
	mustDecodeQ(t, q)

	over := many(51)
	over.Gaps = nil
	if _, err := decodeQ(t, over); err == nil {
		t.Error("51 gap nodes: want error")
	}
}

func TestDecodeKeepsGapOrderOfBody(t *testing.T) {
	q := gapsQ(Gap{ID: "g1"}, Gap{ID: "g2"})
	q.Gaps = []Gap{{ID: "g2", Accepted: []string{"x"}}, {ID: "g1", Accepted: []string{"y"}}}
	got := mustDecodeQ(t, q).Gaps
	if len(got) != 2 || got[0].ID != "g1" || got[1].ID != "g2" {
		t.Errorf("gaps = %+v", got)
	}
}

func TestProblemsShortAndNumber(t *testing.T) {
	ps := wantCodes(t, testOf(t, shortQ()), "no_accepted")
	if ps[0].Severity != "error" {
		t.Errorf("no_accepted severity = %s", ps[0].Severity)
	}
	wantCodes(t, testOf(t, shortQ(" ")), "no_accepted")
	ps = wantCodes(t, testOf(t, shortQ("Київ")), "one_accepted")
	if ps[0].Severity != "info" {
		t.Errorf("one_accepted severity = %s", ps[0].Severity)
	}
	wantCodes(t, testOf(t, shortQ("Київ", "Kyiv")))

	for name, k := range map[string]*NumberKey{
		"nil":            nil,
		"range reversed": {Mode: "range", Min: 10, Max: 5},
		"negative tol":   {Mode: "tolerance", Value: 1, Tolerance: -1},
		"unknown mode":   {Mode: "x"},
	} {
		if ps := wantCodes(t, testOf(t, numQ(k)), "no_number"); ps[0].Severity != "error" {
			t.Errorf("%s: severity %s", name, ps[0].Severity)
		}
	}
	wantCodes(t, testOf(t, numQ(&NumberKey{Mode: "exact", Value: 0})))
	wantCodes(t, testOf(t, numQ(&NumberKey{Mode: "range", Min: 5, Max: 5})))
	wantCodes(t, testOf(t, numQ(&NumberKey{Mode: "tolerance", Value: 1})))
}

func TestProblemsGaps(t *testing.T) {
	wantCodes(t, testOf(t, Question{ID: "q1", Type: "gaps", Points: 1, Body: rj("no gaps")}), "no_gaps")

	typed := Gap{ID: "g1", Accepted: []string{"x"}}
	list := Gap{ID: "g2", Choices: []Choice{{ID: "a", Text: "a", Correct: true}, {ID: "b", Text: "b"}}}
	wantCodes(t, testOf(t, gapsQ(typed, list)))

	ps := wantCodes(t, testOf(t, gapsQ(typed, Gap{ID: "g2"})), "gap_no_answer")
	if ps[0].Count != 2 || ps[0].Severity != "error" {
		t.Errorf("typed gap without answer: %+v", ps[0])
	}
	ps = wantCodes(t, testOf(t, gapsQ(Gap{ID: "g1", Accepted: []string{" "}})), "gap_no_answer")
	if ps[0].Count != 1 {
		t.Errorf("typed gap without answer: %+v", ps[0])
	}

	one := Gap{ID: "g1", Choices: []Choice{{ID: "a", Text: "a", Correct: true}}}
	if ps = wantCodes(t, testOf(t, gapsQ(one)), "gap_no_answer"); ps[0].Count != 1 {
		t.Errorf("one choice: %+v", ps[0])
	}
	none := Gap{ID: "g1", Choices: []Choice{{ID: "a", Text: "a"}, {ID: "b", Text: "b"}}}
	wantCodes(t, testOf(t, gapsQ(none)), "gap_no_answer")
	other := none
	other.ID = "g2"
	wantCodes(t, testOf(t, gapsQ(none, other)), "gap_no_answer", "gap_no_answer")
}

func TestCleanAnswerTyped(t *testing.T) {
	for _, typ := range []string{"short", "number"} {
		q := Question{Type: typ}
		got, ok := q.CleanAnswer(Answer{Text: strings.Repeat("я", 200), Items: []string{"a"}})
		if !ok || got.Items != nil || got.Text != strings.Repeat("я", 200) {
			t.Errorf("%s: 200 runes: %+v, %v", typ, got, ok)
		}
		if _, ok := q.CleanAnswer(Answer{Text: strings.Repeat("я", 201)}); ok {
			t.Errorf("%s: 201 runes must be invalid", typ)
		}
	}

	list := Gap{ID: "g2", Choices: []Choice{{ID: "a", Text: "a", Correct: true}, {ID: "b", Text: "b"}}}
	q := mustDecodeQ(t, gapsQ(Gap{ID: "g1", Accepted: []string{"x"}}, list))
	got, ok := q.CleanAnswer(Answer{Pairs: map[string]string{"g1": "anything", "g2": "b"}, Text: "x"})
	if !ok || got.Text != "" || got.Pairs["g1"] != "anything" || got.Pairs["g2"] != "b" {
		t.Errorf("valid gaps answer: %+v, %v", got, ok)
	}
	for name, a := range map[string]Answer{
		"unknown gap":     {Pairs: map[string]string{"g9": "x"}},
		"not a choice id": {Pairs: map[string]string{"g2": "zz"}},
		"long typed text": {Pairs: map[string]string{"g1": strings.Repeat("я", 201)}},
	} {
		if _, ok := q.CleanAnswer(a); ok {
			t.Errorf("%s: want invalid", name)
		}
	}
}
