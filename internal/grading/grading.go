// Package grading scores single- and multiple-choice answers and converts a
// total into the Ukrainian 12-point grade.
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
}

// Score returns the points earned for one question given the answer's items,
// the selected option ids.
//
// Unknown option ids are ignored and duplicates count once. A single question
// scores full points only for exactly the one correct option. A multi question
// scores full points only on an exact set match, or, when Partial is set,
// points * max(0, (c - w) / C) for c correct picks, w wrong picks and C correct
// options. A question with no correct option scores 0.
func Score(q testfmt.Question, a testfmt.Answer) float64 {
	selected := a.Items
	known := make(map[string]bool, len(q.Options)) // option id -> correct
	totalCorrect := 0
	for _, o := range q.Options {
		known[o.ID] = o.Correct
		if o.Correct {
			totalCorrect++
		}
	}
	if totalCorrect == 0 {
		return 0
	}

	picked := make(map[string]bool, len(selected))
	c, w := 0, 0
	for _, id := range selected {
		correct, ok := known[id]
		if !ok || picked[id] {
			continue
		}
		picked[id] = true
		if correct {
			c++
		} else {
			w++
		}
	}

	points := float64(q.Points)
	switch {
	case q.Type == "multi" && q.Partial:
		return points * math.Max(0, float64(c-w)/float64(totalCorrect))
	case c == totalCorrect && w == 0:
		return points
	default:
		return 0
	}
}

// Total grades a whole test. answers maps question id to the student's answer;
// overrides maps question id to teacher-set points that replace Score.
func Total(t testfmt.Test, answers map[string]testfmt.Answer, overrides map[string]float64) Result {
	r := Result{PerQuestion: make(map[string]float64, len(t.Questions))}
	for _, q := range t.Questions {
		pts, ok := overrides[q.ID]
		if !ok {
			pts = Score(q, answers[q.ID])
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
