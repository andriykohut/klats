package testfmt

import (
	"fmt"
	"slices"

	"github.com/andriykohut/klats/internal/rich"
)

// orderProblems reports the findings of an ordering question: its options,
// listed in the correct order, need three items, since the order of two is
// settled by a swap.
func orderProblems(q Question, add report) {
	if len(q.Options) < 3 {
		add("too_few_options", "error", 3)
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
	if id, ok := repeatedTarget(q.Options); ok {
		return fmt.Errorf("gap %q has more than one word", id)
	}
	return nil
}

// checkMatchPairs rejects a matching question in which two left items share a
// right-hand target, since an answer uses each target once and so could not
// give the key. A target no item points to is a decoy.
func checkMatchPairs(q Question) error {
	if id, ok := repeatedTarget(q.Options); ok {
		return fmt.Errorf("right-hand target %q belongs to more than one left item", id)
	}
	return nil
}

// repeatedTarget returns a non-empty target that more than one option names.
func repeatedTarget(opts []Option) (string, bool) {
	seen := map[string]bool{}
	for _, o := range opts {
		if o.Target == "" {
			continue
		}
		if seen[o.Target] {
			return o.Target, true
		}
		seen[o.Target] = true
	}
	return "", false
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

// cleanMatch validates the answer of a matching or label question: each left
// item or label maps to a right-hand target or point, and no target is used
// twice.
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
