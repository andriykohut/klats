package grading

import (
	"reflect"
	"testing"

	"github.com/andriykohut/klats/internal/testfmt"
)

func numberQ(k testfmt.NumberKey) testfmt.Question {
	return testfmt.Question{ID: "q", Type: "number", Points: 2, Number: &k}
}

func TestJudgeNumber(t *testing.T) {
	for name, c := range map[string]struct {
		q    testfmt.Question
		text string
		want float64
	}{
		"exact right":      {numberQ(testfmt.NumberKey{Mode: "exact", Value: 9.8}), "9,8", 2},
		"exact wrong":      {numberQ(testfmt.NumberKey{Mode: "exact", Value: 9.8}), "9.81", 0},
		"tolerance edge":   {numberQ(testfmt.NumberKey{Mode: "tolerance", Value: 9.8, Tolerance: 0.1}), "9,9", 2},
		"tolerance out":    {numberQ(testfmt.NumberKey{Mode: "tolerance", Value: 9.8, Tolerance: 0.1}), "9,95", 0},
		"range min":        {numberQ(testfmt.NumberKey{Mode: "range", Min: 5, Max: 10}), "5", 2},
		"range max":        {numberQ(testfmt.NumberKey{Mode: "range", Min: 5, Max: 10}), "10,0", 2},
		"range out":        {numberQ(testfmt.NumberKey{Mode: "range", Min: 5, Max: 10}), "10,01", 0},
		"unparseable":      {numberQ(testfmt.NumberKey{Mode: "exact", Value: 3}), "3 м", 0},
		"large exact":      {numberQ(testfmt.NumberKey{Mode: "exact", Value: 1e12}), "1000000000000", 2},
		"no key":           {testfmt.Question{Type: "number", Points: 2}, "3", 0},
		"unknown mode":     {numberQ(testfmt.NumberKey{Mode: "x"}), "0", 0},
		"blank unanswered": {numberQ(testfmt.NumberKey{Mode: "exact", Value: 0}), " ", 0},
	} {
		if got := Judge(c.q, testfmt.Answer{Text: c.text}).Points; got != c.want {
			t.Errorf("%s: %v, want %v", name, got, c.want)
		}
	}
	for text, want := range map[string]float64{"9.8": 9.8, " -1 000,5 ": -1000.5, "−3": -3, "+2": 2, "1 000": 1000} {
		if got := Judge(numberQ(testfmt.NumberKey{Mode: "exact", Value: want}), testfmt.Answer{Text: text}).Points; got != 2 {
			t.Errorf("%q: %v, want 2", text, got)
		}
	}
	// Every number lies in this range, so 0 points means the text does not
	// read as one.
	anyNumber := numberQ(testfmt.NumberKey{Mode: "range", Min: -1e6, Max: 1e6})
	for _, text := range []string{"1.000,5", "9,8 м", "1e3", "-", "--3", "1 - 2", "- 3", "1,2,3", "∞"} {
		if got := Judge(anyNumber, testfmt.Answer{Text: text}).Points; got != 0 {
			t.Errorf("%q reads as a number: %v", text, got)
		}
	}
	v := Judge(numberQ(testfmt.NumberKey{Mode: "exact", Value: 3}), testfmt.Answer{Text: "4"})
	if len(v.Items) != 1 || v.Items[""] {
		t.Errorf("a wrong number: %+v", v.Items)
	}
	if v := Judge(numberQ(testfmt.NumberKey{Mode: "exact", Value: 3}), testfmt.Answer{Text: " "}); len(v.Items) != 0 {
		t.Errorf("a blank number: %+v", v.Items)
	}
}

