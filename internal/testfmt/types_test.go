package testfmt

import (
	"encoding/json"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func rj(s string) json.RawMessage { return json.RawMessage(richText(s)) }

// decodeQ decodes a test of the one question.
func decodeQ(t *testing.T, q Question) (Question, error) {
	t.Helper()
	raw, err := json.Marshal(Test{ID: "t1", Version: 1, Title: "T", Palette: "teal", Questions: []Question{q}})
	if err != nil {
		t.Fatal(err)
	}
	tst, err := Decode(raw)
	if err != nil {
		return Question{}, err
	}
	return tst.Questions[0], nil
}

func mustDecodeQ(t *testing.T, q Question) Question {
	t.Helper()
	got, err := decodeQ(t, q)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// testOf decodes a test of the one question.
func testOf(t *testing.T, q Question) Test {
	t.Helper()
	return Test{Questions: []Question{mustDecodeQ(t, q)}}
}

func tf(opts ...Option) Question {
	return Question{ID: "q1", Type: "truefalse", Text: rj("Q"), Points: 2, Options: opts}
}

func grid(targets []Target, opts ...Option) Question {
	return Question{ID: "q1", Type: "grid", Text: rj("Q"), Points: 3, Targets: targets, Options: opts}
}

func stmt(id, text string, correct bool) Option {
	return Option{ID: id, Content: rj(text), Correct: correct}
}

func row(id, text, target string) Option {
	return Option{ID: id, Content: rj(text), Target: target}
}

func col(id, text string) Target { return Target{ID: id, Content: rj(text)} }

func TestDecodeDropsUnusedFields(t *testing.T) {
	q := mustDecodeQ(t, Question{
		ID: "q1", Type: "single", Text: rj("Q"), Points: 1, Partial: true,
		Options: []Option{{ID: "a", Content: rj("a"), Correct: true, Target: "t1"}, stmt("b", "b", false)},
		Targets: []Target{col("t1", "x")}, Body: rj("body"), Accepted: []string{"x"}, Rubric: "r",
		Gaps: []Gap{{ID: "g1"}}, Image: &Image{Src: strings.Repeat("a", 64) + ".png", W: 1, H: 1},
		Areas: []Area{{ID: "a1", Shape: "rect"}}, Match: &Match{}, Number: &NumberKey{Mode: "exact"},
	})
	want := Question{
		ID: "q1", Type: "single", Text: q.Text, Points: 1,
		Options: []Option{{ID: "a", Content: q.Options[0].Content, Correct: true}, {ID: "b", Content: q.Options[1].Content}},
	}
	if !reflect.DeepEqual(q, want) {
		t.Fatalf("question = %+v, want %+v", q, want)
	}
}

func TestDecodeKeepsFieldsOfItsType(t *testing.T) {
	q := mustDecodeQ(t, grid([]Target{col("c1", "A"), col("c2", "B")}, row("r1", "x", "c1")))
	if len(q.Targets) != 2 || q.Options[0].Target != "c1" {
		t.Fatalf("grid lost fields: %+v", q)
	}
}

func TestDecodeAcceptsEveryTypeID(t *testing.T) {
	for _, id := range strings.Fields("single multi truefalse grid short number gaps order match groups bank hotspot label highlight open") {
		if _, err := decodeQ(t, Question{ID: "q1", Type: id, Points: 1}); err != nil {
			t.Errorf("%s: %v", id, err)
		}
	}
}

func TestDecodeClearsDanglingTarget(t *testing.T) {
	q := mustDecodeQ(t, grid([]Target{col("c1", "A"), col("c2", "B")}, row("r1", "x", "zz"), row("r2", "y", "c2")))
	if q.Options[0].Target != "" || q.Options[1].Target != "c2" {
		t.Fatalf("targets = %q, %q", q.Options[0].Target, q.Options[1].Target)
	}
}

func TestDecodeRejectsDuplicateIDs(t *testing.T) {
	repeatedGap := gapsQ(Gap{ID: "g1"})
	repeatedGap.Gaps = append(repeatedGap.Gaps, Gap{ID: "g1"})
	cols := []Target{col("c1", "A"), col("c2", "B")}
	for name, q := range map[string]Question{
		"options": tf(stmt("o1", "a", true), stmt("o1", "b", false)),
		"targets": grid([]Target{col("t1", "A"), col("t1", "B")}, row("r1", "x", "t1")),
		"gaps":    repeatedGap,
		"choices": gapsQ(Gap{ID: "g1", Choices: []Choice{{ID: "c"}, {ID: "c"}}}),
		"areas":   {ID: "q1", Type: "hotspot", Points: 1, Areas: []Area{{ID: "a"}, {ID: "a"}}},
	} {
		if _, err := decodeQ(t, q); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
	if _, err := decodeQ(t, grid(cols, row("r1", "x", "c1"), row("r2", "y", "c1"))); err != nil {
		t.Errorf("a shared target is fine: %v", err)
	}
}

func TestDecodeRejectsOversize(t *testing.T) {
	var many []Option
	for i := range 51 {
		many = append(many, stmt("o"+string(rune('A'+i/26))+string(rune('a'+i%26)), "x", false))
	}
	long := strings.Repeat("я", 201)
	img := strings.Repeat("a", 64)
	for name, q := range map[string]Question{
		"51 options":      tf(many...),
		"long accepted":   {ID: "q1", Type: "short", Points: 1, Accepted: []string{long}},
		"51 accepted":     {ID: "q1", Type: "short", Points: 1, Accepted: slices.Repeat([]string{"x"}, 51)},
		"long gap text":   gapsQ(Gap{ID: "g", Accepted: []string{long}}),
		"long choice":     gapsQ(Gap{ID: "g", Choices: []Choice{{ID: "c", Text: long}}}),
		"long rubric":     {ID: "q1", Type: "open", Points: 1, Rubric: strings.Repeat("я", 2001)},
		"target x":        grid([]Target{{ID: "c1", X: 1.1}}, row("r1", "x", "c1")),
		"target y":        grid([]Target{{ID: "c1", Y: -0.1}}, row("r1", "x", "c1")),
		"area width":      {ID: "q1", Type: "hotspot", Points: 1, Areas: []Area{{ID: "a", Shape: "rect", W: 2}}},
		"target bad img":  grid([]Target{{ID: "c1", Image: &Image{Src: "x.png", W: 1, H: 1}}}),
		"question no img": {ID: "q1", Type: "hotspot", Points: 1, Image: &Image{Src: img + ".mp3", W: 1, H: 1}},
	} {
		if _, err := decodeQ(t, q); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
	ok := Question{ID: "q1", Type: "short", Points: 1, Accepted: []string{strings.Repeat("я", 200)}}
	if _, err := decodeQ(t, ok); err != nil {
		t.Errorf("200 runes: %v", err)
	}
}

func TestMediaListsTargetAndQuestionImages(t *testing.T) {
	a, b := strings.Repeat("a", 64)+".png", strings.Repeat("b", 64)+".png"
	tst := Test{Questions: []Question{{
		ID: "q1", Image: &Image{Src: a, W: 1, H: 1}, Targets: []Target{{ID: "t", Image: &Image{Src: b, W: 1, H: 1}}},
	}}}
	if got := tst.Media(); !slices.Equal(got, []string{a, b}) {
		t.Errorf("Media() = %v", got)
	}
}

func TestPlainText(t *testing.T) {
	q := Question{Type: "gaps", Text: rj("Intro"), Body: rj("Body")}
	if got := q.PlainText(); got != "Intro\nBody" {
		t.Errorf("PlainText() = %q", got)
	}
	if got := (Question{Type: "single", Text: rj("Only")}).PlainText(); got != "Only" {
		t.Errorf("PlainText() = %q", got)
	}
}

func TestProblemsTrueFalseGrid(t *testing.T) {
	ps := wantCodes(t, testOf(t, tf()), "too_few_options")
	if ps[0].Count != 1 || ps[0].Severity != "error" {
		t.Errorf("tf problem = %+v", ps[0])
	}
	// No statement needs to be true.
	wantCodes(t, testOf(t, tf(stmt("s1", "a", false))))

	ps = wantCodes(t, testOf(t, grid([]Target{col("c1", "A")}, row("r1", "x", "c1"))), "too_few_targets")
	if ps[0].Count != 2 || ps[0].Severity != "error" {
		t.Errorf("grid problem = %+v", ps[0])
	}

	cols := []Target{col("c1", "A"), col("c2", "B")}
	ps = wantCodes(t, testOf(t, grid(cols, row("r1", "x", "c1"), row("r2", "y", ""))), "no_target")
	if ps[0].Severity != "error" {
		t.Errorf("no_target severity = %s", ps[0].Severity)
	}
	wantCodes(t, testOf(t, grid(cols)), "too_few_options")

	img := &Image{Src: strings.Repeat("a", 64) + ".png", W: 1, H: 1}
	wantCodes(t, testOf(t, tf(Option{ID: "s1", Content: rj(""), Image: img}, stmt("s2", "b", true))))
	ps = wantCodes(t, testOf(t, tf(stmt("s1", "", false), stmt("s2", "b", true))), "empty_option")
	if ps[0].Severity != "warning" {
		t.Errorf("empty_option severity = %s", ps[0].Severity)
	}
	wantCodes(t, testOf(t, grid([]Target{col("c1", "A"), col("c2", "")}, row("r1", "x", "c1"))), "empty_option")
}

func TestCleanAnswerTrueFalseGrid(t *testing.T) {
	q := mustDecodeQ(t, tf(stmt("s1", "a", true), stmt("s2", "b", false)))
	got, ok := q.CleanAnswer(Answer{Pairs: map[string]string{"s1": "true"}})
	if !ok || !reflect.DeepEqual(got, Answer{Pairs: map[string]string{"s1": "true"}}) {
		t.Errorf("valid tf answer: %+v, %v", got, ok)
	}
	for name, a := range map[string]Answer{
		"bad value":    {Pairs: map[string]string{"s1": "maybe"}},
		"unknown id":   {Pairs: map[string]string{"zz": "true"}},
		"case matters": {Pairs: map[string]string{"s1": "True"}},
	} {
		if _, ok := q.CleanAnswer(a); ok {
			t.Errorf("%s: want invalid", name)
		}
	}
	got, ok = q.CleanAnswer(Answer{Items: []string{"s1"}, Text: "x", Pairs: map[string]string{"s2": "false"}})
	if !ok || got.Items != nil || got.Text != "" || got.Pairs["s2"] != "false" {
		t.Errorf("other fields should drop: %+v, %v", got, ok)
	}

	g := mustDecodeQ(t, grid([]Target{col("c1", "A"), col("c2", "B")}, row("r1", "x", "c1")))
	if _, ok := g.CleanAnswer(Answer{Pairs: map[string]string{"r1": "c2"}}); !ok {
		t.Error("a grid answer may differ from the key")
	}
	for name, a := range map[string]Answer{
		"unknown target": {Pairs: map[string]string{"r1": "c9"}},
		"unknown row":    {Pairs: map[string]string{"r9": "c1"}},
	} {
		if _, ok := g.CleanAnswer(a); ok {
			t.Errorf("%s: want invalid", name)
		}
	}
}

func TestCleanAnswerPick(t *testing.T) {
	q := Question{Type: "multi", Options: []Option{{ID: "a"}, {ID: "b"}}}
	got, ok := q.CleanAnswer(Answer{Items: []string{"a", "a", "b"}, Text: "x"})
	if !ok || !slices.Equal(got.Items, []string{"a", "b"}) || got.Text != "" {
		t.Errorf("got %+v, %v", got, ok)
	}
	if _, ok := q.CleanAnswer(Answer{Items: []string{"zz"}}); ok {
		t.Error("an unknown option id must be invalid")
	}
}

func TestCleanAnswerRejectsUnknownType(t *testing.T) {
	if _, ok := (Question{Type: "essay"}).CleanAnswer(Answer{}); ok {
		t.Error("want invalid")
	}
}
