// Command klats is the teacher's program: it serves the student app on the
// LAN, the teacher API on 127.0.0.1, and opens the teacher window. With -dev it
// opens no window and prints the addresses instead, for development and the
// end-to-end tests; -demo adds a sample lesson to try them on.
package main

import (
	"cmp"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/andriykohut/klats/internal/config"
	"github.com/andriykohut/klats/internal/demo"
	"github.com/andriykohut/klats/internal/events"
	"github.com/andriykohut/klats/internal/lan"
	"github.com/andriykohut/klats/internal/media"
	"github.com/andriykohut/klats/internal/power"
	"github.com/andriykohut/klats/internal/sitting"
	"github.com/andriykohut/klats/internal/store"
	"github.com/andriykohut/klats/internal/studentapi"
	"github.com/andriykohut/klats/internal/teacherapi"
	"github.com/andriykohut/klats/internal/update"
	webui "github.com/andriykohut/klats/web"
)

const (
	maxLogBytes  = 5 << 20
	shutdownTime = 3 * time.Second
	// releasesURL names the newest release; KLATS_RELEASES_URL replaces it
	// in tests.
	releasesURL = "https://api.github.com/repos/andriykohut/klats/releases/latest"
)

// Tests swap these for stand-ins: the built student app, the shell, the
// keep-awake call, the first-run student listener and the tick period.
var (
	studentUI = webui.Student
	openShell = newShell
	inhibit   = power.Inhibit
	listenLAN = func(s *config.Settings) (net.Listener, error) { return lan.Listen(s, runtime.GOOS) }
	tickEvery = 2 * time.Second
)

// version is the program's version without the leading "v"; release builds
// set it with -ldflags "-X main.version=1.2.3".
var version = "dev"

// errUsage reports bad flags, which the flag package has already printed.
var errUsage = errors.New("usage")

// shell is the desktop window, see [desktop.App].
type shell interface {
	Run(ctx context.Context, teacherURL string) error
	Dialogs() teacherapi.Dialogs
	Browser() teacherapi.Browser
	// Fail shows why the program could not start, instead of Run: the data
	// is from a newer version, or another error is in logDir/klats.log. On
	// macOS it never returns.
	Fail(newerData bool, logDir string)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	// After the first signal, a second one kills the program at once.
	context.AfterFunc(ctx, stop)
	os.Exit(code(run(ctx, os.Args[1:], os.Stdout, os.Stderr)))
}

func code(err error) int {
	switch {
	case err == nil:
		return 0
	case errors.Is(err, errUsage):
		return 2
	default:
		fmt.Fprintln(os.Stderr, "klats:", err)
		return 1
	}
}

