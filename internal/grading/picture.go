package grading

import (
	"slices"

	"klats/internal/testfmt"
)

// judgeHotspot judges a hotspot answer: full points when the point lies inside
// any area, edges included. The verdict holds "" once there is a point.
func judgeHotspot(q testfmt.Question, a testfmt.Answer) Verdict {
	if a.Point == nil {
		return Verdict{}
	}
	ok := slices.ContainsFunc(q.Areas, func(ar testfmt.Area) bool { return contains(ar, *a.Point) })
	return Verdict{Points: pointsIf(q, ok), Items: map[string]bool{"": ok}}
}

// contains reports whether the point lies in the area: a "rect" spans X to
// X + W and Y to Y + H, and an "ellipse" is the one inscribed in that box. An
// area of another shape contains nothing.
func contains(ar testfmt.Area, p testfmt.Point) bool {
	switch ar.Shape {
	case "rect":
		return ar.X-epsilon <= p.X && p.X <= ar.X+ar.W+epsilon && ar.Y-epsilon <= p.Y && p.Y <= ar.Y+ar.H+epsilon
	case "ellipse":
		dx := (p.X - ar.X - ar.W/2) / (ar.W / 2)
		dy := (p.Y - ar.Y - ar.H/2) / (ar.H / 2)
		return dx*dx+dy*dy <= 1+epsilon
	}
	return false
}

// judgeLabels judges a label answer: a label is right when it is placed on its
// point, and a decoy, whose target is empty, is wrong wherever it is placed.
// With N labels that have a point, c right and w wrong placements, the points
// are points * max(0, (c - w) / N), or, without Partial, all points when c is
// N. The verdict holds each placed label.
func judgeLabels(q testfmt.Question, a testfmt.Answer) Verdict {
	v := Verdict{Items: map[string]bool{}}
	n, c, w := 0, 0, 0
	for _, o := range q.Options {
		if o.Target != "" {
			n++
		}
		given, placed := a.Pairs[o.ID]
		if !placed {
			continue
		}
		right := o.Target != "" && given == o.Target
		v.Items[o.ID] = right
		if right {
			c++
		} else {
			w++
		}
	}
	v.Points = partialPoints(q, n, c, w)
	return v
}
