package sitting

import (
	"strconv"
	"strings"
	"testing"

	"github.com/andriykohut/klats/internal/testfmt"
	"github.com/andriykohut/klats/internal/wire"
)

// pcts renders percents as "67 0", a nil one as "-".
func pcts(ps []*int) string {
	s := make([]string, len(ps))
	for i, p := range ps {
		s[i] = "-"
		if p != nil {
			s[i] = strconv.Itoa(*p)
		}
	}
	return strings.Join(s, " ")
}

func TestTagScores(t *testing.T) {
	qs := []testfmt.Question{
		{ID: "q1", Points: 2, Tags: []string{"A"}},
		{ID: "q2", Points: 1, Tags: []string{"A", "B"}},
		{ID: "q3", Points: 1, Tags: []string{"B"}},
		{ID: "q4", Points: 1},
	}
	rows := []wire.ResultRow{
		{Order: []string{"q1", "q2"}, Points: []float64{2, 0, 0, 0}},
		{Order: []string{"q2", "q3"}, Points: []float64{0, 1, 1, 0}},
		{Order: []string{"q3"}, Points: []float64{0, 0, 0, 0}, PendingIDs: []string{"q3"}},
	}
	tags, per := tagScores(qs, rows)
	// The class: A earned 2+0+1 of 2+1+1, B 0+1+1 of 1+1+1; the third row's
	// only question waits for the teacher.
	var names []string
	var class []*int
	for _, tag := range tags {
		names, class = append(names, tag.Tag), append(class, tag.Pct)
	}
	if strings.Join(names, " ") != "A B" || pcts(class) != "75 67" {
		t.Errorf("tags = %v %q, want [A B] \"75 67\"", names, pcts(class))
	}
	var got []string
	for _, p := range per {
		got = append(got, pcts(p))
	}
	if strings.Join(got, "|") != "67 0|100 100|- -" {
		t.Errorf("per row = %q, want 67 0|100 100|- -", got)
	}

	tags, per = tagScores(singles(4), rows)
	if tags == nil || len(tags) != 0 || len(per) != len(rows) {
		t.Fatalf("no tags: tags = %v, per = %v", tags, per)
	}
	for i, p := range per {
		if p == nil || len(p) != 0 {
			t.Errorf("no tags: row %d = %v, want empty and non-nil", i, p)
		}
	}
}
