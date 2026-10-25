package testfmt

import "slices"

// choiceProblems reports the findings of a single or multiple choice question.
func choiceProblems(q Question, add report) {
	correct, wrong := 0, 0
	for _, o := range q.Options {
		if o.Correct {
			correct++
		} else {
			wrong++
		}
	}
	if correct == 0 {
		add("no_correct", "error", 0)
	}
	if len(q.Options) < 2 {
		add("too_few_options", "error", 2)
	}
	// Scoring needs every correct option, and a single-answer question
	// takes one pick, so nobody could score.
	if q.Type == "single" && correct > 1 {
		add("single_many_correct", "error", correct)
	}
	if hasEmptyItem(q) {
		add("empty_option", "warning", 0)
	}
	if q.Type == "multi" && q.Partial && wrong <= 1 {
		add("weak_partial", "warning", 0)
	}
}

// trueFalseProblems reports the findings of a true/false question. No
// statement has to be true.
func trueFalseProblems(q Question, add report) {
	if len(q.Options) < 1 {
		add("too_few_options", "error", 1)
	}
	if hasEmptyItem(q) {
		add("empty_option", "warning", 0)
	}
}

// gridProblems reports the findings of a choice grid: rows are options and
// columns are targets.
func gridProblems(q Question, add report) {
	if len(q.Options) < 1 {
		add("too_few_options", "error", 1)
	}
	if len(q.Targets) < 2 {
		add("too_few_targets", "error", 2)
	}
	// Decode clears a target that names no column.
	if slices.ContainsFunc(q.Options, func(o Option) bool { return o.Target == "" }) {
		add("no_target", "error", 0)
	}
	if hasEmptyItem(q) {
		add("empty_option", "warning", 0)
	}
}

// cleanPick validates the answer of a single or multiple choice question: its
// items are option ids.
func cleanPick(q Question, a Answer) (Answer, bool) {
	var items []string
	for _, id := range a.Items {
		if !slices.ContainsFunc(q.Options, func(o Option) bool { return o.ID == id }) {
			return Answer{}, false
		}
		if !slices.Contains(items, id) {
			items = append(items, id)
		}
	}
	return Answer{Items: items}, true
}

// cleanTrueFalse validates the answer of a true/false question: each statement
// maps to "true" or "false".
func cleanTrueFalse(q Question, a Answer) (Answer, bool) {
	return cleanPairs(q, a, func(v string) bool { return v == "true" || v == "false" })
}

// cleanGrid validates the answer of a choice grid: each row maps to a column.
func cleanGrid(q Question, a Answer) (Answer, bool) {
	return cleanPairs(q, a, func(v string) bool {
		return slices.ContainsFunc(q.Targets, func(g Target) bool { return g.ID == v })
	})
}

// cleanPairs keeps the answer's pairs when each key is an option id and each
// value passes valid.
func cleanPairs(q Question, a Answer, valid func(value string) bool) (Answer, bool) {
	for id, v := range a.Pairs {
		if !slices.ContainsFunc(q.Options, func(o Option) bool { return o.ID == id }) || !valid(v) {
			return Answer{}, false
		}
	}
	return Answer{Pairs: a.Pairs}, true
}