func TestJudgeShort(t *testing.T) {
	typo := &testfmt.Match{AllowTypo: true}
	for _, c := range []struct {
		accepted []string
		match    *testfmt.Match
		text     string
		right    bool
	}{
		{[]string{"Київ", "Kyiv"}, nil, "київ ", true},
		{[]string{"Київ", "Kyiv"}, nil, "Kyiv", true},
		{[]string{"Київ", "Kyiv"}, nil, "Львів", false},
		// Unless a switch turns it off, matching ignores case, apostrophe
		// variants and Latin lookalikes of Cyrillic letters. It always ignores
		// extra spaces and Unicode composition.
		{[]string{"марʼяна"}, nil, " Мар'яна  ", true},
		{[]string{"пісня"}, nil, "пiсня", true},
		{[]string{"Київ"}, nil, "КИЇВ", true},
		{[]string{"а b с"}, nil, "a  b c", true},
		{[]string{"й"}, nil, "й", true},
		{[]string{"Київ"}, &testfmt.Match{CaseSensitive: true}, "київ", false},
		{[]string{"м’ята"}, &testfmt.Match{StrictApostrophes: true}, "м'ята", false},
		{[]string{"пісня"}, &testfmt.Match{StrictLetters: true}, "пiсня", false},
		// AllowTypo forgives one extra, missing, wrong or swapped letter, only
		// in an accepted text of at least 4 characters without a digit.
		{[]string{"Київ"}, nil, "Кийв", false},
		{[]string{"Київ"}, typo, "Кийв", true},
		{[]string{"Київ"}, typo, "Київв", true},
		{[]string{"Київ"}, typo, "Кив", true},
		{[]string{"Київ"}, typo, "Кивї", true},
		{[]string{"Київ"}, typo, "Київ", true},
		{[]string{"Київ"}, typo, "Кі", false},
		{[]string{"Київ"}, typo, "Кйив", false},
		{[]string{"Київ"}, typo, "Київвв", false},
		{[]string{"Київ"}, typo, "Кйвї", false},
		{[]string{"1991"}, typo, "1990", false},
		{[]string{"1991"}, typo, "1991", true},
		{[]string{"Fe"}, typo, "F", false},
		{[]string{"Fe"}, typo, "Fr", false},
		{[]string{"Fe"}, typo, "fe", true},
		{[]string{"H2O ok"}, typo, "H2O o", false},
		// A blank accepted text matches nothing, not even with a typo.
		{[]string{"Київ", " "}, typo, "?", false},
		{[]string{"Київ", " "}, typo, "х", false},
		{[]string{"Київ", " "}, typo, "Київ", true},
	} {
		q := testfmt.Question{ID: "q", Type: "short", Points: 2, Accepted: c.accepted, Match: c.match}
		want := Verdict{Items: map[string]bool{"": c.right}}
		if c.right {
			want.Points = 2
		}
		if got := Judge(q, testfmt.Answer{Text: c.text}); !reflect.DeepEqual(got, want) {
			t.Errorf("%q against %q: got %+v, want %+v", c.text, c.accepted, got, want)
		}
	}
	q := testfmt.Question{ID: "q", Type: "short", Points: 2, Accepted: []string{"Київ", "Kyiv"}}
	if v := Judge(q, testfmt.Answer{}); v.Points != 0 || len(v.Items) != 0 {
		t.Errorf("no answer: %+v", v)
	}
}

func gapsQ(partial bool) testfmt.Question {
	return testfmt.Question{
		ID: "q", Type: "gaps", Points: 3, Partial: partial,
		Gaps: []testfmt.Gap{
			{ID: "g1", Accepted: []string{"Київ"}},
			{ID: "g2", Accepted: []string{"1991"}},
			{ID: "g3", Choices: []testfmt.Choice{{ID: "c1", Text: "a"}, {ID: "c2", Text: "b", Correct: true}}},
		},
	}
}

func TestJudgeGaps(t *testing.T) {
	q := gapsQ(true)
	v := Judge(q, testfmt.Answer{Pairs: map[string]string{"g1": "київ", "g2": "1990", "g3": "c2"}})
	near(t, v.Points, 2)
	if !v.Items["g1"] || v.Items["g2"] || !v.Items["g3"] || len(v.Items) != 3 {
		t.Errorf("items = %+v", v.Items)
	}
	// A wrong list pick costs; the unanswered typed gap does not.
	v = Judge(q, testfmt.Answer{Pairs: map[string]string{"g1": "київ", "g3": "c1"}})
	near(t, v.Points, 0)
	if len(v.Items) != 2 {
		t.Errorf("items = %+v", v.Items)
	}
	near(t, Judge(q, testfmt.Answer{Pairs: map[string]string{"g2": "x", "g1": "y"}}).Points, 0)
	near(t, Judge(q, testfmt.Answer{Pairs: map[string]string{"g1": " ", "g3": "c2"}}).Points, 1)

	all := testfmt.Answer{Pairs: map[string]string{"g1": "Київ", "g2": "1991", "g3": "c2"}}
	near(t, Judge(gapsQ(false), all).Points, 3)
	near(t, Judge(gapsQ(false), testfmt.Answer{Pairs: map[string]string{"g1": "Київ", "g3": "c2"}}).Points, 0)
}

func TestJudgeGapsUsesMatchSwitches(t *testing.T) {
	q := gapsQ(true)
	q.Match = &testfmt.Match{CaseSensitive: true}
	near(t, Judge(q, testfmt.Answer{Pairs: map[string]string{"g1": "київ"}}).Points, 0)
	near(t, Judge(q, testfmt.Answer{Pairs: map[string]string{"g1": "Київ"}}).Points, 1)
}

func TestJudgeGapsTypoOnlyInWords(t *testing.T) {
	q := gapsQ(true)
	q.Match = &testfmt.Match{AllowTypo: true}
	v := Judge(q, testfmt.Answer{Pairs: map[string]string{"g1": "Кийв", "g2": "1990"}})
	near(t, v.Points, 1)
	if !v.Items["g1"] || v.Items["g2"] {
		t.Errorf("items = %+v", v.Items)
	}
}
