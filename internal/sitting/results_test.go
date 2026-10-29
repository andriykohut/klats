package sitting

import (
	"slices"
	"testing"

	"klats/internal/testfmt"
)

func TestResultsOrder(t *testing.T) {
	// order returns the Order of the only row of a sitting of five questions
	// with the settings s, and the ids of the questions its student got.
	order := func(s testfmt.Settings) (got, own []string) {
		e, _ := setupSettings(t, 5, s)
		info := start(t, e, nil)
		enter(t, e, info.Code, devA, "Шевченко")
		own, _ = resumed(t, e, devA)
		return resultsOf(t, e, info.AssignmentID).Rows[0].Order, own
	}

	if got, _ := order(testfmt.Settings{}); !slices.Equal(got, testIDs(singles(5))) {
		t.Errorf("no settings: Order = %v, want the test's order", got)
	}
	if got, own := order(testfmt.Settings{ShuffleQuestions: true}); !slices.Equal(got, own) {
		t.Errorf("shuffle: Order = %v, want the student's %v", got, own)
	}
	if got, own := order(testfmt.Settings{Subset: 3}); len(got) != 3 || !slices.Equal(got, own) {
		t.Errorf("subset 3 of 5: Order = %v, want the student's %v", got, own)
	}
}
