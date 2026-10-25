package testfmt

import (
	"fmt"
	"slices"
)

// hotspotProblems reports the findings of a hotspot question: it needs its
// picture and an area to click.
func hotspotProblems(q Question, add report) {
	if q.Image == nil {
		add("no_image", "error", 0)
	}
	if len(q.Areas) == 0 {
		add("no_areas", "error", 0)
	}
}

// labelProblems reports the findings of a label question: targets are the
// points on its picture and options the labels, which may hold decoys. Each
// point, counted from 1, needs a label.
func labelProblems(q Question, add report) {
	if q.Image == nil {
		add("no_image", "error", 0)
	}
	if len(q.Targets) == 0 {
		add("no_points", "error", 0)
	}
	for i, g := range q.Targets {
		if !slices.ContainsFunc(q.Options, func(o Option) bool { return o.Target == g.ID }) {
			add("point_no_label", "error", i+1)
		}
	}
	// A point is a place on the picture and has no content of its own.
	if hasEmptyItem(Question{Options: q.Options}) {
		add("empty_option", "warning", 0)
	}
}

// checkLabelPoints rejects a label question in which two labels share a point,
// since an answer uses each point once and so could not give the key. A decoy
// has an empty target.
func checkLabelPoints(q Question) error {
	if id, ok := repeatedTarget(q.Options); ok {
		return fmt.Errorf("point %q has more than one label", id)
	}
	return nil
}

// cleanPoint validates the answer of a hotspot question: a point on the
// picture, or none.
func cleanPoint(_ Question, a Answer) (Answer, bool) {
	if a.Point != nil && !inUnit(a.Point.X, a.Point.Y) {
		return Answer{}, false
	}
	return Answer{Point: a.Point}, true
}
