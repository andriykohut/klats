package testfmt

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"
)

// Settings say how a test runs. A zero Settings is not valid: [Decode] fills
// in the defaults of [DefaultSettings] for every field left empty.
type Settings struct {
	TimeLimit TimeLimit `json:"timeLimit"`
	// ShuffleQuestions gives each student the questions in an order of their own.
	ShuffleQuestions bool `json:"shuffleQuestions"`
	// Draw picks each student's questions at random. Its lines run top to
	// bottom, and each picks Count of the questions carrying its Tag (any
	// question for an empty Tag) that no earlier line picked, or fewer when
	// they run out. Empty means everyone gets every question.
	Draw       []DrawLine `json:"draw,omitempty"`
	Scale      Scale      `json:"scale"`
	Reveal     string     `json:"reveal"`
	Navigation string     `json:"navigation"`
}

// DrawLine is one line of [Settings.Draw]: Count questions, 1-1000, from those
// tagged Tag, or from every question when Tag is empty.
type DrawLine struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

// TimeLimit is the time students get. Minutes is 1-300 unless Mode is
// [TimeNone]; for [TimeCommon] it is the length the start dialog proposes.
type TimeLimit struct {
	Mode    string `json:"mode"`
	Minutes int    `json:"minutes"`
}

// Scale turns a percent of the points into a grade. Thresholds hold the
// lowest percent for grades 2-12 of [ScalePoints12], and Pass the lowest
// percent that passes [ScalePass]. Both are kept whatever Kind is, so a
// teacher who switches scales and back keeps the table.
type Scale struct {
	Kind       string `json:"kind"`
	Thresholds []int  `json:"thresholds"`
	Pass       int    `json:"pass"`
}

// Values of [TimeLimit.Mode], [Scale.Kind], [Settings.Reveal] and
// [Settings.Navigation].
const (
	TimeNone    = "none"
	TimeStudent = "student"
	TimeCommon  = "common"

	ScalePoints12 = "points12"
	ScalePercent  = "percent"
	ScalePass     = "pass"

	RevealGrade    = "grade"
	RevealMistakes = "mistakes"
	RevealNothing  = "nothing"

	NavFree    = "free"
	NavForward = "forward"
)

// DefaultThresholds is the lowest percent for grades 2-12: grade g needs g/12
// of the points, in whole percents.
var DefaultThresholds = []int{16, 25, 33, 41, 50, 58, 66, 75, 83, 91, 100}

// DefaultPass is the lowest percent that passes [ScalePass] by default.
const DefaultPass = 60

const (
	maxMinutes   = 300
	maxDrawLines = 100
	maxDrawCount = 1000
)

// DefaultSettings returns the settings of a new test. Its Thresholds are a
// copy the caller may change.
func DefaultSettings() Settings {
	return Settings{
		TimeLimit:  TimeLimit{Mode: TimeNone},
		Scale:      Scale{Kind: ScalePoints12, Thresholds: slices.Clone(DefaultThresholds), Pass: DefaultPass},
		Reveal:     RevealGrade,
		Navigation: NavFree,
	}
}

// decode fills in the defaults of an empty field, trims the draw tags and
// rejects a value outside the allowed ones.
func (s *Settings) decode() error {
	def := DefaultSettings()
	if s.TimeLimit.Mode == "" {
		s.TimeLimit.Mode = def.TimeLimit.Mode
	}
	if s.Scale.Kind == "" {
		s.Scale.Kind = def.Scale.Kind
	}
	if s.Scale.Thresholds == nil {
		s.Scale.Thresholds = def.Scale.Thresholds
	}
	if s.Scale.Pass == 0 {
		s.Scale.Pass = def.Scale.Pass
	}
	if s.Reveal == "" {
		s.Reveal = def.Reveal
	}
	if s.Navigation == "" {
		s.Navigation = def.Navigation
	}

	if !slices.Contains([]string{TimeNone, TimeStudent, TimeCommon}, s.TimeLimit.Mode) {
		return fmt.Errorf("unknown time limit mode %q", s.TimeLimit.Mode)
	}
	if m := s.TimeLimit.Minutes; m < 0 || m > maxMinutes || (m == 0 && s.TimeLimit.Mode != TimeNone) {
		return fmt.Errorf("time limit of %d minutes outside 1-%d", m, maxMinutes)
	}
	if err := s.decodeDraw(); err != nil {
		return err
	}
	if !slices.Contains([]string{ScalePoints12, ScalePercent, ScalePass}, s.Scale.Kind) {
		return fmt.Errorf("unknown scale %q", s.Scale.Kind)
	}
	if err := checkThresholds(s.Scale.Thresholds); err != nil {
		return err
	}
	if s.Scale.Pass < 1 || s.Scale.Pass > 100 {
		return fmt.Errorf("pass mark %d outside 1-100", s.Scale.Pass)
	}
	if !slices.Contains([]string{RevealGrade, RevealMistakes, RevealNothing}, s.Reveal) {
		return fmt.Errorf("unknown reveal %q", s.Reveal)
	}
	if !slices.Contains([]string{NavFree, NavForward}, s.Navigation) {
		return fmt.Errorf("unknown navigation %q", s.Navigation)
	}
	return nil
}

// decodeDraw trims the tag of each draw line and rejects a draw outside the
// caps or a tag of only white space.
func (s *Settings) decodeDraw() error {
	if len(s.Draw) > maxDrawLines {
		return fmt.Errorf("%d draw lines, at most %d", len(s.Draw), maxDrawLines)
	}
	for i := range s.Draw {
		l := &s.Draw[i]
		if l.Count < 1 || l.Count > maxDrawCount {
			return fmt.Errorf("draw count %d outside 1-%d", l.Count, maxDrawCount)
		}
		tag := strings.TrimSpace(l.Tag)
		if tag == "" && l.Tag != "" {
			return errors.New("blank draw tag")
		}
		if utf8.RuneCountInString(tag) > maxTextRunes {
			return fmt.Errorf("draw tag over %d characters", maxTextRunes)
		}
		l.Tag = tag
	}
	return nil
}

func checkThresholds(th []int) error {
	if len(th) != len(DefaultThresholds) {
		return fmt.Errorf("%d thresholds, want %d", len(th), len(DefaultThresholds))
	}
	for i, v := range th {
		if v < 1 || v > 100 || (i > 0 && v <= th[i-1]) {
			return fmt.Errorf("thresholds must rise strictly within 1-100")
		}
	}
	return nil
}
