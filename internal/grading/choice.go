package grading

import (
	"math"

	"klats/internal/testfmt"
)

// judgePick judges a single or multiple choice answer. A single question earns
// full points only for exactly the one correct option. A multi question earns
// full points only for an exact set, or, when Partial is set,
// points * max(0, (c - w) / C) for c correct picks, w wrong picks and C
// correct options. Unknown option ids are ignored and duplicates count once.
// The verdict holds each picked option, as whether it is correct. A question
// with no correct option earns 0.
func judgePick(q testfmt.Question, a testfmt.Answer) Verdict {
	known := make(map[string]bool, len(q.Options)) // option id -> correct
	totalCorrect := 0
	for _, o := range q.Options {
		known[o.ID] = o.Correct
		if o.Correct {
			totalCorrect++
		}
	}
	v := Verdict{Items: map[string]bool{}}
	c, w := 0, 0
	for _, id := range a.Items {
		correct, ok := known[id]
		if _, dup := v.Items[id]; !ok || dup {
			continue
		}
		v.Items[id] = correct
		if correct {
			c++
		} else {
			w++
		}
	}
	if totalCorrect == 0 {
		return v
	}

	points := float64(q.Points)
	switch {
	case q.Type == "multi" && q.Partial:
		v.Points = points * math.Max(0, float64(c-w)/float64(totalCorrect))
	case c == totalCorrect && w == 0:
		v.Points = points
	}
	return v
}

// judgeStatements judges a true/false answer: a statement is right when the
// student's "true" or "false" matches its Correct flag.
func judgeStatements(q testfmt.Question, a testfmt.Answer) Verdict {
	return judgePairs(q, a, func(o testfmt.Option) (string, bool) {
		if o.Correct {
			return "true", true
		}
		return "false", true
	})
}

// judgeGrid judges a choice grid answer: a row is right when it is mapped to
// its target. A row without a target is not judged.
func judgeGrid(q testfmt.Question, a testfmt.Answer) Verdict {
	return judgePairs(q, a, func(o testfmt.Option) (string, bool) { return o.Target, o.Target != "" })
}

// judgePairs judges an answer whose pairs map options to values. want gives an
// option's right value, and false for an option that is not judged. With N
// judged options, c right and w wrong answers, the points are
// points * max(0, (c - w) / N), or, without Partial, all points when c is N.
// The verdict holds each answered, judged option. Unanswered options count
// neither right nor wrong.
func judgePairs(q testfmt.Question, a testfmt.Answer, want func(testfmt.Option) (string, bool)) Verdict {
	v := Verdict{Items: map[string]bool{}}
	n, c, w := 0, 0, 0
	for _, o := range q.Options {
		right, judged := want(o)
		if !judged {
			continue
		}
		n++
		given, answered := a.Pairs[o.ID]
		if !answered {
			continue
		}
		v.Items[o.ID] = given == right
		if given == right {
			c++
		} else {
			w++
		}
	}
	switch {
	case n == 0:
	case q.Partial:
		v.Points = float64(q.Points) * math.Max(0, float64(c-w)/float64(n))
	case c == n:
		v.Points = float64(q.Points)
	}
	return v
}
