package testfmt

import (
	"encoding/json"

	"klats/internal/rich"
)

// Problem is one validation finding about a question.
type Problem struct {
	QuestionID string `json:"questionId"`
	Code       string `json:"code"`
	Severity   string `json:"severity"` // "error", "warning" or "info"
	Count      int    `json:"count,omitempty"`
}

// Problems lists the findings for every question, in question order and, within
// a question, in this order: no_text (no_body for a type with a body), then the
// type's own findings. Those of single and multiple choice are no_correct,
// too_few_options, single_many_correct (Count is the number of correct
// options), empty_option and weak_partial; true/false has too_few_options and
// empty_option; the choice grid has too_few_options, too_few_targets, no_target
// and empty_option; short text has no_accepted and one_accepted; number has
// no_number; gaps has no_gaps and gap_no_answer, once per gap without an
// answer; ordering has too_few_options and empty_option; matching has
// too_few_options, no_target and empty_option; grouping has too_few_options,
// too_few_targets, no_target and empty_option; the word bank has no_gaps,
// gap_no_answer, once per gap without a word, and empty_option. Count is the
// least number the question needs for too_few_options and too_few_targets, and
// the number of the gap (from 1) for gap_no_answer.
func (t Test) Problems() []Problem {
	var out []Problem
	for _, q := range t.Questions {
		add := func(code, severity string, count int) {
			out = append(out, Problem{QuestionID: q.ID, Code: code, Severity: severity, Count: count})
		}
		k := kinds[q.Type]
		if k.uses&useBody != 0 {
			if isEmpty(q.Body, k.bodyMode) {
				add("no_body", "error", 0)
			}
		} else if isEmpty(q.Text, rich.Block) {
			add("no_text", "error", 0)
		}
		if k.problems != nil {
			k.problems(q, add)
		}
	}
	return out
}

// HasBlocking reports whether any problem has severity "error".
func (t Test) HasBlocking() bool {
	for _, p := range t.Problems() {
		if p.Severity == "error" {
			return true
		}
	}
	return false
}

// hasEmptyItem reports whether an option or target of the question has neither
// content nor an image.
func hasEmptyItem(q Question) bool {
	for _, o := range q.Options {
		if o.Image == nil && isEmpty(o.Content, rich.Inline) {
			return true
		}
	}
	for _, g := range q.Targets {
		if g.Image == nil && isEmpty(g.Content, rich.Inline) {
			return true
		}
	}
	return false
}

// isEmpty treats unparseable content as empty.
func isEmpty(raw json.RawMessage, mode rich.Mode) bool {
	doc, err := rich.Parse(raw, mode)
	return err != nil || doc.IsEmpty()
}
