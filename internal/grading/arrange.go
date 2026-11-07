package grading

import (
	"slices"
	"sort"
	"strings"

	"github.com/andriykohut/klats/internal/rich"
	"github.com/andriykohut/klats/internal/testfmt"
)

// lis marks the members of one longest strictly increasing subsequence of
// positions, which must hold distinct values. When several subsequences are
// longest it takes the one that starts earliest, and at each step the
// earliest next member.
func lis(positions []int) []bool {
	n := len(positions)
	// startLen[i] is the length of the longest increasing subsequence that
	// starts at i. Scanning from the right, that is a longest decreasing one,
	// found as an increasing one on the negated values.
	startLen := make([]int, n)
	var tails []int
	for i := n - 1; i >= 0; i-- {
		v := -positions[i]
		k := sort.SearchInts(tails, v)
		if k == len(tails) {
			tails = append(tails, v)
		} else {
			tails[k] = v
		}
		startLen[i] = k + 1
	}
	marked := make([]bool, n)
	want, last := len(tails), 0
	for i := range n {
		if want > 0 && startLen[i] == want && (want == len(tails) || positions[i] > last) {
			marked[i] = true
			last = positions[i]
			want--
		}
	}
	return marked
}

// judgeOrder judges an ordering answer. Ids that are unknown or repeated are
// ignored, and an answer that then lacks an option earns 0 and has no verdict.
// ([testfmt.Question.CleanAnswer] rejects such answers before they are
// stored.) With n options, of which L belong to a longest subsequence of the
// answer that is in the key's order, the points are
// points * (L - 1) / (n - 1), or, without Partial, all points when L is n.
// The verdict holds each option, as whether it is in that subsequence.
func judgeOrder(q testfmt.Question, a testfmt.Answer) Verdict {
	n := len(q.Options)
	var positions []int
	for _, id := range a.Items {
		i := slices.IndexFunc(q.Options, func(o testfmt.Option) bool { return o.ID == id })
		if i >= 0 && !slices.Contains(positions, i) {
			positions = append(positions, i)
		}
	}
	if n < 2 || len(positions) != n {
		return Verdict{}
	}
	v := Verdict{Items: make(map[string]bool, n)}
	longest := 0
	for i, in := range lis(positions) {
		v.Items[q.Options[positions[i]].ID] = in
		if in {
			longest++
		}
	}
	switch {
	case q.Partial:
		v.Points = float64(q.Points) * float64(longest-1) / float64(n-1)
	case longest == n:
		v.Points = float64(q.Points)
	}
	return v
}

// judgeBank judges a word bank answer: a gap is right when its word has the
// same text as the word that belongs there, so equal words swap freely. A word
// whose target is empty is a decoy, right only where its text equals the
// expected word's. With N gaps that have a word, c right and w wrong answers,
// the points are points * max(0, (c - w) / N), or, without Partial, all points
// when c is N.
// The verdict holds each filled gap.
func judgeBank(q testfmt.Question, a testfmt.Answer) Verdict {
	v := Verdict{Items: map[string]bool{}}
	n, c, w := 0, 0, 0
	for _, o := range q.Options {
		if o.Target == "" {
			continue
		}
		n++
		given, filled := a.Pairs[o.Target]
		i := slices.IndexFunc(q.Options, func(p testfmt.Option) bool { return p.ID == given })
		if !filled || i < 0 {
			continue
		}
		right := wordKey(q.Options[i]) == wordKey(o)
		v.Items[o.Target] = right
		if right {
			c++
		} else {
			w++
		}
	}
	v.Points = partialPoints(q, n, c, w)
	return v
}

// wordKey is the text two bank words are compared by: the plain text with
// spaces collapsed. A word without text, such as a picture, is only equal to
// itself.
func wordKey(o testfmt.Option) string {
	if doc, err := rich.Parse(o.Content, rich.Inline); err == nil {
		if text := strings.Join(strings.Fields(doc.PlainText()), " "); text != "" {
			return text
		}
	}
	return "\x00" + o.ID
}
