package grading

import (
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/andriykohut/klats/internal/testfmt"
)

func orderQ(ids string, partial bool) testfmt.Question {
	q := testfmt.Question{ID: "q", Type: "order", Points: 3, Partial: partial}
	for _, id := range items(ids).Items {
		q.Options = append(q.Options, testfmt.Option{ID: id})
	}
	return q
}

func items(ids string) testfmt.Answer {
	var a testfmt.Answer
	for _, r := range ids {
		a.Items = append(a.Items, string(r))
	}
	return a
}

func TestJudgeOrder(t *testing.T) {
	for _, c := range []struct {
		options, answer string
		partial         bool
		points          float64
		// inOrder holds the options the verdict marks right: the longest
		// subsequence in the key's order, the earliest one when several are
		// longest. It marks the answer's other options wrong. "" means no
		// verdict.
		inOrder string
	}{
		{"abcd", "abcd", true, 3, "abcd"},
		{"abcd", "abcd", false, 3, "abcd"},
		{"abcd", "bacd", true, 2, "bcd"},
		{"abcd", "bacd", false, 0, "bcd"},
		{"abcd", "bcad", true, 2, "bcd"},
		{"abcd", "adbc", true, 2, "abc"},
		{"abcd", "dcba", true, 0, "d"},
		{"abc", "abc", true, 3, "abc"},
		{"abc", "cba", true, 0, "c"},
		{"ab", "ba", true, 0, "b"},
		{"abcde", "dbcae", true, 1.5, "bce"},
		{"abcd", "", true, 0, ""},
		{"abcd", "abzd", true, 0, ""},
	} {
		v := Judge(orderQ(c.options, c.partial), items(c.answer))
		want := map[string]bool{}
		if c.inOrder != "" {
			for _, id := range items(c.answer).Items {
				want[id] = strings.Contains(c.inOrder, id)
			}
		}
		if math.Abs(v.Points-c.points) > 1e-9 || !maps.Equal(v.Items, want) {
			t.Errorf("%q on %s, partial %v: got %v %v, want %v %v", c.answer, c.options, c.partial, v.Points, v.Items, c.points, want)
		}
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

func bankQ(partial bool, words ...testfmt.Option) testfmt.Question {
	return testfmt.Question{ID: "q", Type: "bank", Points: 2, Partial: partial, Options: words}
}

func TestJudgeBank(t *testing.T) {
	w1 := testfmt.Option{ID: "w1", Target: "g1", Content: inline("the")}
	w2 := testfmt.Option{ID: "w2", Target: "g2", Content: inline(" the ")}
	w3 := testfmt.Option{ID: "w3", Target: "g3", Content: inline("cat")}
	d1 := testfmt.Option{ID: "d1", Content: inline("dog")}
	for _, c := range []struct {
		q      testfmt.Question
		answer testfmt.Answer
		points float64
		items  map[string]bool
	}{
		// Equal words swap freely, but words without text, such as pictures,
		// are equal only to themselves.
		{bankQ(false, w1, w2), pairs("g1", "w2", "g2", "w1"), 2, map[string]bool{"g1": true, "g2": true}},
		{bankQ(false, testfmt.Option{ID: "w1", Target: "g1"}, testfmt.Option{ID: "w2", Target: "g2"}), pairs("g1", "w2", "g2", "w1"), 0, map[string]bool{"g1": false, "g2": false}},
		{bankQ(true, w1, w2, w3, d1), pairs("g1", "w1", "g2", "d1"), 0, map[string]bool{"g1": true, "g2": false}},
		{bankQ(true, w1, w2, w3, d1), pairs("g1", "w1", "g3", "w3"), 2.0 * 2 / 3, map[string]bool{"g1": true, "g3": true}},
		{bankQ(false, w1, w2, w3, d1), pairs("g1", "w1", "g3", "w3"), 0, map[string]bool{"g1": true, "g3": true}},
		{bankQ(false, w1, w2, w3, d1), pairs("g1", "w2", "g2", "w1", "g3", "w3"), 2, map[string]bool{"g1": true, "g2": true, "g3": true}},
	} {
		v := Judge(c.q, c.answer)
		if math.Abs(v.Points-c.points) > 1e-9 || !maps.Equal(v.Items, c.items) {
			t.Errorf("%v with %d words, partial %v: got %v %v, want %v %v", c.answer.Pairs, len(c.q.Options), c.q.Partial, v.Points, v.Items, c.points, c.items)
		}
	}
}
