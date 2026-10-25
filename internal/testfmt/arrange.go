package testfmt

import (
	"fmt"
	"slices"

	"klats/internal/rich"
)

// orderProblems reports the findings of an ordering question: its options,
// listed in the correct order, need two items.
func orderProblems(q Question, add report) {
	if len(q.Options) < 2 {
		add("too_few_options", "error", 2)
	}
	if hasEmptyItem(q) {
		add("empty_option", "warning", 0)
	}
}

// matchProblems reports the findings of a matching question: options are the
// left side and targets the right side, which may hold decoys.
func matchProblems(q Question, add report) {
	if len(q.Options) < 2 {
		add("too_few_options", "error", 2)
	}
	// Decode clears a target that names no right-hand side.
	if slices.ContainsFunc(q.Options, func(o Option) bool { return o.Target == "" }) {
		add("no_target", "error", 0)
	}
	if hasEmptyItem(q) {
		add("empty_option", "warning", 0)
	}
}

// groupsProblems reports the findings of a grouping question: options are the
// items and targets the groups.
func groupsProblems(q Question, add report) {
	if len(q.Options) < 2 {
		add("too_few_options", "error", 2)
	}
	if len(q.Targets) < 2 {
		add("too_few_targets", "error", 2)
	}
	// Decode clears a target that names no group.
	if slices.ContainsFunc(q.Options, func(o Option) bool { return o.Target == "" }) {
		add("no_target", "error", 0)
	}
	if hasEmptyItem(q) {
		add("empty_option", "warning", 0)
	}
}

// bankProblems reports the findings of a word bank question: it needs a gap in
// its body, and each gap, counted from 1 in body order, needs a word. A word
// with an empty target is a decoy.
func bankProblems(q Question, add report) {
	gaps := q.bodyGapIDs()
	if len(gaps) == 0 {
		add("no_gaps", "error", 0)
	}
	for i, id := range gaps {
		if !slices.ContainsFunc(q.Options, func(o Option) bool { return o.Target == id }) {
			add("gap_no_answer", "error", i+1)
		}
	}
	if hasEmptyItem(q) {
		add("empty_option", "warning", 0)
	}
}

// bodyGapIDs returns the id of every gap node of the question's gapped body, in
// body order. An unparseable body has none.
func (q Question) bodyGapIDs() []string {
	doc, err := rich.Parse(q.Body, rich.Gapped)
	if err != nil {
		return nil
	}
	return doc.GapIDs()
}

// checkBankWords rejects a word bank whose gap has more than one word. Decoys
// all have an empty target.
func checkBankWords(q Question) error {
	seen := map[string]bool{}
	for _, o := range q.Options {
		if o.Target == "" {
			continue
		}
		if seen[o.Target] {
			return fmt.Errorf("gap %q has more than one word", o.Target)
		}
		seen[o.Target] = true
	}
	return nil
}

// cleanOrder validates the answer of an ordering question: its items are every
// option id exactly once.
func cleanOrder(q Question, a Answer) (Answer, bool) {
	if len(a.Items) != len(q.Options) {
		return Answer{}, false
	}
	for i, id := range a.Items {
		if !slices.ContainsFunc(q.Options, func(o Option) bool { return o.ID == id }) || slices.Contains(a.Items[:i], id) {
			return Answer{}, false
		}
	}
	return Answer{Items: a.Items}, true
}

// cleanMatch validates the answer of a matching question: each left item maps
// to a right-hand target, and no target is used twice.
func cleanMatch(q Question, a Answer) (Answer, bool) {
	if _, ok := cleanGrid(q, a); !ok || hasRepeatedValue(a.Pairs) {
		return Answer{}, false
	}
	return Answer{Pairs: a.Pairs}, true
}

// cleanBank validates the answer of a word bank question: each gap of the body
// maps to a word, and no word is used twice.
func cleanBank(q Question, a Answer) (Answer, bool) {
	gaps := q.bodyGapIDs()
	for gap, id := range a.Pairs {
		if !slices.Contains(gaps, gap) || !slices.ContainsFunc(q.Options, func(o Option) bool { return o.ID == id }) {
			return Answer{}, false
		}
	}
	if hasRepeatedValue(a.Pairs) {
		return Answer{}, false
	}
	return Answer{Pairs: a.Pairs}, true
}

// hasRepeatedValue reports whether two keys of pairs share a value.
func hasRepeatedValue(pairs map[string]string) bool {
	seen := make(map[string]bool, len(pairs))
	for _, v := range pairs {
		if seen[v] {
			return true
		}
		seen[v] = true
	}
	return false
}
