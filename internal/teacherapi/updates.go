package teacherapi

import (
	"log/slog"
	"net/http"
	"sync"

	"github.com/andriykohut/klats/internal/events"
	"github.com/andriykohut/klats/internal/httpx"
	"github.com/andriykohut/klats/internal/update"
	"github.com/andriykohut/klats/internal/wire"
)

// siteURL is the Klats website in Ukrainian; the English pages sit under en/.
const siteURL = "https://andriykohut.github.io/klats/"

// DownloadURL returns the website's download section in lang: English for
// "en", Ukrainian otherwise.
func DownloadURL(lang string) string {
	if lang == "en" {
		return siteURL + "en/#download"
	}
	return siteURL + "#download"
}

// Updates holds the newer release the update check found, which
// GET /api/about reports. It is safe for concurrent use.
type Updates struct {
	hub *events.Hub
	mu  sync.Mutex
	r   update.Release
	ok  bool
}

// NewUpdates returns an Updates that knows no release and announces the ones
// it is handed on hub.
func NewUpdates(hub *events.Hub) *Updates { return &Updates{hub: hub} }

// Set stores r as the newer release and publishes "update_found" on the
// teacher topic.
func (u *Updates) Set(r update.Release) {
	u.mu.Lock()
	u.r, u.ok = r, true
	u.mu.Unlock()
	u.hub.Publish(events.Event{Topic: "teacher", Name: "update_found"})
}

// Get returns the stored release, and false while none is stored.
func (u *Updates) Get() (update.Release, bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.r, u.ok
}

// checkUpdates asks GitHub once whether a newer release is out and replies
// with the about info, which names the newer release when one is stored. A
// newer release goes to the same holder the daily check feeds, so the top
// bar's pill lights up too. It runs when the teacher asks, so it ignores the
// daily-check switch and a running sitting. A failed check replies 502
// "check_failed".
func (a *api) checkUpdates(w http.ResponseWriter, r *http.Request) {
	rel, err := update.Latest(r.Context(), http.DefaultClient, a.releasesURL)
	if err != nil {
		slog.Info("manual update check failed", "err", err)
		httpx.Error(w, http.StatusBadGateway, "check_failed")
		return
	}
	if update.Newer(a.version, rel.Version) {
		a.updates.Set(rel)
	}
	a.getAbout(w, r)
}

// open opens a page the server names, never one from the request: "download"
// is the website's download section in the UI language, and "notes" the found
// release's page. Without a Browser it replies with the page for the app to
// open itself.
func (a *api) open(w http.ResponseWriter, r *http.Request) {
	var url string
	switch r.PathValue("target") {
	case "download":
		a.mu.Lock()
		url = DownloadURL(a.settings.Language)
		a.mu.Unlock()
	case "notes":
		rel, ok := a.updates.Get()
		if !ok {
			httpx.Error(w, http.StatusNotFound, "not_found")
			return
		}
		url = rel.NotesURL
	default:
		httpx.Error(w, http.StatusNotFound, "not_found")
		return
	}
	if a.browser == nil {
		httpx.JSON(w, http.StatusOK, wire.OpenResult{URL: url})
		return
	}
	noContent(w, r, a.browser.OpenURL(url))
}
