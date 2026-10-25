package rich

import (
	"slices"
	"strings"
	"unicode"
)

// joiners are the apostrophes (' U+0027, ’ U+2019, ʼ U+02BC) and hyphens
// (- U+002D, ‐ U+2010, ‑ U+2011) that join two word characters into one word.
const joiners = "'’ʼ-‐‑"

// Word is a word of a document split by [Doc.Words]: its text, and whether any
// of its characters carries the target mark.
type Word struct {
	Text   string
	Target bool
}

// Words returns a copy of the document in which every word of a paragraph is a
// word node holding the word's text nodes, and the words in document order. A
// formatted part of a word, such as a bold syllable, stays inside it as a text
// node of its own. The copy keeps every other node and mark except the target
// mark, which it removes everywhere. The word node is output only: [Parse]
// accepts it in no mode.
//
// A word is a run of word characters, which are Unicode letters (category L),
// decimal digits (Nd) and marks (M), together with any apostrophe or hyphen of
// [joiners] that has a word character right before and right after it. Every
// other character ends a word, and so do a hard break, any other inline node
// and the end of a paragraph; formatting does not. «Кіт **біж**ить, м’ята й
// пів-яблука.» holds the words «Кіт», «біжить», «м’ята», «й» and «пів-яблука».
func (d Doc) Words() (Doc, []Word) {
	var words []Word
	return Doc{Type: d.Type, Content: splitBlocks(d.Content, &words)}, words
}

// splitBlocks returns copies of the nodes with the words of each paragraph
// split out, appending them to words.
func splitBlocks(nodes []Node, words *[]Word) []Node {
	out := make([]Node, len(nodes))
	for i, n := range nodes {
		if n.Type == "paragraph" {
			n.Content = splitParagraph(n.Content, words)
		} else {
			n.Content = splitBlocks(n.Content, words)
		}
		out[i] = n
	}
	return out
}

// char is a character of a paragraph's text, with the marks of its text node
// other than target.
type char struct {
	r      rune
	marks  []Mark
	target bool
}

func splitParagraph(inline []Node, words *[]Word) []Node {
	var out []Node
	var run []char // the text since the last inline node that is not text
	for _, n := range inline {
		if n.Type != "text" {
			out = append(out, splitRun(run, words)...)
			out = append(out, n)
			run = nil
			continue
		}
		var marks []Mark
		target := false
		for _, m := range n.Marks {
			if m.Type == "target" {
				target = true
			} else {
				marks = append(marks, m)
			}
		}
		for _, r := range n.Text {
			run = append(run, char{r, marks, target})
		}
	}
	return append(out, splitRun(run, words)...)
}

// splitRun returns the text of run as word nodes and the text nodes between
// them.
func splitRun(run []char, words *[]Word) []Node {
	inWord := make([]bool, len(run))
	for i, c := range run {
		inWord[i] = isWordChar(c.r) || strings.ContainsRune(joiners, c.r) &&
			i > 0 && i+1 < len(run) && isWordChar(run[i-1].r) && isWordChar(run[i+1].r)
	}
	var out []Node
	for i := 0; i < len(run); {
		j := i + 1
		for j < len(run) && inWord[j] == inWord[i] {
			j++
		}
		texts := textRuns(run[i:j])
		if inWord[i] {
			var w Word
			for _, c := range run[i:j] {
				w.Target = w.Target || c.target
			}
			for _, t := range texts {
				w.Text += t.Text
			}
			*words = append(*words, w)
			out = append(out, Node{Type: "word", Content: texts})
		} else {
			out = append(out, texts...)
		}
		i = j
	}
	return out
}

// textRuns returns the characters as text nodes, one for each run of equal
// marks.
func textRuns(cs []char) []Node {
	var out []Node
	for i := 0; i < len(cs); {
		var b strings.Builder
		j := i
		for ; j < len(cs) && slices.Equal(cs[j].marks, cs[i].marks); j++ {
			b.WriteRune(cs[j].r)
		}
		out = append(out, Node{Type: "text", Text: b.String(), Marks: cs[i].marks})
		i = j
	}
	return out
}

func isWordChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r)
}
