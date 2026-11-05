package mtf

import (
	"encoding/hex"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"

	"klats/internal/rich"
)

const (
	// maxRTFRunes caps the text of one RTF string, as the rich-text document
	// cap does, and separately its paragraph breaks, line breaks and pictures,
	// so that a string of empty paragraphs cannot grow into millions of nodes.
	maxRTFRunes = 20000
	maxGroups   = 1000
	maxFonts    = 1000
	maxParam    = 1 << 20
)

// pict is a picture embedded in RTF text.
type pict struct {
	// Kind is the control word naming the picture's format: "wmetafile",
	// "jpegblip", "pngblip", another one such as "emfblip", or "" when the
	// picture names none.
	Kind string
	Data []byte
}

// rtfText is the visible content of an RTF string.
type rtfText struct {
	// Paras holds the paragraphs, without leading and trailing empty ones,
	// each a list of text nodes (marked bold, italic, superscript or
	// subscript), hardBreak nodes and image placeholders. A placeholder's Src
	// "pict:N" refers to Picts[N].
	Paras [][]rich.Node
	Picts []pict
	// Cut reports that the text went over 20,000 runes, or its paragraph
	// breaks, line breaks and pictures over 20,000 in all, and that
	// everything from there on was dropped.
	Cut bool
}

// parseRTF returns the visible content of src, an RTF document as the older
// format stores it, keeping bold, italic, superscript and subscript and
// dropping every other style. A \'xx byte is decoded by the charset of the
// current font rather than by \ansicpg: Western for charset 0, Central
// European for 238 and Cyrillic for any other charset or an unlisted font.
// The font and colour tables, the style sheet, the document info, the
// ignorable \* destinations and embedded objects are skipped, except an
// object's \result. Groups nested over 1,000 deep are skipped too, and
// parsing ends where the outermost group closes. A src not starting with
// {\rtf is one plain paragraph.
func parseRTF(src string) rtfText {
	p := rtfParser{stack: []rtfState{{uc: 1}}, charsets: map[int]int{}}
	if !strings.HasPrefix(src, `{\rtf`) {
		for _, r := range src {
			p.char(r)
		}
		return p.result()
	}
	for i := 0; i < len(src) && !p.cut; {
		switch src[i] {
		case '{':
			p.open()
			i++
		case '}':
			if p.close() {
				return p.result()
			}
			i++
		case '\\':
			i = p.control(src, i+1)
		case '\r', '\n':
			i++
		default:
			r, n := utf8.DecodeRuneInString(src[i:])
			p.char(r)
			i += n
		}
	}
	return p.result()
}

const (
	bold uint8 = 1 << iota
	italic
	superscript
	subscript
)

// markNames holds the rich-text mark of each bit of rtfState.marks.
var markNames = [...]string{"bold", "italic", "superscript", "subscript"}

// pictKinds holds the control words that name a picture's format.
var pictKinds = map[string]bool{
	"wmetafile": true, "emfblip": true, "pngblip": true, "jpegblip": true,
	"macpict": true, "pmmetafile": true, "dibitmap": true, "wbitmap": true,
}

// specials maps the control words that stand for a character to it.
var specials = map[string]rune{
	"tab": ' ', "emdash": '—', "endash": '–', "bullet": '•',
	"lquote": '‘', "rquote": '’', "ldblquote": '“', "rdblquote": '”',
}

// rtfState is what a group inherits from its parent and drops on closing.
type rtfState struct {
	marks  uint8
	font   int
	uc     int  // fallback characters that follow a \u
	skip   bool // the group shows nothing
	fonts  bool // the group is in the font table
	object bool // the group is in an embedded object, whose \result shows
	pict   bool // the group's hex digits are a picture's data
}

type rtfParser struct {
	stack    []rtfState
	deep     int // groups open beyond maxGroups
	charsets map[int]int
	ucSkip   int  // fallback characters of the last \u not yet dropped
	high     rune // a high surrogate waiting for its pair

	run      strings.Builder // text not yet in a node, all with runMarks
	runMarks uint8
	para     []rich.Node
	paras    [][]rich.Node
	picts    []pict
	kind     string // the picture being read
	hex      []byte

	runes, nodes int
	cut          bool
}

func (p *rtfParser) top() *rtfState { return &p.stack[len(p.stack)-1] }

func (p *rtfParser) open() {
	p.ucSkip = 0
	if p.deep > 0 || len(p.stack) > maxGroups {
		p.deep++
		return
	}
	p.stack = append(p.stack, *p.top())
}

// close ends the innermost group and reports whether it was the outermost.
func (p *rtfParser) close() bool {
	p.ucSkip = 0
	if p.deep > 0 {
		p.deep--
		return false
	}
	if len(p.stack) == 1 {
		return true
	}
	ended := p.top().pict
	p.stack = p.stack[:len(p.stack)-1]
	if ended && !p.top().pict {
		p.endPict()
	}
	return len(p.stack) == 1
}

// control reads the control word or symbol that follows the backslash at
// src[i-1] and returns the index after it.
func (p *rtfParser) control(src string, i int) int {
	if i == len(src) {
		return i
	}
	if !isLetter(src[i]) {
		return p.symbol(src, i)
	}
	j := i
	for j < len(src) && isLetter(src[j]) {
		j++
	}
	name := src[i:j]
	neg := j+1 < len(src) && src[j] == '-' && isDigit(src[j+1])
	if neg {
		j++
	}
	digits := j
	n := 0
	for ; j < len(src) && isDigit(src[j]); j++ {
		n = min(n*10+int(src[j]-'0'), maxParam)
	}
	hasN := j > digits
	if neg {
		n = -n
	}
	if j < len(src) && src[j] == ' ' {
		j++
	}
	p.word(name, n, hasN)
	return j
}

