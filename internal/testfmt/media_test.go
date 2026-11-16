package testfmt

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func TestTestMedia(t *testing.T) {
	a := strings.Repeat("a", 64) + ".png"
	b, c := strings.Repeat("b", 64)+".webp", strings.Repeat("b", 64)+".png"
	text := `{"type":"doc","content":[{"type":"image","attrs":{"src":"` + a + `","w":8,"h":6}}]}`
	for name, row := range map[string]struct {
		q    Question
		want []string
	}{
		"text and option images": {Question{
			ID: "q1", Text: json.RawMessage(text),
			Options: []Option{{ID: "o1", Image: &Image{Src: b, W: 10, H: 10}}, {ID: "o2", Image: &Image{Src: a, W: 10, H: 10}}},
		}, []string{a, b}},
		"question and target images": {Question{
			ID: "q1", Image: &Image{Src: a, W: 1, H: 1}, Targets: []Target{{ID: "t", Image: &Image{Src: c, W: 1, H: 1}}},
		}, []string{a, c}},
	} {
		if got := (Test{Questions: []Question{row.q}}).Media(); !slices.Equal(got, row.want) {
			t.Errorf("%s: Media() = %v, want %v", name, got, row.want)
		}
	}
}

func TestDecodeOptionImage(t *testing.T) {
	src := strings.Repeat("c", 64)
	for name, c := range map[string]struct {
		image string
		ok    bool
	}{
		"valid":      {`{"src":"` + src + `.png","w":800,"h":600}`, true},
		"audio name": {`{"src":"` + src + `.mp3","w":800,"h":600}`, false},
		"bad name":   {`{"src":"../x.png","w":800,"h":600}`, false},
		"zero width": {`{"src":"` + src + `.png","w":0,"h":600}`, false},
		"too tall":   {`{"src":"` + src + `.png","w":8,"h":10001}`, false},
	} {
		raw := `{"id":"t","version":1,"title":"T","palette":"teal","questions":[{"id":"q","type":"single","points":1,"options":[{"id":"o","image":` + c.image + `}]}]}`
		tst, err := Decode([]byte(raw))
		if (err == nil) != c.ok {
			t.Errorf("%s: err = %v", name, err)
		}
		if c.ok && (tst.Questions[0].Options[0].Image == nil || tst.Questions[0].Options[0].Image.Src != src+".png") {
			t.Errorf("%s: image lost: %+v", name, tst.Questions[0].Options[0])
		}
	}
}
