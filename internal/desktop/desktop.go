// Package desktop is the teacher's native shell around the teacher web app:
// one window, a tray icon while a sitting runs, a single instance and the save
// dialog. It is the only package that imports Wails. The window loads the
// teacher app from the local teacher API as a browser would, so the app needs
// no Wails bindings.
//
// The shell starts in two steps. [New] claims the single instance before the
// program opens its database, log and ports, and [App.Run] opens the window
// once the teacher API is listening.
//
// A file the system opens with Klats, such as a double-clicked .klats file,
// reaches [Options.OpenFile] from the system's open event or, when a second
// launch carries it, through the single instance.
package desktop

import (
	"context"
	_ "embed"
	"log/slog"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/andriykohut/klats/internal/teacherapi"
)

// icon is the app icon, rendered from build/icon/klats.svg by `make icons`.
//
//go:embed icon.png
var icon []byte

// Options are what the shell needs from the program. New calls Language, and
// OpenFile may be called from then on, from any goroutine; the other functions
// are called only while [App.Run] runs.
type Options struct {
	// Language returns the saved UI language, "uk" or "en".
	Language func() string
	// SittingActive reports whether a sitting is running.
	SittingActive func() bool
	// OnShutdown runs on the main thread as the shell quits. On macOS the
	// process exits as soon as it returns, so the program's own shutdown
	// belongs here rather than after Run.
	OnShutdown func()
	// OpenFile takes the path of a .klats file the system asked the program
	// to open. A relative path is relative to the working folder.
	OpenFile func(path string)
}

// App is the shell between [New] and the end of [App.Run].
type App struct {
	app       *application.App
	win       *application.WebviewWindow
	o         Options
	confirmed atomic.Bool // quit without asking
	asking    atomic.Bool // the quit question is showing
	started   atomic.Bool
}

// New creates the shell and claims its single instance. When another instance
// of the program is already running, New asks it to show its window, hands it
// the .klats files among this process's arguments, and exits with status 0,
// so call it before opening anything the first instance holds, such as the
// database, the log or the ports.
func New(o Options) *App {
	a := &App{o: o}
	t := textsFor(o.Language())
	a.app = application.New(application.Options{
		Name: t.title,
		Icon: icon,
		// Wails reads its logger in goroutines started inside application.New,
		// so it is set here; the program installs its log after New.
		Logger: slog.New(defaultHandler{}),
		// The ctx given to Run carries the program's signals.
		DisableDefaultSignalHandler: true,
		// On Windows and Linux, Wails reports a first launch with one argument
		// of this extension as ApplicationOpenedWithFile; macOS reports a
		// document open there too, at any launch.
		FileAssociations: []string{".klats"},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "ua.klats.teacher",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				// Args starts with the program's own path, which never ends in .klats.
				for _, arg := range data.Args {
					if !strings.EqualFold(filepath.Ext(arg), ".klats") {
						continue
					}
					if !filepath.IsAbs(arg) {
						arg = filepath.Join(data.WorkingDir, arg)
					}
					o.OpenFile(arg)
				}
				if a.started.Load() {
					a.show()
				}
			},
		},
		ShouldQuit: a.shouldQuit,
		OnShutdown: o.OnShutdown,
	})
	a.win = a.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: t.title, Width: 1440, Height: 900, MinWidth: 1366, MinHeight: 768,
	})
	a.win.RegisterHook(events.Common.WindowClosing, a.closing)
	// It can fire before ApplicationStarted, when the window is about to show anyway.
	a.app.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(e *application.ApplicationEvent) {
		o.OpenFile(e.Context().Filename())
		if a.started.Load() {
			a.show()
		}
	})
	return a
}

// Run opens the window on teacherURL, the teacher app's address with the
// launch token, and blocks until the shell quits: when the window is closed
// with no sitting running, when the teacher confirms quitting during one, or
// when ctx is done. On macOS the process exits once Options.OnShutdown
// returns, so Run does not return there.
//
// While a sitting runs, closing the window hides it, and a tray icon offers to
// show it again or to quit, which asks first. Quitting does not end the
// sitting: it resumes at the next launch.
func (a *App) Run(ctx context.Context, teacherURL string) error {
	a.win.SetURL(teacherURL)
	// Both goroutines call into Wails, which is ready only once the app runs.
	a.app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		a.started.Store(true)
		go func() {
			select {
			case <-ctx.Done():
				a.confirmed.Store(true)
				a.app.Quit()
			case <-a.app.Context().Done():
			}
		}()
		go a.trayWhileActive()
	})
	return a.app.Run()
}

func (a *App) show() {
	a.win.UnMinimise()
	a.win.Show()
	a.win.Focus()
}

