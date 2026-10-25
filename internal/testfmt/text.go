package testfmt

import (
	"slices"
	"strconv"
	"unicode/utf8"

	"klats/internal/rich"
)

// maxWrittenRunes caps a written answer.
const maxWrittenRunes = 5000

// Words returns the body of a highlight question with its words split out, and
// the words, as [rich.Doc.Words] does: the body students get, and the words
// its answer names by index, from "0". A body that does not parse as highlight
// text has no words.
func (q Question) Words() (rich.Doc, []rich.Word) {
	doc, err := rich.Parse(q.Body, rich.Marked)
	if err != nil {
		return rich.Doc{Type: "doc"}, nil
	}
	return doc.Words()
}

// highlightProblems reports the findings of a highlight question: a word of
// its body must be marked.
func highlightProblems(q Question, add report) {
	_, words := q.Words()
	if !slices.ContainsFunc(words, func(w rich.Word) bool { return w.Target }) {
		add("no_words", "error", 0)
	}
}

// cleanHighlight validates the answer of a highlight question: its items are
// word indexes below the number of words, in decimal without a sign or
// leading zeros. Repeats are dropped.
func cleanHighlight(q Question, a Answer) (Answer, bool) {
	_, words := q.Words()
	seen := make([]bool, len(words))
	var items []string
	for _, id := range a.Items {
		i, err := strconv.Atoi(id)
		if err != nil || i < 0 || i >= len(words) || strconv.Itoa(i) != id {
			return Answer{}, false
		}
		if !seen[i] {
			seen[i] = true
			items = append(items, id)
		}
	}
	return Answer{Items: items}, true
}

// cleanWritten validates a written answer: its text is at most 5,000
// characters.
func cleanWritten(_ Question, a Answer) (Answer, bool) {
	if utf8.RuneCountInString(a.Text) > maxWrittenRunes {
		return Answer{}, false
	}
	return Answer{Text: a.Text}, true
}
