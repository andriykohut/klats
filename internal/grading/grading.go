// Package grading scores answers to every question type except written
// answers, which wait for the teacher's points, and converts a total into the
// grade of the test's scale.
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
	// Pending counts the written answers waiting for the teacher (see
	// [IsPending]). They score 0 until the teacher sets their points.
	Pending int
}

// Verdict is the outcome of judging one answer. Items says, for each part of
// the answer the type judges, whether it is right; its keys are option ids for
// the choice and label types, gap ids for gaps, word indexes for highlighting
// and "" for the one answer of a short text, number or hotspot question.
type Verdict struct {
	Points float64
	Items  map[string]bool
}

// Judge scores the answer to the question and rates its parts. A written
// answer, and an answer to a question whose type is not judged, earns 0 and
// has no verdict items.
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
	case "hotspot":
		return judgeHotspot(q, a)
	case "label":
		return judgeLabels(q, a)
	case "highlight":
		return judgeHighlight(q, a)
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
		pts, overridden := overrides[q.ID]
		if !overridden {
			pts = v.Points
		}
		if IsPending(q, answers[q.ID], overridden) {
			r.Pending++
		}
		r.PerQuestion[q.ID] = pts
		r.Earned += pts
		r.Max += float64(q.Points)
		if math.Abs(pts-float64(q.Points)) < epsilon {
			r.Correct++
		}
	}
	r.Grade = Grade(t.Settings.Scale, r.Earned, r.Max)
	return r
}

// Grade turns earned out of max into a grade of the scale. On
// [testfmt.ScalePoints12] it is the highest of 2-12 whose threshold the percent
// reaches, else 1; on [testfmt.ScalePercent] the percent, rounded; on
// [testfmt.ScalePass] 1 if the percent reaches the pass mark, else 0. A max of
// 0 grades as 1, 0 and 0.
func Grade(s testfmt.Scale, earned, max float64) int {
	pct := 0.0
	if max > 0 {
		pct = 100 * earned / max
	}
	switch s.Kind {
	case testfmt.ScalePercent:
		return int(math.Round(pct))
	case testfmt.ScalePass:
		if max > 0 && pct+epsilon >= float64(s.Pass) {
			return 1
		}
		return 0
	}
	g := 1
	if max > 0 {
		for i, th := range s.Thresholds {
			if pct+epsilon >= float64(th) {
				g = i + 2
			}
		}
	}
	return g
}
