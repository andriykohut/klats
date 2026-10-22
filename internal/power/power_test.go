package power

import (
	"slices"
	"testing"
)

func TestPowerCommand(t *testing.T) {
	for _, c := range []struct {
		goos string
		want []string
	}{
		{"darwin", []string{"caffeinate", "-i", "-w", "42"}},
		{"linux", []string{"systemd-inhibit", "--what=idle:sleep", "--who=Klats", "--why=Тест триває", "tail", "--pid=42", "-f", "/dev/null"}},
		{"windows", nil},
	} {
		if got := command(c.goos, 42, "Тест триває"); !slices.Equal(got, c.want) {
			t.Errorf("command(%s) = %q, want %q", c.goos, got, c.want)
		}
	}
}

func TestInhibitReleaseTwice(t *testing.T) {
	release, err := Inhibit("test")
	if err != nil {
		t.Fatal(err)
	}
	release()
	release()
}
