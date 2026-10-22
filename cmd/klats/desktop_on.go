//go:build !nodesktop

package main

import (
	"context"

	"klats/internal/desktop"
	"klats/internal/teacherapi"
)

func saveDialogs() teacherapi.Dialogs { return desktop.Dialogs() }

func runDesktop(ctx context.Context, teacherURL string, language func() string, active func() bool, onShutdown func()) error {
	return desktop.Run(ctx, desktop.Options{TeacherURL: teacherURL, Language: language, SittingActive: active, OnShutdown: onShutdown})
}
