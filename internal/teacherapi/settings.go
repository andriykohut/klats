package teacherapi

import (
	"cmp"
	"net/http"
	"net/netip"

	"github.com/andriykohut/klats/internal/config"
	"github.com/andriykohut/klats/internal/httpx"
	"github.com/andriykohut/klats/internal/lan"
	"github.com/andriykohut/klats/internal/wire"
)

// networkInfo describes the address students use. The caller holds a.mu.
func (a *api) networkInfo(cands []netip.Addr) wire.NetworkInfo {
	info := wire.NetworkInfo{Candidates: make([]string, len(cands)), Port: cmp.Or(a.lanPort, a.settings.Port), Error: a.lanErr()}
	for i, c := range cands {
		info.Candidates[i] = c.String()
	}
	if chosen, ok := lan.Choose(cands, a.settings.Address); ok {
		info.Address = chosen.String()
		if a.lanPort != 0 {
			info.URL = lan.URL(chosen, a.lanPort)
		}
	}
	return info
}

func (a *api) getNetwork(w http.ResponseWriter, r *http.Request) {
	cands := lan.Candidates(a.ifaces())
	a.mu.Lock()
	defer a.mu.Unlock()
	httpx.JSON(w, http.StatusOK, a.networkInfo(cands))
}

func (a *api) putNetwork(w http.ResponseWriter, r *http.Request) {
	var req wire.NetworkRequest
	if !decode(w, r, &req) {
		return
	}
	addr, err := netip.ParseAddr(req.Address)
	cands := lan.Candidates(a.ifaces())
	if err != nil || !containsAddr(cands, addr) {
		httpx.Error(w, http.StatusBadRequest, "invalid")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	next := a.settings
	next.Address = addr.String()
	if err := config.Save(a.dataDir, next); err != nil {
		fail(w, r, err)
		return
	}
	a.settings = next
	httpx.JSON(w, http.StatusOK, a.networkInfo(cands))
}

func containsAddr(addrs []netip.Addr, a netip.Addr) bool {
	for _, c := range addrs {
		if c == a {
			return true
		}
	}
	return false
}

// settingsInfo describes the saved settings. The caller holds a.mu.
func (a *api) settingsInfo() wire.SettingsInfo {
	return wire.SettingsInfo{
		Port: a.settings.Port, Language: a.settings.Language, CheckUpdates: a.settings.CheckUpdates,
		RestartRequired: a.settings.Port != a.lanPort,
	}
}

func (a *api) getSettings(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	httpx.JSON(w, http.StatusOK, a.settingsInfo())
}

func (a *api) putSettings(w http.ResponseWriter, r *http.Request) {
	var req wire.SettingsInfo
	if !decode(w, r, &req) {
		return
	}
	if (req.Language != "uk" && req.Language != "en") || req.Port < 1 || req.Port > 65535 {
		httpx.Error(w, http.StatusBadRequest, "invalid")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	next := a.settings
	next.Port, next.Language, next.CheckUpdates = req.Port, req.Language, req.CheckUpdates
	if err := config.Save(a.dataDir, next); err != nil {
		fail(w, r, err)
		return
	}
	a.settings = next
	a.eng.SetLanguage(next.Language)
	httpx.JSON(w, http.StatusOK, a.settingsInfo())
}

func (a *api) getAbout(w http.ResponseWriter, r *http.Request) {
	info := wire.AboutInfo{Version: a.version}
	if rel, ok := a.updates.Get(); ok {
		info.Latest, info.NotesURL = rel.Version, rel.NotesURL
	}
	httpx.JSON(w, http.StatusOK, info)
}
