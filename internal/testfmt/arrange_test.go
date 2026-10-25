package testfmt

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func orderQ(ids ...string) Question {
	q := Question{ID: "q1", Type: "order", Text: rj("Q"), Points: 2}
	for _, id := range ids {
		q.Options = append(q.Options, Option{ID: id, Content: rj(id)})
	}
	return q
}

func matchQ(rows []Option, targets ...string) Question {
	q := Question{ID: "q1", Type: "match", Text: rj("Q"), Points: 2, Options: rows}
	for _, id := range targets {
		q.Targets = append(q.Targets, col(id, id))
	}
	return q
}

func groupsQ(targets []Target, opts ...Option) Question {
	return Question{ID: "q1", Type: "groups", Text: rj("Q"), Points: 2, Targets: targets, Options: opts}
}

// bankQ makes a bank question whose body holds the gaps g1 to gN, with the words.
func bankQ(gaps int, words ...Option) Question {
	nodes := []string{`{"type":"text","text":"Q "}`}
	for i := 1; i <= gaps; i++ {
		nodes = append(nodes, fmt.Sprintf(`{"type":"gap","attrs":{"id":"g%d"}}`, i))
	}
	body := `{"type":"doc","content":[{"type":"paragraph","content":[` + strings.Join(nodes, ",") + `]}]}`
	return Question{ID: "q1", Type: "bank", Points: 2, Body: json.RawMessage(body), Options: words}
}

func TestProblemsArrange(t *testing.T) {
	ps := wantCodes(t, testOf(t, orderQ("a")), "too_few_options")
	if ps[0].Count != 2 || ps[0].Severity != "error" {
		t.Errorf("order problem = %+v", ps[0])
	}
	wantCodes(t, testOf(t, orderQ("a", "b")))
	blank := orderQ("a", "b")
	blank.Options[1].Content = rj("")
	wantCodes(t, testOf(t, blank), "empty_option")

	rows := []Option{row("l1", "x", "r1"), row("l2", "y", "r2")}
	wantCodes(t, testOf(t, matchQ(rows, "r1", "r2", "decoy")))
	wantCodes(t, testOf(t, matchQ(rows[:1], "r1")), "too_few_options")
	wantCodes(t, testOf(t, matchQ([]Option{rows[0], row("l2", "y", "")}, "r1", "r2")), "no_target")

	two := []Target{col("g1", "A"), col("g2", "B")}
	ps = wantCodes(t, testOf(t, groupsQ(two[:1], row("i1", "x", "g1"), row("i2", "y", "g1"))), "too_few_targets")
	if ps[0].Count != 2 || ps[0].Severity != "error" {
		t.Errorf("groups problem = %+v", ps[0])
	}
	wantCodes(t, testOf(t, groupsQ(two, row("i1", "x", "g1"))), "too_few_options")
	wantCodes(t, testOf(t, groupsQ(two, row("i1", "x", "g1"), row("i2", "y", ""))), "no_target")
	wantCodes(t, testOf(t, groupsQ(two, row("i1", "x", "g1"), row("i2", "y", "g2"))))

	words := []Option{row("w1", "a", "g1"), row("w2", "b", "g2"), row("d", "c", "")}
	wantCodes(t, testOf(t, bankQ(2, words...)))
	ps = wantCodes(t, testOf(t, bankQ(3, words...)), "gap_no_answer")
	if ps[0].Count != 3 || ps[0].Severity != "error" {
		t.Errorf("bank problem = %+v", ps[0])
	}
	wantCodes(t, testOf(t, bankQ(2, words[0], row("w2", "", "g2"))), "empty_option")
	wantCodes(t, testOf(t, bankQ(0, words[2])), "no_gaps")
}

func TestDecodeRejectsTwoWordsForOneGap(t *testing.T) {
	if _, err := decodeQ(t, bankQ(2, row("w1", "a", "g1"), row("w2", "b", "g1"))); err == nil {
		t.Error("two words for g1 must be rejected")
	}
	if _, err := decodeQ(t, bankQ(2, row("w1", "a", "g1"), row("w2", "b", "g2"), row("d1", "c", ""), row("d2", "d", ""))); err != nil {
		t.Errorf("decoys share the empty target: %v", err)
	}
	// A target that names no gap is cleared before the check.
	if _, err := decodeQ(t, bankQ(1, row("w1", "a", "zz"), row("w2", "b", "zz"))); err != nil {
		t.Errorf("dangling targets are decoys: %v", err)
	}
}

func TestCleanAnswerArrange(t *testing.T) {
	order := mustDecodeQ(t, orderQ("a", "b", "c"))
	got, ok := order.CleanAnswer(Answer{Items: []string{"c", "a", "b"}, Text: "x"})
	if !ok || len(got.Items) != 3 || got.Text != "" {
		t.Errorf("valid order: %+v, %v", got, ok)
	}
	for name, items := range map[string][]string{
		"missing":  {"a", "b"},
		"repeated": {"a", "a", "b"},
		"unknown":  {"a", "b", "z"},
		"empty":    nil,
		"extra":    {"a", "b", "c", "a"},
	} {
		if _, ok := order.CleanAnswer(Answer{Items: items}); ok {
			t.Errorf("order %s: want invalid", name)
		}
	}

	m := mustDecodeQ(t, matchQ([]Option{row("l1", "x", "r1"), row("l2", "y", "r2")}, "r1", "r2", "decoy"))
	if _, ok := m.CleanAnswer(Answer{Pairs: map[string]string{"l1": "decoy", "l2": "r1"}}); !ok {
		t.Error("a match answer may differ from the key")
	}
	if _, ok := m.CleanAnswer(Answer{Pairs: map[string]string{"l1": "r1"}}); !ok {
		t.Error("a partial match answer is valid")
	}
	for name, p := range map[string]map[string]string{
		"target twice":   {"l1": "r1", "l2": "r1"},
		"unknown target": {"l1": "zz"},
		"unknown left":   {"zz": "r1"},
	} {
		if _, ok := m.CleanAnswer(Answer{Pairs: p}); ok {
			t.Errorf("match %s: want invalid", name)
		}
	}

	g := mustDecodeQ(t, groupsQ([]Target{col("g1", "A"), col("g2", "B")}, row("i1", "x", "g1"), row("i2", "y", "g2")))
	if _, ok := g.CleanAnswer(Answer{Pairs: map[string]string{"i1": "g2", "i2": "g2"}}); !ok {
		t.Error("items may share a group")
	}
	if _, ok := g.CleanAnswer(Answer{Pairs: map[string]string{"i1": "zz"}}); ok {
		t.Error("an unknown group must be invalid")
	}

	b := mustDecodeQ(t, bankQ(2, row("w1", "a", "g1"), row("w2", "b", "g2"), row("d", "c", "")))
	if _, ok := b.CleanAnswer(Answer{Pairs: map[string]string{"g1": "d", "g2": "w1"}}); !ok {
		t.Error("a bank answer may differ from the key")
	}
	for name, p := range map[string]map[string]string{
		"word twice":   {"g1": "w1", "g2": "w1"},
		"unknown word": {"g1": "zz"},
		"unknown gap":  {"g9": "w1"},
	} {
		if _, ok := b.CleanAnswer(Answer{Pairs: p}); ok {
			t.Errorf("bank %s: want invalid", name)
		}
	}
}
