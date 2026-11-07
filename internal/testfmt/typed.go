package testfmt

import (
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/andriykohut/klats/internal/rich"
)

// shortProblems reports the findings of a short text question: it needs an
// accepted answer, and a lone one is worth a hint because typed text varies.
func shortProblems(q Question, add report) {
	switch countFilled(q.Accepted) {
	case 0:
		add("no_accepted", "error", 0)
	case 1:
		add("one_accepted", "info", 0)
	}
}

// numberProblems reports the findings of a number question: the key must be
// one of the modes, with a tolerance of 0 or more and a range that is not
// reversed.
func numberProblems(q Question, add report) {
	k := q.Number
	valid := k != nil
	if valid {
		switch k.Mode {
		case "exact":
		case "tolerance":
			valid = k.Tolerance >= 0
		case "range":
			valid = k.Min <= k.Max
		default:
			valid = false
		}
	}
	if !valid {
		add("no_number", "error", 0)
	}
}

// gapsProblems reports the findings of a gaps question: it needs a gap, and
// each gap, counted from 1 in body order, needs an answer a student can give.
func gapsProblems(q Question, add report) {
	if len(q.Gaps) == 0 {
		add("no_gaps", "error", 0)
	}
	for i, g := range q.Gaps {
		if !gapAnswerable(g) {
			add("gap_no_answer", "error", i+1)
		}
	}
}

// gapAnswerable reports whether a student can answer the gap right: a typed
// gap needs an accepted text, and a list gap two choices with one correct.
func gapAnswerable(g Gap) bool {
	if len(g.Choices) == 0 {
		return countFilled(g.Accepted) > 0
	}
	return len(g.Choices) >= 2 && slices.ContainsFunc(g.Choices, func(c Choice) bool { return c.Correct })
}

// countFilled counts the texts that are not blank.
func countFilled(texts []string) int {
	n := 0
	for _, s := range texts {
		if strings.TrimSpace(s) != "" {
			n++
		}
	}
	return n
}

// cleanText validates the answer of a short text or number question: its text
// is at most 200 characters.
func cleanText(_ Question, a Answer) (Answer, bool) {
	if utf8.RuneCountInString(a.Text) > maxTextRunes {
		return Answer{}, false
	}
	return Answer{Text: a.Text}, true
}

// cleanGaps validates the answer of a gaps question: each pair maps a gap to
// one of its choice ids, or for a typed gap to text of at most 200 characters.
func cleanGaps(q Question, a Answer) (Answer, bool) {
	for id, v := range a.Pairs {
		i := slices.IndexFunc(q.Gaps, func(g Gap) bool { return g.ID == id })
		if i < 0 {
			return Answer{}, false
		}
		g := q.Gaps[i]
		if len(g.Choices) == 0 {
			if utf8.RuneCountInString(v) > maxTextRunes {
				return Answer{}, false
			}
		} else if !slices.ContainsFunc(g.Choices, func(c Choice) bool { return c.ID == v }) {
			return Answer{}, false
		}
	}
	return Answer{Pairs: a.Pairs}, true
}

// syncGaps makes Gaps list exactly the gap nodes of the body, in body order. A
// gap whose node is gone is dropped and a node without an entry gets an empty
// one. It rejects a list that is too long or repeats an id before the sync; the
// caller checks the synced list the same way, since a body with many gap nodes
// lengthens it.
func (q *Question) syncGaps() error {
	if err := checkIDs("gaps", q.Gaps, func(g Gap) string { return g.ID }); err != nil {
		return err
	}
	doc, err := rich.Parse(q.Body, rich.Gapped)
	if err != nil {
		return err
	}
	var gaps []Gap
	for _, id := range doc.GapIDs() {
		i := slices.IndexFunc(q.Gaps, func(g Gap) bool { return g.ID == id })
		if i < 0 {
			gaps = append(gaps, Gap{ID: id})
		} else {
			gaps = append(gaps, q.Gaps[i])
		}
	}
	q.Gaps = gaps
	return nil
}