// run serves until ctx is done or, without -dev, until the window quits, then
// shuts the servers down and closes the database. With -dev it prints the
// student, LAN and teacher addresses to stdout, one per line. With -demo too,
// it first starts the sample lesson, or finds the sitting already running
// (see [demo.Seed]), in a temporary data folder removed on exit unless -data
// names one, and the student addresses carry its join code. Logs go to stderr
// and to the data folder's logs/klats.log.
func run(ctx context.Context, args []string, stdout, stderr io.Writer) (err error) {
	flags := flag.NewFlagSet("klats", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dataFlag := flags.String("data", "", "data folder (default: the per-user app-data folder)")
	dev := flags.Bool("dev", false, "open no window; print the addresses")
	portFlag := flags.Int("port", 0, "student server port for this run, not saved; 0 picks a free one")
	demoFlag := flags.Bool("demo", false, "with -dev only: start a sample lesson, in a temporary data folder unless -data is set")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return errUsage
	}
	if *demoFlag && !*dev {
		_, _ = fmt.Fprintln(stderr, "-demo needs -dev")
		flags.Usage()
		return errUsage
	}
	portSet := false
	flags.Visit(func(f *flag.Flag) { portSet = portSet || f.Name == "port" })

	dataDir := *dataFlag
	switch {
	case dataDir != "":
		if err := os.MkdirAll(dataDir, 0o700); err != nil {
			return err
		}
	case *demoFlag:
		d, err := os.MkdirTemp("", "klats-demo-")
		if err != nil {
			return err
		}
		// Deferred first, so it runs after the store and the log are closed.
		defer func() { _ = os.RemoveAll(d) }()
		dataDir = d
	default:
		d, err := config.DataDir()
		if err != nil {
			return err
		}
		dataDir = d
	}

	// The shell claims the single instance before anything a running instance
	// holds is opened; a second instance exits inside newShell. It calls back
	// into eng and stop only once it runs, after both are set. A file the
	// system opens Klats with can arrive before then, and waits in opened.
	var (
		sh       shell
		shellRan bool
		eng      *sitting.Engine
		stop     func()
	)
	opened := teacherapi.NewOpenedFiles()
	if !*dev {
		onShutdown := func() {
			if stop != nil { // a failed start quits before eng and stop are set
				stop()
			}
		}
		sh, err = openShell(savedLanguage(dataDir), func() bool { return eng != nil && eng.Active() }, onShutdown, opened.Add)
		if err != nil {
			return err
		}
		// Deferred first, so the error is logged and the store and the log
		// are closed before it runs: on macOS the process exits inside Fail.
		defer func() {
			if err != nil && !shellRan {
				sh.Fail(errors.Is(err, store.ErrSchemaTooNew), filepath.Join(dataDir, "logs"))
			}
		}()
	}

	logFile, err := openLog(dataDir)
	if err != nil {
		return err
	}
	defer func() { _ = logFile.Close() }()
	prevLog := slog.Default()
	defer slog.SetDefault(prevLog)
	// The file comes first: a GUI build on Windows has no stderr, and
	// MultiWriter stops at the first failing writer.
	slog.SetDefault(slog.New(slog.NewTextHandler(io.MultiWriter(logFile, stderr), nil)))
	defer func() {
		if err != nil {
			slog.Error("klats stopped on an error", "err", err)
		}
	}()

	// A damaged file must not keep the window from opening: the defaults stand
	// in, and the port is chosen and saved again as on a first run.
	settings, err := config.Load(dataDir)
	if err != nil {
		slog.Error("settings unusable; starting with the defaults", "err", err)
	}
	// tmp/ holds spooled uploads, downloads and the work files of backups and
	// restores, which only the run that made them uses, so a crash leaves
	// nothing past the next start. It is emptied only once the shell holds
	// the single instance, so a second launch cannot delete a running one's.
	tmpDir := filepath.Join(dataDir, "tmp")
	if err := os.RemoveAll(tmpDir); err != nil {
		slog.Error("old temporary files not removed", "err", err)
	}
	if err := os.MkdirAll(tmpDir, 0o700); err != nil {
		return err
	}
	st, err := store.Open(filepath.Join(dataDir, "klats.db"))
	if err != nil {
		return err
	}
	// stop closes the store; this covers the returns before stop exists.
	defer func() { _ = st.Close() }()
	snapshotDaily(st, dataDir)

	ms, err := media.Open(filepath.Join(dataDir, "media"))
	if err != nil {
		return err
	}
	hub := events.New()
	eng, err = sitting.New(st, hub, time.Now)
	if err != nil {
		return err
	}
	eng.SetLanguage(settings.Language)
	eng.SetSnapshotDir(dataDir)
	join := ""
	if *demoFlag {
		info, err := demo.Seed(st, eng, ms)
		if err != nil {
			return fmt.Errorf("demo: %w", err)
		}
		join = "/?code=" + info.Code
	}

	var lanL net.Listener
	var lanErr string
	if portSet {
		lanL, err = net.Listen("tcp", ":"+strconv.Itoa(*portFlag))
	} else {
		firstRun := settings.Port == 0
		lanL, err = listenLAN(&settings)
		if err == nil && firstRun {
			if err := config.Save(dataDir, settings); err != nil {
				slog.Error("the chosen student port is not saved", "port", settings.Port, "err", err)
			}
		}
	}
	var busy lan.ErrPortBusy
	if errors.As(err, &busy) {
		slog.Error("student server not started; choose another port in the settings", "err", err)
		lanErr, err = "port_busy", nil
	}
	if err != nil {
		return err
	}
	lanPort := 0
	if lanL != nil {
		// Shutdown closes it too; this covers the early returns.
		defer func() { _ = lanL.Close() }()
		lanPort = lanL.Addr().(*net.TCPAddr).Port
	}

	teacherL, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	teacherPort := teacherL.Addr().(*net.TCPAddr).Port
	token := teacherapi.NewToken()
	var (
		dialogs teacherapi.Dialogs
		browser teacherapi.Browser
	)
	if sh != nil {
		dialogs, browser = sh.Dialogs(), sh.Browser()
	}
	updates := teacherapi.NewUpdates(hub)
	teacher := teacherapi.Handler(teacherapi.Deps{
		Store: st, Engine: eng, Hub: hub, Media: ms, Assets: webui.Teacher, Token: token, Port: teacherPort,
		DataDir: dataDir, TempDir: tmpDir, LANPort: lanPort, LANError: func() string { return lanErr }, Settings: &settings,
		Dialogs: dialogs, Version: version, Updates: updates, Browser: browser, Opened: opened, Dev: *dev,
	})

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	reqCtx, cancelReq := context.WithCancel(ctx)
	defer cancelReq()
	servers := []*http.Server{serve(reqCtx, teacherL, teacher)}
	if lanL != nil {
		servers = append(servers, serve(reqCtx, lanL, studentapi.Handler(eng, hub, studentUI, ms)))
	}
	var wg sync.WaitGroup
	wg.Go(func() { tick(ctx, eng) })
	wg.Go(func() { watchAddresses(ctx, hub) })
	wg.Go(func() {
		update.Watch(ctx, update.Options{
			URL: cmp.Or(os.Getenv("KLATS_RELEASES_URL"), releasesURL), Client: http.DefaultClient,
			Every: 24 * time.Hour, Retry: time.Hour, Current: version,
			Allowed: func() bool { return version != "dev" && !eng.Active() && savedCheckUpdates(dataDir) },
			Found:   updates.Set,
		})
	})
	// Wails' OnShutdown calls stop, and on macOS the process exits right
	// after, so no cleanup is left to defer. A failed step is logged and
	// does not skip the next.
	stop = sync.OnceFunc(func() {
		cancelReq() // ends the open event streams, which Shutdown would wait for
		sctx, scancel := context.WithTimeout(context.Background(), shutdownTime)
		defer scancel()
		for _, s := range servers {
			if err := s.Shutdown(sctx); err != nil {
				slog.Warn("server shutdown", "err", err)
			}
		}
		cancel()
		wg.Wait() // the tick loop releases keep-awake as it exits
		if err := st.Close(); err != nil {
			slog.Error("closing the database", "err", err)
		}
		slog.Info("klats stopped")
	})
	defer stop()

	teacherURL := fmt.Sprintf("http://127.0.0.1:%d/?t=%s", teacherPort, token)
	// The launch token is a secret, so the log gets the address without it.
	slog.Info("klats started", "data", dataDir, "studentPort", lanPort, "teacher", fmt.Sprintf("http://127.0.0.1:%d/", teacherPort))
	if *dev {
		student, lanURL := "none", "none"
		if lanL != nil {
			student = fmt.Sprintf("http://127.0.0.1:%d%s", lanPort, join)
			if addr, ok := lan.Choose(lan.Candidates(lan.System()), settings.Address); ok {
				lanURL = lan.URL(addr, lanPort) + join
			}
		}
		if _, err := fmt.Fprintf(stdout, "student %s\nlan %s\nteacher %s\n", student, lanURL, teacherURL); err != nil {
			return err
		}
		<-ctx.Done()
		return nil
	}
	shellRan = true
	return sh.Run(ctx, teacherURL)
}

