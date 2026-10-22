//go:build nodesktop

package main

import "errors"

func newShell(func() string, func() bool, func()) (shell, error) {
	return nil, errors.New("the desktop shell is not built in (built with -tags nodesktop); run with -dev")
}
