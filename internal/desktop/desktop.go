// Package desktop is the teacher's native shell around the teacher web app:
// one window, a tray icon while a sitting runs, a single instance and the save
// dialog. It is the only package that imports Wails. The window loads the
// teacher app from the local teacher API as a browser would, so the app needs
// no Wails bindings.
package desktop

import (
	"context"
	_ "embed"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"klats/internal/teacherapi"
)

// icon is a placeholder mark until the installers bring the real one.
//
//go:embed icon.png
var icon []byte

// Options are what [Run] needs from the program.
type Options struct {
	// TeacherURL is the teacher app's address on 127.0.0.1, with the launch
	// token.
	TeacherURL string
	// Language returns the saved UI language, "uk" or "en".
	Language func() string
	// SittingActive reports whether a sitting is running.
	SittingActive func() bool
	// OnShutdown runs on the main thread as the shell quits.
	OnShutdown func()
}

// Run opens the window on o.TeacherURL and blocks until the shell quits: when
// the window is closed with no sitting running, when the teacher confirms
// quitting during one, or when ctx is done. On macOS the process exits once
// o.OnShutdown returns, so Run does not return there. A second launch of the
// program focuses this window and exits.
//
// While a sitting runs, closing the window hides it, and a tray icon offers to
// show it again or to quit, which asks first. Quitting does not end the
// sitting: it resumes at the next launch.
func Run(ctx context.Context, o Options) error {
	t := textsFor(o.Language())
	var (
		app       *application.App
		win       *application.WebviewWindow
		confirmed atomic.Bool // quit without asking
	)
	show := func() {
		win.UnMinimise()
		win.Show()
		win.Focus()
	}
	app = application.New(application.Options{
		Name:   t.title,
		Icon:   icon,
		Logger: slog.Default(),
		// ctx carries the program's signals.
		DisableDefaultSignalHandler: true,
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:               "ua.klats.teacher",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) { show() },
		},
		ShouldQuit: func() bool {
			if confirmed.Load() || !o.SittingActive() {
				return true
			}
			// A dialog shown here would run inside the quit in progress on the
			// main thread, so that quit is refused and askQuit issues a new one.
			go askQuit(app, &confirmed, textsFor(o.Language()))
			return false
		},
		OnShutdown: o.OnShutdown,
	})
	win = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: t.title, URL: o.TeacherURL,
		Width: 1440, Height: 900, MinWidth: 1366, MinHeight: 768,
	})
	// Until the app quits and closes it, the window is only hidden or quit
	// with. On macOS, quitting when the last window closes would also fire when
	// the quit dialog closes over the hidden window, and ask again.
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if app.Context().Err() != nil {
			return
		}
		e.Cancel()
		if o.SittingActive() {
			win.Hide()
			return
		}
		go app.Quit()
	})
	// Both goroutines call into Wails, which is ready only once the app runs.
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		go func() {
			select {
			case <-ctx.Done():
				confirmed.Store(true)
				app.Quit()
			case <-app.Context().Done():
			}
		}()
		go trayWhileActive(app, win, show, o)
	})
	return app.Run()
}

// askQuit asks the teacher to confirm quitting during a sitting, and quits if
// they do.
func askQuit(app *application.App, confirmed *atomic.Bool, t texts) {
	d := app.Dialog.Question().SetTitle(t.title).SetMessage(t.quitAsk)
	d.AddButton(t.quit).OnClick(func() {
		confirmed.Store(true)
		app.Quit()
	})
	d.SetCancelButton(d.AddButton(t.cancel))
	d.Show()
}

// trayWhileActive keeps a tray icon while a sitting runs, checking once a
// second, until the app quits.
func trayWhileActive(app *application.App, win *application.WebviewWindow, show func(), o Options) {
	var tray *application.SystemTray
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-app.Context().Done():
			return
		case <-tick.C:
		}
		switch active := o.SittingActive(); {
		case active && tray == nil:
			t := textsFor(o.Language())
			menu := app.Menu.New()
			menu.Add(t.show).OnClick(func(*application.Context) { show() })
			menu.Add(t.quit).OnClick(func(*application.Context) { app.Quit() })
			tray = app.SystemTray.New()
			tray.SetIcon(icon)
			tray.SetTooltip(t.title)
			tray.SetMenu(menu)
		case !active && tray != nil:
			application.InvokeSync(tray.Destroy)
			tray = nil
			// Without the tray, a hidden window has no way back on Windows.
			if !win.IsVisible() {
				show()
			}
		}
	}
}

// Dialogs returns the native file dialogs for the teacher API. They work only
// while [Run] runs, from any goroutine: Wails shows them on the main thread.
func Dialogs() teacherapi.Dialogs { return dialogs{} }

type dialogs struct{}

// SaveFile asks where to save an Excel workbook, starting in the user's
// Documents folder. A cancelled dialog returns "" and a nil error.
func (dialogs) SaveFile(defaultName string) (string, error) {
	path, err := application.Get().Dialog.SaveFile().
		SetFilename(defaultName).
		AddFilter("Excel", "*.xlsx").
		SetDirectory(application.Path(application.PathDocuments)).
		CanCreateDirectories(true).
		PromptForSingleSelection()
	// shortcut: Wails reports a cancel on Windows with an unexported error,
	// matched here by its text; compare the value once Wails exports it.
	if err != nil && err.Error() == "cancelled by user" {
		return "", nil
	}
	return path, err
}