// savedLanguage returns a function that reads the UI language from the
// settings, which the teacher API rewrites. When the file cannot be read it
// logs the error once and returns the last language it read.
func savedLanguage(dataDir string) func() string {
	var (
		mu     sync.Mutex
		last   string
		logged bool
	)
	return func() string {
		s, err := config.Load(dataDir)
		mu.Lock()
		defer mu.Unlock()
		switch {
		case err == nil:
			last = s.Language
		case !logged:
			logged = true
			slog.Error("settings unreadable; keeping the last language", "err", err)
		}
		if last == "" {
			last = s.Language // Load's default on a first failure
		}
		return last
	}
}

// savedCheckUpdates reports whether the settings, which the teacher API
// rewrites, allow the update check. Settings that cannot be read do not.
func savedCheckUpdates(dataDir string) bool {
	s, err := config.Load(dataDir)
	return err == nil && s.CheckUpdates
}

// serve starts an HTTP server on l. Requests see ctx, so open event streams
// end when it is done; there is no write timeout, which would cut them.
func serve(ctx context.Context, l net.Listener, h http.Handler) *http.Server {
	s := &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	go func() {
		if err := s.Serve(l); !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server stopped", "addr", l.Addr(), "err", err)
		}
	}()
	return s
}

// tick runs the engine's offline check every 2 s and keeps the computer awake
// while a sitting runs, until ctx is done.
func tick(ctx context.Context, eng *sitting.Engine) {
	t := time.NewTicker(tickEvery)
	defer t.Stop()
	var release func()
	defer func() {
		if release != nil {
			release()
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		eng.Tick()
		switch active := eng.Active(); {
		case active && release == nil:
			r, err := inhibit("Тест триває")
			if err != nil {
				slog.Warn("keep-awake failed; the computer may sleep during the test", "err", err)
				r = func() {}
			}
			release = r
		case !active && release != nil:
			release()
			release = nil
		}
	}
}

// watchAddresses tells the teacher app when the LAN addresses change, until
// ctx is done.
func watchAddresses(ctx context.Context, hub *events.Hub) {
	strs := func(as []netip.Addr) []string {
		out := make([]string, len(as))
		for i, a := range as {
			out[i] = a.String()
		}
		return out
	}
	lan.Watch(ctx, 10*time.Second, func() []netip.Addr { return lan.Candidates(lan.System()) }, func(old, new []netip.Addr) {
		data := map[string][]string{"old": strs(old), "new": strs(new)}
		slog.Info("LAN addresses changed", "old", data["old"], "new", data["new"])
		hub.Publish(events.Event{Topic: "teacher", Name: "address_changed", Data: data})
	})
}

// snapshotDaily snapshots the database into dataDir/snapshots unless a file
// there was modified today, local time. A failure is logged.
func snapshotDaily(st *store.Store, dataDir string) {
	today := time.Now().Format(time.DateOnly)
	entries, _ := os.ReadDir(filepath.Join(dataDir, "snapshots"))
	for _, e := range entries {
		if info, err := e.Info(); err == nil && info.ModTime().Format(time.DateOnly) == today {
			return
		}
	}
	if err := st.Snapshot(dataDir, store.SnapshotsKeep); err != nil {
		slog.Error("daily snapshot", "err", err)
	}
}

// openLog opens dataDir/logs/klats.log for appending. A log over maxLogBytes
// is first renamed to klats.log.1, replacing the previous one.
func openLog(dataDir string) (*os.File, error) {
	dir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "klats.log")
	if info, err := os.Stat(path); err == nil && info.Size() > maxLogBytes {
		if err := os.Rename(path, path+".1"); err != nil {
			return nil, err
		}
	} else if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	return os.OpenFile(path, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o600)
}
