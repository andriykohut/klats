package testfmt

import (
	"strings"
	"testing"
)

func picture() *Image { return &Image{Src: strings.Repeat("a", 64) + ".png", W: 400, H: 300} }

func hotspotQ(areas ...Area) Question {
	return Question{ID: "q1", Type: "hotspot", Text: rj("Де?"), Points: 1, Image: picture(), Areas: areas}
}

// labelQ makes a label question on a picture with the points and labels. A
// label's target is its point, or empty for a decoy.
func labelQ(points []Target, labels ...Option) Question {
	return Question{ID: "q1", Type: "label", Text: rj("Підпишіть"), Points: 3, Image: picture(), Targets: points, Options: labels}
}

func spot(id string, x, y float64) Target { return Target{ID: id, X: x, Y: y} }

func TestProblemsPictureText(t *testing.T) {
	area := Area{ID: "a1", Shape: "rect", X: 0.1, Y: 0.1, W: 0.2, H: 0.2}
	wantCodes(t, testOf(t, hotspotQ(area)))
	noImage := hotspotQ(area)
	noImage.Image = nil
	ps := wantCodes(t, testOf(t, noImage), "no_image")
	if ps[0].Severity != "error" {
		t.Errorf("no_image severity = %s", ps[0].Severity)
	}
	ps = wantCodes(t, testOf(t, hotspotQ()), "no_areas")
	if ps[0].Severity != "error" {
		t.Errorf("no_areas severity = %s", ps[0].Severity)
	}

	points := []Target{spot("p1", 0.2, 0.3), spot("p2", 0.6, 0.7)}
	// Points have no content of their own.
	wantCodes(t, testOf(t, labelQ(points, row("l1", "серце", "p1"), row("l2", "легені", "p2"), row("d", "печінка", ""))))
	ps = wantCodes(t, testOf(t, labelQ(nil, row("d", "печінка", ""))), "no_points")
	if ps[0].Severity != "error" {
		t.Errorf("no_points severity = %s", ps[0].Severity)
	}
	ps = wantCodes(t, testOf(t, labelQ(points, row("l2", "легені", "p2"))), "point_no_label")
	if ps[0].Count != 1 || ps[0].Severity != "error" {
		t.Errorf("point_no_label = %+v", ps[0])
	}
	unlabelled := labelQ(points, row("l1", "серце", "p1"), row("l2", "", "p2"))
	unlabelled.Image = nil
	wantCodes(t, testOf(t, unlabelled), "no_image", "empty_option")

	wantCodes(t, testOf(t, highlightQ("Кіт", "*біжить", "додому")))
	ps = wantCodes(t, testOf(t, highlightQ("Кіт", "біжить")), "no_words")
	if ps[0].Severity != "error" {
		t.Errorf("no_words severity = %s", ps[0].Severity)
	}
	wantCodes(t, testOf(t, highlightQ()), "no_body", "no_words")

	wantCodes(t, testOf(t, openQ()))
	blank := openQ()
	blank.Text = rj("")
	wantCodes(t, testOf(t, blank), "no_text")
}

func TestCleanAnswerPictureText(t *testing.T) {
	h := mustDecodeQ(t, hotspotQ(Area{ID: "a1", Shape: "ellipse", W: 0.5, H: 0.5}))
	got, ok := h.CleanAnswer(Answer{Point: &Point{X: 0.5, Y: 1}, Text: "x"})
	if !ok || got.Point == nil || *got.Point != (Point{X: 0.5, Y: 1}) || got.Text != "" {
		t.Errorf("valid point: %+v, %v", got, ok)
	}
	if got, ok := h.CleanAnswer(Answer{}); !ok || got.Point != nil {
		t.Errorf("no point: %+v, %v", got, ok)
	}
	for _, p := range []Point{{X: 1.2, Y: 0.5}, {X: 0.5, Y: -0.1}} {
		if _, ok := h.CleanAnswer(Answer{Point: &p}); ok {
			t.Errorf("point %+v: want invalid", p)
		}
	}

	l := mustDecodeQ(t, labelQ([]Target{spot("p1", 0.2, 0.3), spot("p2", 0.6, 0.7)}, row("l1", "a", "p1"), row("l2", "b", "p2"), row("d", "c", "")))
	if _, ok := l.CleanAnswer(Answer{Pairs: map[string]string{"d": "p1", "l1": "p2"}}); !ok {
		t.Error("a label answer may differ from the key")
	}
	for name, p := range map[string]map[string]string{
		"point twice":   {"l1": "p1", "d": "p1"},
		"unknown point": {"l1": "p9"},
		"unknown label": {"zz": "p1"},
	} {
		if _, ok := l.CleanAnswer(Answer{Pairs: p}); ok {
			t.Errorf("label %s: want invalid", name)
		}
	}

	hl := mustDecodeQ(t, highlightQ("1", "2", "3", "4", "5", "6", "7", "8", "9", "*10"))
	got, ok = hl.CleanAnswer(Answer{Items: []string{"9", "0", "9"}, Text: "x"})
	if !ok || strings.Join(got.Items, ",") != "9,0" || got.Text != "" {
		t.Errorf("valid words: %+v, %v", got, ok)
	}
	for _, id := range []string{"999", "10", "-1", "01", "a", ""} {
		if _, ok := hl.CleanAnswer(Answer{Items: []string{id}}); ok {
			t.Errorf("word %q of 10: want invalid", id)
		}
	}

	o := mustDecodeQ(t, openQ())
	if got, ok := o.CleanAnswer(Answer{Text: strings.Repeat("я", 5000), Items: []string{"a"}}); !ok || got.Items != nil {
		t.Errorf("5,000 characters: %v", ok)
	}
	if _, ok := o.CleanAnswer(Answer{Text: strings.Repeat("я", 5001)}); ok {
		t.Error("5,001 characters: want invalid")
	}
}

func TestDecodeRejectsTwoLabelsForOnePoint(t *testing.T) {
	points := []Target{spot("p1", 0.2, 0.3), spot("p2", 0.6, 0.7)}
	if _, err := decodeQ(t, labelQ(points, row("l1", "a", "p1"), row("l2", "b", "p1"))); err == nil {
		t.Error("two labels for p1 must be rejected")
	}
	if _, err := decodeQ(t, labelQ(points, row("l1", "a", "p1"), row("l2", "b", "p2"), row("d1", "c", ""), row("d2", "d", ""))); err != nil {
		t.Errorf("decoys share the empty target: %v", err)
	}
}