func (p *rtfParser) symbol(src string, i int) int {
	switch c := src[i]; c {
	case '\'':
		if i+3 <= len(src) {
			if b, err := strconv.ParseUint(src[i+1:i+3], 16, 8); err == nil {
				p.char(p.codePage().DecodeByte(byte(b)))
				return i + 3
			}
		}
	case '~':
		p.char(' ')
	case '_':
		p.char('-')
	case '{', '}', '\\':
		p.char(rune(c))
	case '*':
		if p.deep == 0 {
			p.top().skip = true
		}
	}
	return i + 1
}

// word applies the control word name with its parameter n, which is 0 when
// hasN is false.
func (p *rtfParser) word(name string, n int, hasN bool) {
	if p.deep > 0 {
		return
	}
	st := p.top()
	switch {
	case st.fonts:
		switch {
		case name == "f":
			st.font = n
		case name == "fcharset" && len(p.charsets) < maxFonts:
			p.charsets[st.font] = n
		}
		return
	case st.skip:
		if name == "result" && st.object {
			st.skip, st.object = false, false
		}
		return
	case st.pict:
		if pictKinds[name] {
			p.kind = name
		}
		return
	}
	switch name {
	case "fonttbl":
		st.skip, st.fonts = true, true
	case "colortbl", "stylesheet", "info":
		st.skip = true
	case "object":
		st.skip, st.object = true, true
	case "pict":
		st.pict, p.kind, p.hex = true, "", p.hex[:0]
	case "f":
		st.font = n
	case "uc":
		st.uc = n
	case "u":
		r := rune(uint16(n))
		if pair := utf16.DecodeRune(p.high, r); pair != utf8.RuneError {
			r = pair
		}
		p.high = 0
		if utf16.IsSurrogate(r) && r < 0xdc00 {
			p.high = r
		} else {
			p.emit(r, st.marks)
		}
		p.ucSkip = st.uc
	case "par":
		p.flush()
		if p.take(&p.nodes) {
			p.paras = append(p.paras, p.para)
			p.para = nil
		}
	case "line":
		p.node(rich.Node{Type: "hardBreak"})
	case "plain":
		st.marks = 0
	case "b":
		st.marks = turn(st.marks, bold, !hasN || n != 0)
	case "i":
		st.marks = turn(st.marks, italic, !hasN || n != 0)
	case "super":
		st.marks = st.marks&^subscript | superscript
	case "sub":
		st.marks = st.marks&^superscript | subscript
	case "nosupersub":
		st.marks &^= superscript | subscript
	default:
		if r, ok := specials[name]; ok {
			p.char(r)
		}
	}
}

// char takes r, a character of the document, which the current group may
// skip, read as picture data or show.
func (p *rtfParser) char(r rune) {
	st := p.top()
	switch {
	case p.deep > 0 || st.skip:
	case st.pict:
		if strings.ContainsRune("0123456789abcdefABCDEF", r) {
			p.hex = append(p.hex, byte(r))
		}
	case p.ucSkip > 0:
		p.ucSkip--
	default:
		p.emit(r, st.marks)
	}
}

// codePage returns the code page of the current font's charset.
func (p *rtfParser) codePage() *charmap.Charmap {
	cs, ok := p.charsets[p.top().font]
	switch {
	case ok && cs == 0:
		return charmap.Windows1252
	case cs == 238:
		return charmap.Windows1250
	}
	return charmap.Windows1251
}

func (p *rtfParser) emit(r rune, marks uint8) {
	if marks != p.runMarks {
		p.flush()
		p.runMarks = marks
	}
	if p.take(&p.runes) {
		p.run.WriteRune(r)
	}
}

// flush ends the current text run as a text node.
func (p *rtfParser) flush() {
	if p.run.Len() == 0 {
		return
	}
	n := rich.Node{Type: "text", Text: p.run.String()}
	for i, name := range markNames {
		if p.runMarks&(1<<i) != 0 {
			n.Marks = append(n.Marks, rich.Mark{Type: name})
		}
	}
	p.para = append(p.para, n)
	p.run.Reset()
}

// node adds n to the current paragraph and reports whether it fit the cap.
func (p *rtfParser) node(n rich.Node) bool {
	p.flush()
	if !p.take(&p.nodes) {
		return false
	}
	p.para = append(p.para, n)
	return true
}

func (p *rtfParser) endPict() {
	if !p.node(rich.Node{Type: "image", Attrs: &rich.Attrs{Src: "pict:" + strconv.Itoa(len(p.picts))}}) {
		return
	}
	data := make([]byte, len(p.hex)/2)
	_, _ = hex.Decode(data, p.hex) // an odd last digit is dropped
	p.picts = append(p.picts, pict{Kind: p.kind, Data: data})
}

// take counts one more against the cap on *n and reports whether it fits,
// marking the content cut when it does not.
func (p *rtfParser) take(n *int) bool {
	if *n == maxRTFRunes {
		p.cut = true
		return false
	}
	*n++
	return true
}

func (p *rtfParser) result() rtfText {
	p.flush()
	paras := append(p.paras, p.para)
	for len(paras) > 0 && len(paras[0]) == 0 {
		paras = paras[1:]
	}
	for len(paras) > 0 && len(paras[len(paras)-1]) == 0 {
		paras = paras[:len(paras)-1]
	}
	return rtfText{Paras: paras, Picts: p.picts, Cut: p.cut}
}

func turn(marks, m uint8, on bool) uint8 {
	if on {
		return marks | m
	}
	return marks &^ m
}

func isLetter(c byte) bool { return 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' }

func isDigit(c byte) bool { return '0' <= c && c <= '9' }
