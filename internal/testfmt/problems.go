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
// a question, in this order: no_text, no_correct, too_few_options,
// single_many_correct (Count is the number of correct options), empty_option,
// weak_partial.
func (t Test) Problems() []Problem {
	var out []Problem
	for _, q := range t.Questions {
		add := func(code, severity string, count int) {
			out = append(out, Problem{QuestionID: q.ID, Code: code, Severity: severity, Count: count})
		}
		correct, wrong, hasEmpty := 0, 0, false
		for _, o := range q.Options {
			if o.Correct {
				correct++
			} else {
				wrong++
			}
			hasEmpty = hasEmpty || isEmpty(o.Content, rich.Inline)
		}
		if isEmpty(q.Text, rich.Block) {
			add("no_text", "error", 0)
		}
		if correct == 0 {
			add("no_correct", "error", 0)
		}
		if len(q.Options) < 2 {
			add("too_few_options", "error", 0)
		}
		if q.Type == "single" && correct > 1 {
			add("single_many_correct", "warning", correct)
		}
		if hasEmpty {
			add("empty_option", "warning", 0)
		}
		if q.Type == "multi" && q.Partial && wrong <= 1 {
			add("weak_partial", "warning", 0)
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

// isEmpty treats unparseable content as empty.
func isEmpty(raw json.RawMessage, mode rich.Mode) bool {
	doc, err := rich.Parse(raw, mode)
	return err != nil || doc.IsEmpty()
}
