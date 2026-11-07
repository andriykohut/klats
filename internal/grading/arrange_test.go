package grading

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"github.com/andriykohut/klats/internal/testfmt"
)

func orderQ(partial bool) testfmt.Question {
	return testfmt.Question{ID: "q", Type: "order", Points: 3, Partial: partial,
		Options: []testfmt.Option{{ID: "a"}, {ID: "b"}, {ID: "c"}, {ID: "d"}}}
}

func items(ids string) testfmt.Answer {
	var a testfmt.Answer
	for _, r := range ids {
		a.Items = append(a.Items, string(r))
	}
	return a
}

func TestLis(t *testing.T) {
	for _, c := range []struct {
		in   []int
		want []bool
	}{
		{nil, []bool{}},
		{[]int{0, 1, 2}, []bool{true, true, true}},
		{[]int{2, 1, 0}, []bool{true, false, false}},
		{[]int{1, 0}, []bool{true, false}},
		{[]int{1, 2, 0, 3}, []bool{true, true, false, true}},
		{[]int{3, 1, 2, 0, 4}, []bool{false, true, true, false, true}},
		{[]int{0, 3, 1, 2}, []bool{true, false, true, true}},
	} {
		if got := lis(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("lis(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestJudgeOrder(t *testing.T) {
	for _, c := range []struct {
		answer  string
		partial bool
		want    float64
	}{
		{"abcd", true, 3}, {"bacd", true, 2}, {"dcba", true, 0}, {"bacd", false, 0}, {"abcd", false, 3},
	} {
		near(t, Judge(orderQ(c.partial), items(c.answer)).Points, c.want)
	}
	near(t, Judge(orderQ(true), testfmt.Answer{}).Points, 0)
}

func TestJudgeOrderVerdicts(t *testing.T) {
	v := Judge(orderQ(true), items("bcad"))
	want := map[string]bool{"a": false, "b": true, "c": true, "d": true}
	if !reflect.DeepEqual(v.Items, want) {
		t.Errorf("items = %v, want %v", v.Items, want)
	}
	near(t, v.Points, 2)
}

func TestJudgeOrderIncompleteAnswerEarnsNothing(t *testing.T) {
	if got := Judge(orderQ(true), items("abzd")); got.Points != 0 || len(got.Items) != 0 {
		t.Errorf("got %+v", got)
	}
}

func matchQ(partial bool) testfmt.Question {
	return testfmt.Question{ID: "q", Type: "match", Points: 3, Partial: partial,
		Options: []testfmt.Option{{ID: "l1", Target: "r1"}, {ID: "l2", Target: "r2"}, {ID: "l3", Target: "r3"}},
		Targets: []testfmt.Target{{ID: "r1"}, {ID: "r2"}, {ID: "r3"}, {ID: "x"}}}
}

func TestJudgeMatch(t *testing.T) {
	v := Judge(matchQ(true), testfmt.Answer{Pairs: map[string]string{"l1": "r1", "l2": "r2", "l3": "x"}})
	near(t, v.Points, 1)
	if !reflect.DeepEqual(v.Items, map[string]bool{"l1": true, "l2": true, "l3": false}) {
		t.Errorf("items = %v", v.Items)
	}
	all := testfmt.Answer{Pairs: map[string]string{"l1": "r1", "l2": "r2", "l3": "r3"}}
	near(t, Judge(matchQ(false), all).Points, 3)
	near(t, Judge(matchQ(false), testfmt.Answer{Pairs: map[string]string{"l1": "r1"}}).Points, 0)
}

func TestJudgeGroups(t *testing.T) {
	q := testfmt.Question{ID: "q", Type: "groups", Points: 2, Partial: true,
		Options: []testfmt.Option{{ID: "i1", Target: "g1"}, {ID: "i2", Target: "g1"}, {ID: "i3", Target: "g2"}, {ID: "i4", Target: "g2"}},
		Targets: []testfmt.Target{{ID: "g1"}, {ID: "g2"}}}
	near(t, Judge(q, testfmt.Answer{Pairs: map[string]string{"i1": "g1", "i2": "g1", "i3": "g2"}}).Points, 1.5)
}

func inline(s string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q}]}]}`, s))
}

func bankQ(partial bool) testfmt.Question {
	return testfmt.Question{ID: "q", Type: "bank", Points: 2, Partial: partial,
		Options: []testfmt.Option{
			{ID: "w1", Target: "g1", Content: inline("the")},
			{ID: "w2", Target: "g2", Content: inline(" the ")},
			{ID: "w3", Target: "g3", Content: inline("cat")},
			{ID: "d1", Content: inline("dog")},
		}}
}

func TestJudgeBankEqualWords(t *testing.T) {
	q := bankQ(false)
	q.Options = q.Options[:2]
	v := Judge(q, testfmt.Answer{Pairs: map[string]string{"g1": "w2", "g2": "w1"}})
	near(t, v.Points, 2)
	if !reflect.DeepEqual(v.Items, map[string]bool{"g1": true, "g2": true}) {
		t.Errorf("items = %v", v.Items)
	}
}

func TestJudgeBankPartialAndDecoy(t *testing.T) {
	v := Judge(bankQ(true), testfmt.Answer{Pairs: map[string]string{"g1": "w1", "g2": "d1"}})
	near(t, v.Points, 0)
	if !reflect.DeepEqual(v.Items, map[string]bool{"g1": true, "g2": false}) {
		t.Errorf("items = %v", v.Items)
	}
	near(t, Judge(bankQ(true), testfmt.Answer{Pairs: map[string]string{"g1": "w1", "g3": "w3"}}).Points, 2.0*2/3)
	near(t, Judge(bankQ(false), testfmt.Answer{Pairs: map[string]string{"g1": "w1", "g3": "w3"}}).Points, 0)
	near(t, Judge(bankQ(false), testfmt.Answer{Pairs: map[string]string{"g1": "w2", "g2": "w1", "g3": "w3"}}).Points, 2)
}

func TestJudgeBankWordsWithoutTextAreNotEqual(t *testing.T) {
	q := bankQ(false)
	q.Options = []testfmt.Option{{ID: "w1", Target: "g1"}, {ID: "w2", Target: "g2"}}
	near(t, Judge(q, testfmt.Answer{Pairs: map[string]string{"g1": "w2", "g2": "w1"}}).Points, 0)
}
