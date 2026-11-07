package grading

import (
	"testing"

	"github.com/andriykohut/klats/internal/testfmt"
)

func TestNormalizeDefaults(t *testing.T) {
	var m testfmt.Match
	if got, want := normalize(" Мар'яна  ", m), normalize("марʼяна", m); got != want {
		t.Errorf("apostrophes and spaces: %q vs %q", got, want)
	}
	if normalize("пiсня", m) != normalize("пісня", m) {
		t.Error("a Latin i must equal the Cyrillic one")
	}
	if normalize("КИЇВ", m) != normalize("Київ", m) {
		t.Error("case must not matter")
	}
	if got := normalize("a  b c", m); got != "а b с" {
		t.Errorf("spaces collapse to one: %q", got)
	}
	if normalize("й", m) != normalize("й", m) {
		t.Error("NFC must compose й")
	}
}

func TestNormalizeSwitchesOff(t *testing.T) {
	for name, c := range map[string]struct {
		m    testfmt.Match
		a, b string
	}{
		"case":        {testfmt.Match{CaseSensitive: true}, "Київ", "київ"},
		"apostrophes": {testfmt.Match{StrictApostrophes: true}, "м'ята", "м’ята"},
		"letters":     {testfmt.Match{StrictLetters: true}, "пiсня", "пісня"},
	} {
		if normalize(c.a, c.m) == normalize(c.b, c.m) {
			t.Errorf("%s: want different", name)
		}
	}
}

func TestTypo(t *testing.T) {
	for _, s := range []string{"Кийв", "Київв", "Кив", "Кивї", "Київ"} {
		if !typo1(s, "Київ") {
			t.Errorf("%q should match Київ", s)
		}
	}
	for _, s := range []string{"Кі", "Кйив", "Київвв", "Кйвї"} {
		if typo1(s, "Київ") {
			t.Errorf("%q should not match Київ", s)
		}
	}
}

func TestTypoNeedsSwitch(t *testing.T) {
	q := testfmt.Question{Type: "short", Points: 1, Accepted: []string{"Київ"}}
	if Judge(q, testfmt.Answer{Text: "Кийв"}).Points != 0 {
		t.Error("a typo must not match without AllowTypo")
	}
	q.Match = &testfmt.Match{AllowTypo: true}
	if Judge(q, testfmt.Answer{Text: "Кийв"}).Points != 1 {
		t.Error("a typo must match with AllowTypo")
	}
}

func TestParseNumber(t *testing.T) {
	for in, want := range map[string]float64{"9,8": 9.8, "9.8": 9.8, " -1 000,5 ": -1000.5, "−3": -3, "+2": 2, "1 000": 1000} {
		if got, ok := parseNumber(in); !ok || got != want {
			t.Errorf("parseNumber(%q) = %v, %v; want %v", in, got, ok, want)
		}
	}
	for _, in := range []string{"1.000,5", "9,8 м", "1e3", "", " ", "-", "--3", "1 - 2", "- 3", "1,2,3", "∞"} {
		if _, ok := parseNumber(in); ok {
			t.Errorf("parseNumber(%q) should fail", in)
		}
	}
}

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
	v := Judge(numberQ(testfmt.NumberKey{Mode: "exact", Value: 3}), testfmt.Answer{Text: "4"})
	if len(v.Items) != 1 || v.Items[""] {
		t.Errorf("a wrong number: %+v", v.Items)
	}
	if v := Judge(numberQ(testfmt.NumberKey{Mode: "exact", Value: 3}), testfmt.Answer{Text: " "}); len(v.Items) != 0 {
		t.Errorf("a blank number: %+v", v.Items)
	}
}

func TestJudgeShort(t *testing.T) {
	q := testfmt.Question{ID: "q", Type: "short", Points: 2, Accepted: []string{"Київ", "Kyiv"}}
	for text, want := range map[string]float64{"київ ": 2, "Kyiv": 2, "Львів": 0, "": 0} {
		if got := Judge(q, testfmt.Answer{Text: text}).Points; got != want {
			t.Errorf("%q: %v, want %v", text, got, want)
		}
	}
	if v := Judge(q, testfmt.Answer{Text: "Львів"}); len(v.Items) != 1 || v.Items[""] {
		t.Errorf("a wrong answer: %+v", v.Items)
	}
	if v := Judge(q, testfmt.Answer{Text: "київ"}); !v.Items[""] {
		t.Errorf("a right answer: %+v", v.Items)
	}
	if v := Judge(q, testfmt.Answer{}); len(v.Items) != 0 {
		t.Errorf("no answer: %+v", v.Items)
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

func TestBlankAcceptedMatchesNothing(t *testing.T) {
	q := testfmt.Question{ID: "q", Type: "short", Points: 1, Accepted: []string{"Київ", " "}, Match: &testfmt.Match{AllowTypo: true}}
	for text, want := range map[string]float64{"?": 0, "х": 0, "Київ": 1} {
		if got := Judge(q, testfmt.Answer{Text: text}).Points; got != want {
			t.Errorf("%q: %v, want %v", text, got, want)
		}
	}
}

func TestTypoOnlyForLongWordsWithoutDigits(t *testing.T) {
	typo := &testfmt.Match{AllowTypo: true}
	year := testfmt.Question{ID: "q", Type: "short", Points: 1, Accepted: []string{"1991"}, Match: typo}
	if Judge(year, testfmt.Answer{Text: "1990"}).Points != 0 || Judge(year, testfmt.Answer{Text: "1991"}).Points != 1 {
		t.Error("a year must match exactly")
	}
	symbol := testfmt.Question{ID: "q", Type: "short", Points: 1, Accepted: []string{"Fe"}, Match: typo}
	for _, s := range []string{"F", "Fr"} {
		if Judge(symbol, testfmt.Answer{Text: s}).Points != 0 {
			t.Errorf("%q must not match Fe", s)
		}
	}
	if Judge(symbol, testfmt.Answer{Text: "fe"}).Points != 1 {
		t.Error("Fe must still match without case")
	}
	mixed := testfmt.Question{ID: "q", Type: "short", Points: 1, Accepted: []string{"H2O ok"}, Match: typo}
	if Judge(mixed, testfmt.Answer{Text: "H2O o"}).Points != 0 {
		t.Error("an accepted text with a digit must match exactly")
	}
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
