package sitting

import (
	"slices"

	"klats/internal/testfmt"
)

// questionsFor returns the questions the participant gets, in the order they
// see them, fixed by the participant id so that a reload or a move to another
// device shows the same ones. With a [testfmt.Settings.Subset] of 1 to n−1 it
// draws that many, kept in test order unless ShuffleQuestions; with
// ShuffleQuestions alone it returns every question in an order of the
// participant's own; otherwise it returns the test's questions.
func questionsFor(t testfmt.Test, participantID string) []testfmt.Question {
	n, s := len(t.Questions), t.Settings
	subset := s.Subset > 0 && s.Subset < n
	if !subset && !s.ShuffleQuestions {
		return t.Questions
	}
	idx := make([]int, n)
	for i := range idx {
		idx[i] = i
	}
	shuffle(idx, participantID+"#q")
	if subset {
		idx = idx[:s.Subset]
		if !s.ShuffleQuestions {
			slices.Sort(idx)
		}
	}
	qs := make([]testfmt.Question, len(idx))
	for i, j := range idx {
		qs[i] = t.Questions[j]
	}
	return qs
}

// testOf returns the sitting's test snapshot with only the participant's own
// questions, in their order. Grading always goes through it.
func (a *active) testOf(p *participant) testfmt.Test {
	t := a.test
	t.Questions = p.questions
	return t
}
