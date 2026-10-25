package grading

import (
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	"klats/internal/testfmt"
)

// numberEpsilon absorbs float error when comparing a typed number with its key.
const numberEpsilon = 1e-9

// apostrophes are the characters normalize turns into ’ (U+2019) unless
// apostrophes are strict.
const apostrophes = "'`′ʼ’"

// latinLookalikes maps the Latin letters that look like Cyrillic ones to them,
// for normalize.
var latinLookalikes = strings.NewReplacer(
	"i", "і", "a", "а", "o", "о", "e", "е", "c", "с", "p", "р", "x", "х",
	"I", "І", "A", "А", "O", "О", "E", "Е", "C", "С", "P", "Р", "X", "Х",
)

// normalize returns s in the form two typed texts are compared in: NFC,
// trimmed, every run of spaces collapsed to one, then, unless m switches it
// off, lower-cased, with apostrophe variants unified and Latin lookalikes of
// Cyrillic letters replaced.
func normalize(s string, m testfmt.Match) string {
	s = strings.Join(strings.Fields(norm.NFC.String(s)), " ")
	if !m.CaseSensitive {
		s = strings.ToLower(s)
	}
	if !m.StrictApostrophes {
		s = strings.Map(func(r rune) rune {
			if strings.ContainsRune(apostrophes, r) {
				return '’'
			}
			return r
		}, s)
	}
	if !m.StrictLetters {
		s = latinLookalikes.Replace(s)
	}
	return s
}

// typo1 reports whether a and b are at most one insertion, deletion,
// substitution or swap of neighbouring characters apart, counted in runes.
func typo1(a, b string) bool {
	x, y := []rune(a), []rune(b)
	if len(x) < len(y) {
		x, y = y, x
	}
	if len(x)-len(y) > 1 {
		return false
	}
	i := 0
	for i < len(y) && x[i] == y[i] {
		i++
	}
	if i == len(y) {
		return true // equal, or x has one extra rune at the end
	}
	if len(x) > len(y) {
		return slices.Equal(x[i+1:], y[i:])
	}
	if slices.Equal(x[i+1:], y[i+1:]) {
		return true
	}
	return i+1 < len(y) && x[i] == y[i+1] && x[i+1] == y[i] && slices.Equal(x[i+2:], y[i+2:])
}

// matches reports whether the typed text equals one of the accepted texts
// under the question's matching switches. A blank accepted text matches
// nothing. With AllowTypo, one typo is forgiven only for an accepted text of at
// least 4 characters without a digit, so a year or a symbol must be exact.
func matches(text string, accepted []string, m *testfmt.Match) bool {
	var sw testfmt.Match
	if m != nil {
		sw = *m
	}
	got := normalize(text, sw)
	return slices.ContainsFunc(accepted, func(a string) bool {
		want := normalize(a, sw)
		if want == "" {
			return false
		}
		forgiving := sw.AllowTypo && utf8.RuneCountInString(want) >= 4 && !strings.ContainsFunc(want, unicode.IsDigit)
		return got == want || forgiving && typo1(got, want)
	})
}

// judgeShort judges a short text answer: full points when it matches an
// accepted text. The verdict holds "" once the text is not blank.
func judgeShort(q testfmt.Question, a testfmt.Answer) Verdict {
	if strings.TrimSpace(a.Text) == "" {
		return Verdict{}
	}
	ok := matches(a.Text, q.Accepted, q.Match)
	return Verdict{Points: pointsIf(q, ok), Items: map[string]bool{"": ok}}
}

// judgeNumber judges a number answer: full points when the text parses and
// lies within the key. The verdict holds "" once the text is not blank. A
// question without a key, or with an unknown mode, earns 0.
func judgeNumber(q testfmt.Question, a testfmt.Answer) Verdict {
	if strings.TrimSpace(a.Text) == "" {
		return Verdict{}
	}
	x, ok := parseNumber(a.Text)
	ok = ok && q.Number != nil && withinKey(x, *q.Number)
	return Verdict{Points: pointsIf(q, ok), Items: map[string]bool{"": ok}}
}

func pointsIf(q testfmt.Question, ok bool) float64 {
	if ok {
		return float64(q.Points)
	}
	return 0
}

func withinKey(x float64, k testfmt.NumberKey) bool {
	switch k.Mode {
	case "exact":
		return math.Abs(x-k.Value) <= numberEpsilon*math.Max(1, math.Abs(k.Value))
	case "tolerance":
		return math.Abs(x-k.Value) <= k.Tolerance+numberEpsilon
	case "range":
		return k.Min-numberEpsilon <= x && x <= k.Max+numberEpsilon
	}
	return false
}

// parseNumber reads a typed number: an optional sign (+, - or −), digits with
// at most one decimal separator (, or .), and spaces between digits, which are
// dropped. Anything else, such as a unit or an exponent, fails.
func parseNumber(s string) (float64, bool) {
	rs := []rune(strings.TrimSpace(s))
	var b strings.Builder
	for i, r := range rs {
		switch {
		case unicode.IsSpace(r):
			if i == 0 || i == len(rs)-1 || !isDigit(rs[i-1]) || !isDigit(rs[i+1]) {
				return 0, false
			}
		case r == '+' || r == '-' || r == '−':
			if i != 0 {
				return 0, false
			}
			if r != '+' {
				b.WriteByte('-')
			}
		case r == ',' || r == '.':
			b.WriteByte('.')
		case isDigit(r):
			b.WriteRune(r)
		default:
			return 0, false
		}
	}
	// Separators beyond the first are left for ParseFloat to reject.
	x, err := strconv.ParseFloat(b.String(), 64)
	return x, err == nil
}

func isDigit(r rune) bool { return '0' <= r && r <= '9' }

// judgeGaps judges a gaps answer. A list gap is right when the picked choice is
// the correct one, and a typed gap when its text matches an accepted text. With
// N gaps, c right and w wrong list picks, the points are
// points * max(0, (c - w) / N), or, without Partial, all points when c is N. A
// wrong typed gap costs nothing under Partial. The verdict holds each answered
// gap; a blank typed gap and an unknown pick are unanswered.
func judgeGaps(q testfmt.Question, a testfmt.Answer) Verdict {
	v := Verdict{Items: map[string]bool{}}
	n, c, w := len(q.Gaps), 0, 0
	for _, g := range q.Gaps {
		given := a.Pairs[g.ID]
		var right bool
		if len(g.Choices) == 0 {
			if strings.TrimSpace(given) == "" {
				continue
			}
			right = matches(given, g.Accepted, q.Match)
			v.Items[g.ID] = right
			if right {
				c++
			}
			continue
		}
		i := slices.IndexFunc(g.Choices, func(ch testfmt.Choice) bool { return ch.ID == given })
		if i < 0 {
			continue
		}
		right = g.Choices[i].Correct
		v.Items[g.ID] = right
		if right {
			c++
		} else {
			w++
		}
	}
	v.Points = partialPoints(q, n, c, w)
	return v
}
