package testfmt

import (
	"encoding/json"
	"os"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func TestDecodeSettingsDefaults(t *testing.T) {
	got := decode(t, []byte(`{"id":"t1","version":1,"title":"T","questions":[]}`)).Settings
	if want := DefaultSettings(); !reflect.DeepEqual(got, want) {
		t.Fatalf("settings = %+v, want %+v", got, want)
	}
}

func TestDefaultSettingsOwnsItsThresholds(t *testing.T) {
	DefaultSettings().Scale.Thresholds[0] = 99
	if DefaultThresholds[0] != 16 || DefaultSettings().Scale.Thresholds[0] != 16 {
		t.Fatal("DefaultSettings shares its thresholds with the package default")
	}
}

func TestDefaultThresholdsMatchWeb(t *testing.T) {
	src, err := os.ReadFile("../../web/shared/src/grades.ts")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`DEFAULT_THRESHOLDS = \[([\d,\s]+)\]`).FindSubmatch(src)
	if m == nil {
		t.Fatal("DEFAULT_THRESHOLDS not found in grades.ts")
	}
	var web []int
	for _, f := range strings.Split(string(m[1]), ",") {
		n, err := strconv.Atoi(strings.TrimSpace(f))
		if err != nil {
			t.Fatal(err)
		}
		web = append(web, n)
	}
	if !slices.Equal(web, DefaultThresholds) {
		t.Fatalf("web DEFAULT_THRESHOLDS = %v, Go DefaultThresholds = %v", web, DefaultThresholds)
	}
}

func TestDecodeSettingsKeepsValues(t *testing.T) {
	want := Settings{
		TimeLimit:        TimeLimit{Mode: TimeCommon, Minutes: 45},
		ShuffleQuestions: true,
		Draw:             []DrawLine{{Count: 7}, {Tag: "Мережі", Count: 2}},
		Scale:            Scale{Kind: ScalePass, Thresholds: []int{10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100}, Pass: 75},
		Reveal:           RevealMistakes,
		Navigation:       NavForward,
	}
	raw, err := json.Marshal(Test{ID: "t1", Version: 1, Title: "T", Questions: []Question{}, Settings: want})
	if err != nil {
		t.Fatal(err)
	}
	first := decode(t, raw)
	if !reflect.DeepEqual(first.Settings, want) {
		t.Fatalf("settings = %+v, want %+v", first.Settings, want)
	}
	again, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	if second := decode(t, again); !reflect.DeepEqual(second.Settings, want) {
		t.Fatalf("second decode = %+v, want %+v", second.Settings, want)
	}
}

func TestDecodeSettingsInvalid(t *testing.T) {
	rising := func(first int) []int {
		out := slices.Clone(DefaultThresholds)
		out[0] = first
		return out
	}
	cases := []struct {
		name string
		edit func(*Settings)
	}{
		{"unknown mode", func(s *Settings) { s.TimeLimit = TimeLimit{Mode: "hour", Minutes: 10} }},
		{"student mode without minutes", func(s *Settings) { s.TimeLimit = TimeLimit{Mode: TimeStudent} }},
		{"too many minutes", func(s *Settings) { s.TimeLimit = TimeLimit{Mode: TimeStudent, Minutes: 301} }},
		{"draw count 0", func(s *Settings) { s.Draw = []DrawLine{{Count: 0}} }},
		{"draw count over 1000", func(s *Settings) { s.Draw = []DrawLine{{Count: 1001}} }},
		{"101 draw lines", func(s *Settings) { s.Draw = slices.Repeat([]DrawLine{{Count: 1}}, 101) }},
		{"draw tag over 200 runes", func(s *Settings) { s.Draw = []DrawLine{{Tag: strings.Repeat("я", 201), Count: 1}} }},
		{"blank draw tag", func(s *Settings) { s.Draw = []DrawLine{{Tag: "  ", Count: 1}} }},
		{"ten thresholds", func(s *Settings) { s.Scale.Thresholds = DefaultThresholds[:10] }},
		{"repeated threshold", func(s *Settings) { s.Scale.Thresholds = rising(25) }},
		{"threshold over 100", func(s *Settings) { s.Scale.Thresholds[10] = 101 }},
		{"threshold of 0", func(s *Settings) { s.Scale.Thresholds = rising(0) }},
		{"pass over 100", func(s *Settings) { s.Scale.Pass = 101 }},
		{"unknown reveal", func(s *Settings) { s.Reveal = "all" }},
		{"unknown navigation", func(s *Settings) { s.Navigation = "back" }},
		{"unknown scale", func(s *Settings) { s.Scale.Kind = "letters" }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := DefaultSettings()
			c.edit(&s)
			raw, err := json.Marshal(Test{ID: "t1", Version: 1, Title: "T", Questions: []Question{}, Settings: s})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := Decode(raw); err == nil {
				t.Fatal("Decode accepted the settings")
			}
		})
	}
}

func TestDecodeTrimsDrawTag(t *testing.T) {
	tst := decode(t, []byte(`{"id":"t1","version":1,"title":"T","questions":[],"settings":{"draw":[{"tag":" Мережі ","count":1}]}}`))
	if want := []DrawLine{{Tag: "Мережі", Count: 1}}; !slices.Equal(tst.Settings.Draw, want) {
		t.Fatalf("draw = %+v, want %+v", tst.Settings.Draw, want)
	}
}

func TestDecodeThresholdsNeverNull(t *testing.T) {
	tst := decode(t, []byte(`{"id":"t1","version":1,"title":"T","questions":[],"settings":{"scale":{"thresholds":null}}}`))
	out, err := json.Marshal(tst)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"thresholds":[16,`) {
		t.Fatalf("json = %s", out)
	}
}

func TestDecodeKeepsThresholdsAndPassOfAnotherScale(t *testing.T) {
	tst := decode(t, []byte(`{"id":"t1","version":1,"title":"T","questions":[],"settings":{"scale":{"kind":"percent","pass":70}}}`))
	if s := tst.Settings.Scale; s.Kind != ScalePercent || s.Pass != 70 || !slices.Equal(s.Thresholds, DefaultThresholds) {
		t.Fatalf("scale = %+v", s)
	}
}
