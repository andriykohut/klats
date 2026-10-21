// Package config locates the teacher program's data folder and persists its
// small settings file.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
)

const settingsFile = "settings.json"

// Settings are the teacher's preferences, stored as settings.json in the data
// folder.
type Settings struct {
	// Port is the TCP port for the student server; 0 lets the OS pick one.
	Port int `json:"port"`
	// Address is the LAN address to serve on; empty means auto-detect.
	Address string `json:"address"`
	// Language is the UI language, "uk" or "en".
	Language string `json:"language"`
}

func defaults() Settings { return Settings{Language: "uk"} }

// DataDir returns the per-user data folder, creating it if missing:
// %AppData%\Klats on Windows, ~/Library/Application Support/Klats on macOS and
// $XDG_DATA_HOME/klats (default ~/.local/share/klats) elsewhere.
func DataDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil && runtime.GOOS != "windows" {
		return "", err
	}
	dir, err := dataDirFor(runtime.GOOS, home, os.Getenv)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

func dataDirFor(goos, home string, getenv func(string) string) (string, error) {
	switch goos {
	case "windows":
		appData := getenv("AppData")
		if appData == "" {
			return "", errors.New("config: %AppData% is not set")
		}
		return filepath.Join(appData, "Klats"), nil
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Klats"), nil
	default:
		if xdg := getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, "klats"), nil
		}
		return filepath.Join(home, ".local", "share", "klats"), nil
	}
}

// Load reads the settings from dir. A missing file, or a key absent from it,
// yields the default (port 0, language "uk").
func Load(dir string) (Settings, error) {
	s := defaults()
	data, err := os.ReadFile(filepath.Join(dir, settingsFile))
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return defaults(), fmt.Errorf("config: parse %s: %w", settingsFile, err)
	}
	return s, nil
}

// Save writes the settings to dir atomically: a temp file in the same folder
// is renamed over settings.json, so a crash never leaves a partial file.
func Save(dir string, s Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, settingsFile+".*.tmp")
	if err != nil {
		return err
	}
	_, err = tmp.Write(data)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), filepath.Join(dir, settingsFile))
	}
	if err != nil {
		_ = os.Remove(tmp.Name())
	}
	return err
}
