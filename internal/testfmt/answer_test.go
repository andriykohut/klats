package testfmt

import "testing"

func TestAnswerIsEmpty(t *testing.T) {
	for _, a := range []Answer{{}, {Text: "  "}, {Items: []string{}}} {
		if !a.IsEmpty() {
			t.Errorf("%+v should be empty", a)
		}
	}
	filled := []Answer{{Items: []string{"a"}}, {Pairs: map[string]string{"a": "b"}}, {Text: "x"}, {Point: &Point{}}}
	for _, a := range filled {
		if a.IsEmpty() {
			t.Errorf("%+v should not be empty", a)
		}
	}
}
