package mtf

import (
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/andriykohut/klats/internal/rich"
)

func txt(s string, marks ...string) rich.Node {
	n := rich.Node{Type: "text", Text: s}
	for _, m := range marks {
		n.Marks = append(n.Marks, rich.Mark{Type: m})
	}
	return n
}

func img(i int) rich.Node {
	return rich.Node{Type: "image", Attrs: &rich.Attrs{Src: "pict:" + strconv.Itoa(i)}}
}

var br = rich.Node{Type: "hardBreak"}

func js(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func wantParas(t *testing.T, src string, want [][]rich.Node) {
	t.Helper()
	if got := parseRTF(src).Paras; !reflect.DeepEqual(got, want) {
		t.Errorf("parseRTF(%q).Paras = %s, want %s", src, js(got), js(want))
	}
}

// counts returns the runes of the text nodes in r and the number of nodes.
func counts(r rtfText) (runes, nodes int) {
	for _, para := range r.Paras {
		for _, n := range para {
			runes += utf8.RuneCountInString(n.Text)
			nodes++
		}
	}
	return runes, nodes
}

func TestRTFPlainCyrillic(t *testing.T) {
	wantParas(t, `{\rtf1\ansi\ansicpg1251{\fonttbl{\f0\fnil\fcharset204 Times New Roman;}}\f0 \'cf\'f0\'e8\'e2\'b3\'f2\par}`,
		[][]rich.Node{{txt("Привіт")}})
}

func TestRTFNotRTF(t *testing.T) {
	wantParas(t, `2 + 2 {\b x}`, [][]rich.Node{{txt(`2 + 2 {\b x}`)}})
	if got := parseRTF("").Paras; len(got) != 0 {
		t.Errorf(`parseRTF("").Paras = %s, want none`, js(got))
	}
}

func TestRTFFontCharsetWins(t *testing.T) {
	const word = `\'cf\'f0\'e8\'e2\'b3\'f2`
	cases := []struct{ head, body, want string }{
		{`\ansicpg1252{\fonttbl{\f0\fnil\fcharset204 Times New Roman;}}`, `\f0 ` + word, "Привіт"},
		{`\ansicpg1251{\fonttbl{\f0\fnil\fcharset0 Arial;}}`, `\f0 ` + word, "Ïðèâ³ò"},
		{`\ansicpg1251{\fonttbl{\f0\fnil\fcharset238 Arial;}}`, `\f0 ` + word, "Ďđčâłň"},
		{`\ansicpg1252{\fonttbl{\f0\fnil\fcharset134 SimSun;}}`, `\f0 ` + word, "Привіт"},
		{`\ansicpg1252{\fonttbl{\f0\fnil\fcharset0 Arial;}}`, `\f3 ` + word, "Привіт"},
		{`\ansicpg1252{\fonttbl{\f0\fnil\fcharset0 Arial;}{\f1\fnil\fcharset204 Tahoma;}}`, `\f0 \'cf{\f1 \'cf}\'cf`, "ÏПÏ"},
		{`\ansicpg1252{\fonttbl\f0\fswiss\fcharset0 Arial;\f1\fnil\fcharset204 Tahoma;}`, `\f1 ` + word, "Привіт"},
	}
	for _, c := range cases {
		wantParas(t, `{\rtf1\ansi`+c.head+c.body+`}`, [][]rich.Node{{txt(c.want)}})
	}
}

func TestRTFUnicode(t *testing.T) {
	cases := map[string]string{
		`\u1111?x`:          "їx",
		`\uc2\u1111??x`:     "їx",
		`\u-3999?`:          "\uf061",
		`\u1111\'3fx`:       "їx",
		`\u-10179?\u-8704?`: "😀",
	}
	for body, want := range cases {
		wantParas(t, `{\rtf1 `+body+`}`, [][]rich.Node{{txt(want)}})
	}
}

func TestRTFMarks(t *testing.T) {
	wantParas(t, `{\rtf1 {\b bold} {\i it\i0 } {\super 2}{\sub 3}{\ul u}{\cf2\fs40 c}}`, [][]rich.Node{{
		txt("bold", "bold"), txt(" "), txt("it", "italic"), txt(" "),
		txt("2", "superscript"), txt("3", "subscript"), txt("uc"),
	}})
	wantParas(t, `{\rtf1 \b\i a{\b b}\b0 c\plain d\super e\sub f\nosupersub g}`, [][]rich.Node{{
		txt("ab", "bold", "italic"), txt("c", "italic"), txt("d"),
		txt("e", "superscript"), txt("f", "subscript"), txt("g"),
	}})
}

func TestRTFParagraphs(t *testing.T) {
	wantParas(t, `{\rtf1 \par a\par b\line c\par\par}`, [][]rich.Node{{txt("a")}, {txt("b"), br, txt("c")}})
	wantParas(t, `{\rtf1 a\par\par b}`, [][]rich.Node{{txt("a")}, nil, {txt("b")}})
}

func TestRTFSkipsDestinations(t *testing.T) {
	wantParas(t, `{\rtf1\ansi{\fonttbl{\f0\fnil\fcharset204 Font;}}{\colortbl ;\red0\green0\blue0;}`+
		`{\stylesheet{\s0 Style;}}{\info{\title Info}}{\*\generator Riched20;}\f0 a{\*\objdata 0102}b{\*\other x}c}`,
		[][]rich.Node{{txt("abc")}})
}

func TestRTFPict(t *testing.T) {
	got := parseRTF(`{\rtf1 a{\pict\wmetafile8\picw10\pich10 01 02` + "\r\n" + `ff}b}`)
	if want := [][]rich.Node{{txt("a"), img(0), txt("b")}}; !reflect.DeepEqual(got.Paras, want) {
		t.Errorf("Paras = %s, want %s", js(got.Paras), js(want))
	}
	if want := []pict{{"wmetafile", []byte{1, 2, 0xff}}}; !reflect.DeepEqual(got.Picts, want) {
		t.Errorf("Picts = %v, want %v", got.Picts, want)
	}

	got = parseRTF(`{\rtf1 {\pict{\*\blipuid 0123}\pngblip 89}{\pict\emfblip 0a}}`)
	if want := [][]rich.Node{{img(0), img(1)}}; !reflect.DeepEqual(got.Paras, want) {
		t.Errorf("Paras = %s, want %s", js(got.Paras), js(want))
	}
	if want := []pict{{"pngblip", []byte{0x89}}, {"emfblip", []byte{0x0a}}}; !reflect.DeepEqual(got.Picts, want) {
		t.Errorf("Picts = %v, want %v", got.Picts, want)
	}
}

func TestRTFObjectResult(t *testing.T) {
	got := parseRTF(`{\rtf1 {\object\objemb{\*\objclass PBrush}{\*\objdata 0102}{\result{\pict\wmetafile8 0a0b}}}}`)
	if want := [][]rich.Node{{img(0)}}; !reflect.DeepEqual(got.Paras, want) {
		t.Errorf("Paras = %s, want %s", js(got.Paras), js(want))
	}
	if want := []pict{{"wmetafile", []byte{0x0a, 0x0b}}}; !reflect.DeepEqual(got.Picts, want) {
		t.Errorf("Picts = %v, want %v", got.Picts, want)
	}
}

func TestRTFSpecials(t *testing.T) {
	cases := map[string]string{
		`a\~b`:                               "a b",
		`a\-b`:                               "ab",
		`a\_b`:                               "a-b",
		`\emdash\endash\bullet`:              "—–•",
		`a\tab b`:                            "a b",
		`\lquote\rquote\ldblquote\rdblquote`: "‘’“”",
		`\{ \} \\`:                           `{ } \`,
	}
	for body, want := range cases {
		wantParas(t, `{\rtf1 `+body+`}`, [][]rich.Node{{txt(want)}})
	}
}

func TestRTFCut(t *testing.T) {
	got := parseRTF(`{\rtf1 ` + strings.Repeat("a", 25000) + `}`)
	if runes, _ := counts(got); runes != 20000 || !got.Cut {
		t.Errorf("25,000 letters: %d runes, Cut %v; want 20000, true", runes, got.Cut)
	}
	got = parseRTF(`{\rtf1 ` + strings.Repeat("a", 20000) + `\par}`)
	if runes, _ := counts(got); runes != 20000 || got.Cut {
		t.Errorf("20,000 letters: %d runes, Cut %v; want 20000, false", runes, got.Cut)
	}
	got = parseRTF(`{\rtf1 ` + strings.Repeat(`\line `, 25000) + `}`)
	if _, nodes := counts(got); nodes > 20000 || !got.Cut {
		t.Errorf("25,000 line breaks: %d nodes, Cut %v; want ≤ 20000, true", nodes, got.Cut)
	}
}

func TestRTFDeepGroups(t *testing.T) {
	wantParas(t, `{\rtf1 `+strings.Repeat("{", 5000)+"x"+strings.Repeat("}", 5000)+"y}", [][]rich.Node{{txt("y")}})
}

func FuzzRTF(f *testing.F) {
	f.Add(`{\rtf1\ansi\ansicpg1251{\fonttbl{\f0\fnil\fcharset204 Times New Roman;}}\f0 \'cf\'f0{\b x}\u1111?\par a\line` +
		`{\pict\wmetafile8 0102}{\object{\*\objdata 01}{\result{\pict\pngblip 03}}}}`)
	f.Add("plain text")
	f.Fuzz(func(t *testing.T, src string) {
		got := parseRTF(src)
		runes, _ := counts(got)
		if runes > 20000 {
			t.Errorf("%d runes of text, want ≤ 20000", runes)
		}
		images := 0
		for _, para := range got.Paras {
			for _, n := range para {
				if n.Type == "image" {
					images++
				}
			}
		}
		if images != len(got.Picts) {
			t.Errorf("%d image nodes for %d pictures", images, len(got.Picts))
		}
	})
}
