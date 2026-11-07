package grading

import (
	"strconv"

	"github.com/andriykohut/klats/internal/testfmt"
)

// judgeHighlight judges a highlight answer as a multiple choice answer over
// the words of the body (see [testfmt.Question.Words]), the marked ones being
// correct: with Partial, points * max(0, (c - w) / C) for c marked and w other
// chosen words and C marked words; without, all points only for exactly the
// marked words. The verdict holds each chosen word, as whether it is marked.
func judgeHighlight(q testfmt.Question, a testfmt.Answer) Verdict {
	_, words := q.Words()
	multi := testfmt.Question{Type: "multi", Points: q.Points, Partial: q.Partial, Options: make([]testfmt.Option, len(words))}
	for i, w := range words {
		multi.Options[i] = testfmt.Option{ID: strconv.Itoa(i), Correct: w.Target}
	}
	return judgePick(multi, a)
}

// IsPending reports whether the answer waits for the teacher: the question
// takes a written answer, the answer is not blank and the teacher has not set
// its points (overridden). Such an answer scores 0 until then.
func IsPending(q testfmt.Question, a testfmt.Answer, overridden bool) bool {
	return q.Type == "open" && !a.IsEmpty() && !overridden
}
