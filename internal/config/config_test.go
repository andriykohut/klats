package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsRoundTrip(t *testing.T) {
	dir := t.TempDir()

	got, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if want := (Settings{Port: 0, Language: "uk"}); got != want {
		t.Fatalf("missing file: got %+v, want %+v", got, want)
	}

	want := Settings{Port: 8080, Address: "192.168.1.5", Language: "en"}
	if err := Save(dir, want); err != nil {
		t.Fatal(err)
	}
	got, err = Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected only settings.json after Save, got %v", entries)
	}
}

func TestLoadKeepsDefaultsForAbsentKeys(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"port": 9000}`), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if want := (Settings{Port: 9000, Language: "uk"}); got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestDamagedFileLoadsTheDefaults(t *testing.T) {
	for _, data := range []string{"\x00garbage", `{"port": 70000}`, `{"port": -1}`, `{"language": "de"}`} {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
		got, err := Load(dir)
		if err == nil || got != (Settings{Language: "uk"}) {
			t.Errorf("Load of %q = %+v, %v; want the defaults and an error", data, got, err)
		}
	}
}

func TestDataDirFor(t *testing.T) {
	env := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}
	cases := []struct {
		name string
		goos string
		env  map[string]string
		want string
	}{
		{"windows", "windows", map[string]string{"AppData": "AppData"}, filepath.Join("AppData", "Klats")},
		{"darwin", "darwin", nil, filepath.Join("home", "Library", "Application Support", "Klats")},
		{"linux xdg", "linux", map[string]string{"XDG_DATA_HOME": "xdg"}, filepath.Join("xdg", "klats")},
		{"linux default", "linux", nil, filepath.Join("home", ".local", "share", "klats")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := dataDirFor(c.goos, "home", env(c.env))
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestDataDirCreatesDirectory(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "xdg"))
	t.Setenv("AppData", filepath.Join(t.TempDir(), "appdata"))
	dir, err := DataDir()
	if err != nil {
		t.Fatal(err)
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		t.Fatalf("data dir %q not created: %v", dir, err)
	}
}
