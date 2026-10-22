//go:build nodesktop

package main

import (
	"context"
	"errors"

	"klats/internal/teacherapi"
)

func saveDialogs() teacherapi.Dialogs { return nil }

func runDesktop(context.Context, string, func() string, func() bool, func()) error {
	return errors.New("the desktop shell is not built in (built with -tags nodesktop); run with -dev")
}
