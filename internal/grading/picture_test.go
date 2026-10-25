package grading

import (
	"reflect"
	"testing"

	"klats/internal/testfmt"
)

func click(x, y float64) testfmt.Answer { return testfmt.Answer{Point: &testfmt.Point{X: x, Y: y}} }

func TestJudgeHotspot(t *testing.T) {
	rect := testfmt.Question{ID: "q", Type: "hotspot", Points: 2, Areas: []testfmt.Area{{ID: "a", Shape: "rect", X: 0.1, Y: 0.1, W: 0.2, H: 0.2}}}
	v := Judge(rect, click(0.3, 0.3))
	near(t, v.Points, 2) // the corner counts as inside
	if want := map[string]bool{"": true}; !reflect.DeepEqual(v.Items, want) {
		t.Errorf("Items = %v, want %v", v.Items, want)
	}
	v = Judge(rect, click(0.31, 0.2))
	near(t, v.Points, 0)
	if want := map[string]bool{"": false}; !reflect.DeepEqual(v.Items, want) {
		t.Errorf("Items = %v, want %v", v.Items, want)
	}
	if v := Judge(rect, testfmt.Answer{}); v.Points != 0 || v.Items != nil {
		t.Errorf("no click = %+v", v)
	}

	ellipse := testfmt.Question{ID: "q", Type: "hotspot", Points: 2, Areas: []testfmt.Area{
		{ID: "far", Shape: "rect", X: 0.9, Y: 0.9, W: 0.1, H: 0.1},
		{ID: "e", Shape: "ellipse", X: 0.4, Y: 0.4, W: 0.2, H: 0.2},
	}}
	near(t, Judge(ellipse, click(0.59, 0.5)).Points, 2)
	near(t, Judge(ellipse, click(0.58, 0.58)).Points, 0) // inside the bounding box, outside the ellipse
	near(t, Judge(ellipse, click(0.95, 0.95)).Points, 2) // any area counts
}

func TestJudgeLabel(t *testing.T) {
	l := testfmt.Question{ID: "q", Type: "label", Points: 3, Partial: true,
		Targets: []testfmt.Target{{ID: "p1"}, {ID: "p2"}, {ID: "p3"}},
		Options: []testfmt.Option{{ID: "l1", Target: "p1"}, {ID: "l2", Target: "p2"}, {ID: "l3", Target: "p3"}, {ID: "d"}},
	}
	v := Judge(l, pairs("l1", "p1", "l2", "p2", "d", "p3"))
	near(t, v.Points, 1) // 3 × (2 − 1) / 3: the decoy counts as wrong
	if want := map[string]bool{"l1": true, "l2": true, "d": false}; !reflect.DeepEqual(v.Items, want) {
		t.Errorf("Items = %v, want %v", v.Items, want)
	}
	near(t, Judge(l, pairs("l1", "p1", "l2", "p2", "l3", "p3")).Points, 3)
	l.Partial = false
	near(t, Judge(l, pairs("l1", "p1", "l2", "p2", "d", "p3")).Points, 0)
	near(t, Judge(l, pairs("l1", "p1", "l2", "p2", "l3", "p3")).Points, 3)
}
