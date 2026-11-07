package teacherapi

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/andriykohut/klats/internal/httpx"
	"github.com/andriykohut/klats/internal/wire"
)

func (a *api) kick(w http.ResponseWriter, r *http.Request) {
	noContent(w, r, a.eng.Kick(r.PathValue("id")))
}

func (a *api) move(w http.ResponseWriter, r *http.Request) {
	var req wire.MoveRequest
	if !decode(w, r, &req) {
		return
	}
	noContent(w, r, a.eng.Move(r.PathValue("id"), req.Device))
}

func (a *api) addTime(w http.ResponseWriter, r *http.Request) {
	var req wire.TimeRequest
	if !decode(w, r, &req) {
		return
	}
	noContent(w, r, a.eng.AddTime(r.PathValue("id"), req.Minutes))
}

func (a *api) resolve(w http.ResponseWriter, r *http.Request) {
	var req wire.ResolveRequest
	if !decode(w, r, &req) {
		return
	}
	noContent(w, r, a.eng.ResolveEvent(r.PathValue("id"), req.Action))
}

func (a *api) renameDevice(w http.ResponseWriter, r *http.Request) {
	var req wire.LabelRequest
	if !decode(w, r, &req) {
		return
	}
	label := strings.TrimSpace(req.Label)
	if n := utf8.RuneCountInString(label); n < 1 || n > maxLabelRunes {
		httpx.Error(w, http.StatusBadRequest, "invalid")
		return
	}
	noContent(w, r, a.eng.RenameDevice(r.PathValue("token"), label))
}
