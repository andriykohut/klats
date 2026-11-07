package sitting

import (
	"slices"

	"github.com/andriykohut/klats/internal/testfmt"
)

// questionsFor returns the questions the participant gets, in the order they
// see them, fixed by the participant id so that a reload or a move to another
// device shows the same ones. With a [testfmt.Settings.Draw] it returns the
// questions its lines pick, kept in test order unless ShuffleQuestions; with
// ShuffleQuestions alone it returns every question in an order of the
// participant's own; otherwise it returns the test's questions.
func questionsFor(t testfmt.Test, participantID string) []testfmt.Question {
	s := t.Settings
	if len(s.Draw) == 0 && !s.ShuffleQuestions {
		return t.Questions
	}
	idx := make([]int, len(t.Questions))
	for i := range idx {
		idx[i] = i
	}
	shuffle(idx, participantID+"#q")
	if len(s.Draw) > 0 {
		// Each line takes the first of its questions in the shuffled order, and
		// idx keeps that order so a shuffled sitting mixes the lines. The lines
		// from all questions go last, so they cannot take a tag line's questions.
		picked := make([]bool, len(idx))
		for _, fromAll := range []bool{false, true} {
			for _, l := range s.Draw {
				if (l.Tag == "") != fromAll {
					continue
				}
				n := 0
				for _, i := range idx {
					if n < l.Count && !picked[i] && (l.Tag == "" || slices.Contains(t.Questions[i].Tags, l.Tag)) {
						picked[i] = true
						n++
					}
				}
			}
		}
		idx = slices.DeleteFunc(idx, func(i int) bool { return !picked[i] })
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
