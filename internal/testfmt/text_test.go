package testfmt

import (
	"encoding/json"
	"fmt"
	"strings"
)

// highlightQ makes a highlight question whose body is one paragraph of the
// words, separated by spaces. A word written with a leading "*" carries the
// target mark.
func highlightQ(words ...string) Question {
	var nodes []string
	for i, w := range words {
		if i > 0 {
			nodes = append(nodes, `{"type":"text","text":" "}`)
		}
		if marked, ok := strings.CutPrefix(w, "*"); ok {
			nodes = append(nodes, fmt.Sprintf(`{"type":"text","text":%q,"marks":[{"type":"target"}]}`, marked))
		} else {
			nodes = append(nodes, fmt.Sprintf(`{"type":"text","text":%q}`, w))
		}
	}
	body := `{"type":"doc","content":[{"type":"paragraph","content":[` + strings.Join(nodes, ",") + `]}]}`
	return Question{ID: "q1", Type: "highlight", Points: 3, Partial: true, Body: json.RawMessage(body)}
}

func openQ() Question {
	return Question{ID: "q1", Type: "open", Text: rj("Опишіть"), Points: 4, Rubric: "2 бали за приклад"}
}
