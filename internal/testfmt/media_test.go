package testfmt

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTestMedia(t *testing.T) {
	a, b := strings.Repeat("a", 64)+".png", strings.Repeat("b", 64)+".webp"
	text := `{"type":"doc","content":[{"type":"image","attrs":{"src":"` + a + `","w":8,"h":6}}]}`
	tst := Test{Questions: []Question{{
		ID: "q1", Text: json.RawMessage(text),
		Options: []Option{{ID: "o1", Image: &Image{Src: b, W: 10, H: 10}}, {ID: "o2", Image: &Image{Src: a, W: 10, H: 10}}},
	}}}
	if got := tst.Media(); len(got) != 2 || got[0] != a || got[1] != b {
		t.Errorf("Media() = %v, want [%s %s]", got, a, b)
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
