// Package grading scores answers to the choice, short text, number, gaps,
// ordering, matching, grouping and word bank questions and converts a total
// into the Ukrainian 12-point grade.
package grading

import (
	"math"

	"klats/internal/testfmt"
)

// epsilon absorbs float error when comparing scores and 12-point boundaries.
const epsilon = 1e-9

// Result is the outcome of grading one sitting.
type Result struct {
	Earned, Max float64
	Grade       int
	// Correct counts questions whose final points equal the question's points.
	Correct int
	// PerQuestion holds the final points for every question, unanswered ones as 0.
	PerQuestion map[string]float64
	// Verdicts holds the [Verdict.Items] of every question with an answered
	// part, by question id. Teacher overrides do not change them.
	Verdicts map[string]map[string]bool
}

// Verdict is the outcome of judging one answer. Items says, for each part of
// the answer the type judges, whether it is right; its keys are option ids for
// the choice types, gap ids for gaps and "" for the one answer of a short text
// or number question.
type Verdict struct {
	Points float64
	Items  map[string]bool
}

// Judge scores the answer to the question and rates its parts. An answer to a
// question whose type is not judged earns 0.
func Judge(q testfmt.Question, a testfmt.Answer) Verdict {
	switch q.Type {
	case "single", "multi":
		return judgePick(q, a)
	case "truefalse":
		return judgeStatements(q, a)
	case "grid", "match", "groups":
		return judgeGrid(q, a)
	case "order":
		return judgeOrder(q, a)
	case "bank":
		return judgeBank(q, a)
	case "short":
		return judgeShort(q, a)
	case "number":
		return judgeNumber(q, a)
	case "gaps":
		return judgeGaps(q, a)
	}
	return Verdict{}
}

// Score returns the points the answer earns for the question, as [Judge] does.
func Score(q testfmt.Question, a testfmt.Answer) float64 {
	return Judge(q, a).Points
}

// Total grades a whole test. answers maps question id to the student's answer;
// overrides maps question id to teacher-set points that replace Score.
func Total(t testfmt.Test, answers map[string]testfmt.Answer, overrides map[string]float64) Result {
	r := Result{PerQuestion: make(map[string]float64, len(t.Questions)), Verdicts: map[string]map[string]bool{}}
	for _, q := range t.Questions {
		v := Judge(q, answers[q.ID])
		if len(v.Items) > 0 {
			r.Verdicts[q.ID] = v.Items
		}
		pts, ok := overrides[q.ID]
		if !ok {
			pts = v.Points
		}
		r.PerQuestion[q.ID] = pts
		r.Earned += pts
		r.Max += float64(q.Points)
		if math.Abs(pts-float64(q.Points)) < epsilon {
			r.Correct++
		}
	}
	r.Grade = Grade12(r.Earned, r.Max)
	return r
}

// Grade12 maps earned out of max onto 1..12, where grade g needs g/12 of the
// points. A max of 0 yields 1.
func Grade12(earned, max float64) int {
	if max <= 0 {
		return 1
	}
	return int(math.Max(1, math.Floor(12*earned/max+epsilon)))
}
