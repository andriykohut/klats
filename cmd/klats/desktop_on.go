//go:build !nodesktop

package main

import "klats/internal/desktop"

// newShell creates the desktop shell; see [desktop.New] for the single
// instance.
func newShell(language func() string, active func() bool, onShutdown func()) (shell, error) {
	return desktop.New(desktop.Options{Language: language, SittingActive: active, OnShutdown: onShutdown}), nil
}
