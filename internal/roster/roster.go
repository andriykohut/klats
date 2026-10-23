// Package roster turns class lists pasted from a spreadsheet or class journal
// into clean student names, and sorts and disambiguates them with Ukrainian
// collation.
package roster

import (
	"encoding/hex"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

var (
	apostrophes = strings.NewReplacer("'", "’", "ʼ", "’", "`", "’", "‘", "’", "′", "’")
	rowNumber   = regexp.MustCompile(`^(\d+\.?|№)$`)
	numbered    = regexp.MustCompile(`^\d+[.)]\s*`)
)

// ParsePaste returns the normalised student names found in pasted text, one per
// line. Tab-separated cells are joined with a space after dropping a leading
// row number (digits, optionally with a dot, or «№»), and numbering at the
// start of the name («1. », «1) », «1.») is dropped too. Blank lines and
// header lines whose first cell starts with «№» (as «№ з/п») or is «ПІБ» are
// skipped.
func ParsePaste(text string) []string {
	var names []string
	for line := range strings.Lines(text) {
		var cells []string
		for _, c := range strings.Split(line, "\t") {
			if c = strings.TrimSpace(c); c != "" {
				cells = append(cells, c)
			}
		}
		if len(cells) == 0 || strings.HasPrefix(cells[0], "№") || cells[0] == "ПІБ" {
			continue
		}
		if rowNumber.MatchString(cells[0]) {
			cells = cells[1:]
		}
		if name := Normalize(numbered.ReplaceAllString(strings.Join(cells, " "), "")); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// Normalize returns name in NFC with apostrophe variants folded into ’
// (U+2019), whitespace runs collapsed to one space and the ends trimmed.
func Normalize(name string) string {
	return strings.Join(strings.Fields(apostrophes.Replace(norm.NFC.String(name))), " ")
}

// Sort orders names in place by Ukrainian collation of their normalised form.
// Names with equal keys keep their relative order.
func Sort(names []string) {
	c := collate.New(language.Ukrainian)
	slices.SortStableFunc(names, func(a, b string) int {
		return c.CompareString(Normalize(a), Normalize(b))
	})
}

// SortKey returns the hex-encoded Ukrainian collation key of the normalised
// name. Comparing keys as strings gives the same order as [Sort], so it can be
// stored and used in an SQL ORDER BY.
func SortKey(name string) string {
	var buf collate.Buffer
	return hex.EncodeToString(collate.New(language.Ukrainian).KeyFromString(&buf, Normalize(name)))
}

// Disambiguate returns the normalised names with « (2)», « (3)» appended to
// repeats of the same full name, in list order. The input is not modified.
func Disambiguate(names []string) []string {
	seen := make(map[string]int, len(names))
	out := make([]string, len(names))
	for i, n := range names {
		n = Normalize(n)
		seen[n]++
		if k := seen[n]; k > 1 {
			n = fmt.Sprintf("%s (%d)", n, k)
		}
		out[i] = n
	}
	return out
}