// closing keeps the window open: it hides it while a sitting runs and quits
// otherwise. On macOS, quitting when the last window closes would also fire
// when the quit dialog closes over the hidden window, and ask again.
func (a *App) closing(e *application.WindowEvent) {
	if a.app.Context().Err() != nil {
		return // the app is quitting and closes its windows
	}
	e.Cancel()
	if a.o.SittingActive() {
		a.win.Hide()
		return
	}
	go a.app.Quit()
}

func (a *App) shouldQuit() bool {
	if a.confirmed.Load() || !a.o.SittingActive() {
		return true
	}
	// A dialog shown here would run inside the quit in progress on the main
	// thread, so that quit is refused and askQuit issues a new one.
	go a.askQuit()
	return false
}

// askQuit asks the teacher to confirm quitting during a sitting, in front of
// the window, and quits if they do. While the question is showing, another
// request only brings the window forward.
func (a *App) askQuit() {
	a.show() // the window may be hidden, and the question is attached to it
	if !a.asking.CompareAndSwap(false, true) {
		return
	}
	t := textsFor(a.o.Language())
	d := a.app.Dialog.Question().SetTitle(t.title).SetMessage(t.quitAsk).AttachToWindow(a.win)
	d.AddButton(t.quit).OnClick(func() {
		a.asking.Store(false)
		a.confirmed.Store(true)
		a.app.Quit()
	})
	d.SetCancelButton(d.AddButton(t.cancel).OnClick(func() { a.asking.Store(false) }))
	d.Show()
}

// trayWhileActive keeps a tray icon while a sitting runs, checking once a
// second, until the app quits.
func (a *App) trayWhileActive() {
	var tray *application.SystemTray
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-a.app.Context().Done():
			return
		case <-tick.C:
		}
		switch active := a.o.SittingActive(); {
		case active && tray == nil:
			t := textsFor(a.o.Language())
			menu := a.app.Menu.New()
			menu.Add(t.show).OnClick(func(*application.Context) { a.show() })
			menu.Add(t.quit).OnClick(func(*application.Context) { a.app.Quit() })
			tray = a.app.SystemTray.New()
			tray.SetIcon(icon)
			tray.SetTooltip(t.title)
			tray.SetMenu(menu)
		case !active && tray != nil:
			application.InvokeSync(tray.Destroy)
			tray = nil
			// Without the tray, a hidden window has no way back on Windows.
			if !a.win.IsVisible() {
				a.show()
			}
		}
	}
}

// Dialogs returns the native file dialogs for the teacher API, attached to the
// window. They work only while [App.Run] runs, from any goroutine: Wails shows
// them on the main thread.
func (a *App) Dialogs() teacherapi.Dialogs { return dialogs{a.app, a.win, a.o.Language} }

// Browser returns the system browser, for the teacher API's links out.
func (a *App) Browser() teacherapi.Browser { return a.app.Browser }

type dialogs struct {
	app  *application.App
	win  *application.WebviewWindow
	lang func() string
}

// SaveFile asks where to save a file, starting in the user's Documents
// folder. The filter follows defaultName's extension: a test for ".klats", a
// backup for ".klatsbackup", and an Excel workbook otherwise. A cancelled
// dialog returns "" and a nil error.
func (d dialogs) SaveFile(defaultName string) (string, error) {
	kind, pattern := "Excel", "*.xlsx"
	switch t := textsFor(d.lang()); filepath.Ext(defaultName) {
	case ".klats":
		kind, pattern = t.testFile, "*.klats"
	case ".klatsbackup":
		kind, pattern = t.backupFile, "*.klatsbackup"
	}
	path, err := d.app.Dialog.SaveFile().
		SetFilename(defaultName).
		AddFilter(kind, pattern).
		SetDirectory(application.Path(application.PathDocuments)).
		CanCreateDirectories(true).
		AttachToWindow(d.win).
		PromptForSingleSelection()
	// shortcut: Wails v3.0.0-beta.34 reports a cancelled Windows dialog only
	// with its unexported cfd.ErrorCancelled, so it is matched by text. A
	// changed text would turn a cancel into a failed export; compare the error
	// value once Wails exports one.
	if err != nil && err.Error() == "cancelled by user" {
		return "", nil
	}
	return path, err
}

// defaultHandler logs through whichever slog default is current, so Wails'
// own messages reach the program's log once it is set up.
type defaultHandler struct{}

func (defaultHandler) Enabled(ctx context.Context, l slog.Level) bool {
	return slog.Default().Handler().Enabled(ctx, l)
}

func (defaultHandler) Handle(ctx context.Context, r slog.Record) error {
	return slog.Default().Handler().Handle(ctx, r)
}

func (defaultHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return slog.Default().Handler().WithAttrs(attrs)
}

func (defaultHandler) WithGroup(name string) slog.Handler {
	return slog.Default().Handler().WithGroup(name)
}
