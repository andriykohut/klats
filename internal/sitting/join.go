package sitting

import (
	"database/sql"
	"errors"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"klats/internal/roster"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/wire"
)

// maxTypedName caps the length, in characters, of a typed surname, first name
// or class.
const maxTypedName = 60

// typedKey returns the name lock key of a typed name in a class: the same
// student typed in another letter case clashes, a namesake in another class
// does not. name and class are already normalised.
func typedKey(name, class string) string {
	return strings.ToLower(name) + "|" + strings.ToLower(class)
}

// Join checks the join code and returns what the device needs to pick a name.
// A device seen for the first time is registered with its label set from ip,
// the client address without a port (see deviceLabel). It returns
// [ErrBadCode] when no sitting runs or the code is wrong.
func (e *Engine) Join(code, device, ip string) (wire.JoinInfo, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	a := e.cur
	if a == nil || code != a.sitting.JoinCode {
		return wire.JoinInfo{}, ErrBadCode
	}
	q := e.st.Q()
	err := q.UpsertDevice(ctx, db.UpsertDeviceParams{Token: device, Label: deviceLabel(ip), LastIp: ip, LastSeenAt: e.now().UnixMilli()})
	if err != nil {
		return wire.JoinInfo{}, err
	}
	info := wire.JoinInfo{SittingID: a.sitting.ID, Mode: "typed", Names: []wire.NameEntry{}, Language: e.lang}
	if a.assignment.ClassID.Valid {
		info.Mode = "list"
		if info.Names, err = classList(q, a); err != nil {
			return wire.JoinInfo{}, err
		}
		for i, n := range info.Names {
			h := a.holder(n.StudentID)
			info.Names[i].Taken = h != nil && h.device != device
		}
	}
	return info, nil
}

// classList returns the class list of the sitting a in Ukrainian order
// (students.sort_key holds roster.SortKey), with repeats of a name told apart
// by roster.Disambiguate.
func classList(q *db.Queries, a *active) ([]wire.NameEntry, error) {
	students, err := q.ListStudents(ctx, a.assignment.ClassID.String)
	if err != nil {
		return nil, err
	}
	names := make([]string, len(students))
	for i, s := range students {
		names[i] = s.Name
	}
	names = roster.Disambiguate(names)
	out := make([]wire.NameEntry, len(students))
	for i, s := range students {
		out[i] = wire.NameEntry{StudentID: s.ID, Name: names[i]}
	}
	return out, nil
}

// deviceLabel returns the last part of the address ip: the last octet of an
// IPv4 address as a decimal number, the last hextet of an IPv6 one in hex, or
// "?" if ip is not an address.
func deviceLabel(ip string) string {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return "?"
	}
	b := addr.Unmap().AsSlice()
	if len(b) == 4 {
		return strconv.Itoa(int(b[3]))
	}
	return strconv.FormatUint(uint64(b[14])<<8|uint64(b[15]), 16)
}

// Pick joins the device to the sitting as the requested student and locks the
// name to it. Picking the name the device already holds returns the same
// participant.
//
// On a class list, the new set of taken names is published to the devices
// choosing a name, as the "taken" event on topic names:<sittingID>.
//
// When another device holds the name, Pick returns [ErrNameTaken] and raises
// a pinned name_clash event for the teacher, once per holder and newcomer.
// Typed names lock per class and ignore letter case. It returns [ErrBadCode]
// for a wrong code, [ErrNotJoined] for a device that has not called
// [Engine.Join], and [ErrInvalid] for a student not on the class list, an
// empty surname or first name, a typed part over 60 characters, or a device
// that already writes as someone else.
func (e *Engine) Pick(code, device string, req wire.PickRequest) (wire.Participant, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	a := e.cur
	if a == nil || code != a.sitting.JoinCode {
		return wire.Participant{}, ErrBadCode
	}
	q := e.st.Q()
	dev, err := q.GetDevice(ctx, device)
	if errors.Is(err, sql.ErrNoRows) {
		return wire.Participant{}, ErrNotJoined
	}
	if err != nil {
		return wire.Participant{}, err
	}

	row := db.InsertParticipantParams{ID: store.NewID(), SittingID: a.sitting.ID, DeviceToken: device, State: stateWriting, JoinedAt: e.now().UnixMilli()}
	var key string
	if a.assignment.ClassID.Valid {
		names, err := classList(q, a)
		if err != nil {
			return wire.Participant{}, err
		}
		i := slices.IndexFunc(names, func(n wire.NameEntry) bool { return n.StudentID == req.StudentID })
		if i < 0 {
			return wire.Participant{}, ErrInvalid
		}
		key, row.DisplayName, row.StudentID = req.StudentID, names[i].Name, valid(req.StudentID)
	} else {
		surname, first, class := roster.Normalize(req.Surname), roster.Normalize(req.FirstName), roster.Normalize(req.ClassName)
		tooLong := func(s string) bool { return utf8.RuneCountInString(s) > maxTypedName }
		if surname == "" || first == "" || tooLong(surname) || tooLong(first) || tooLong(class) {
			return wire.Participant{}, ErrInvalid
		}
		name := surname + " " + first
		key = typedKey(name, class)
		row.DisplayName, row.TypedName = name, valid(name)
		if class != "" {
			row.TypedClass = valid(class)
		}
	}

	h := a.holder(key)
	if h != nil && h.device == device {
		return wire.Participant{ID: h.id, Name: h.name, DeviceLabel: dev.Label, State: h.state}, nil
	}
	if a.onDevice(device) != nil {
		return wire.Participant{}, ErrInvalid
	}
	if h != nil {
		holder, err := q.GetDevice(ctx, h.device)
		if err != nil {
			return wire.Participant{}, err
		}
		if err := e.raiseClash(h, device, holder.Label, dev.Label); err != nil {
			return wire.Participant{}, err
		}
		return wire.Participant{}, ErrNameTaken{Label: holder.Label}
	}

	p := &participant{
		id: row.ID, key: key, name: row.DisplayName, class: row.TypedClass.String, device: device, state: row.State,
		joinedAt: row.JoinedAt, answers: map[string][]string{}, late: map[string]bool{}, overrides: map[string]float64{}, lastSeen: e.now(),
	}
	err = e.commit(func(q *db.Queries) (func(), error) {
		if err := q.InsertParticipant(ctx, row); err != nil {
			return nil, err
		}
		_, err := e.raise(q, a.sitting.ID, "joined", map[string]string{"name": p.name, "label": dev.Label}, false)
		return func() {
			a.participants = append(a.participants, p)
			a.status[device] = statusWriting
			e.publishTaken(a)
		}, err
	})
	if err != nil {
		return wire.Participant{}, err
	}
	return wire.Participant{ID: p.id, Name: p.name, DeviceLabel: dev.Label, State: p.state}, nil
}

// raiseClash raises a pinned name_clash event for the newcomer device asking
// for the name h holds, unless one is already pending. Besides the labels the
// teacher sees, its params carry the holder's participant id and the
// newcomer's device token, which [Engine.ResolveEvent] acts on.
func (e *Engine) raiseClash(h *participant, newcomer, holderLabel, newcomerLabel string) error {
	c := clash{h.id, newcomer}
	for _, pending := range e.cur.clashes {
		if pending == c {
			return nil
		}
	}
	return e.commit(func(q *db.Queries) (func(), error) {
		id, err := e.raise(q, e.cur.sitting.ID, kindNameClash, map[string]string{
			"name": h.name, "holder": holderLabel, "newcomer": newcomerLabel,
			"participantId": h.id, "device": newcomer,
		}, true)
		return func() { e.cur.clashes[id] = c }, err
	})
}

// Kick sends the participant's device back to the name picker. The
// participant becomes "kicked": its answers stay stored but no longer count,
// and the student may pick the name again as a fresh participant. Pending
// name_clash events over the participant's name are resolved, and their
// newcomer devices told to refetch; the freed name is published to the devices
// choosing a name. Kicking a kicked participant does nothing.
// It returns [ErrNotFound] for an unknown participant.
func (e *Engine) Kick(participantID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	p, err := e.participant(participantID)
	if err != nil {
		return err
	}
	return e.commit(func(q *db.Queries) (func(), error) { return e.kick(q, p) })
}

func (e *Engine) kick(q *db.Queries, p *participant) (func(), error) {
	if p.state == stateKicked {
		return func() {}, nil
	}
	if err := q.SetParticipantState(ctx, db.SetParticipantStateParams{State: stateKicked, ID: p.id}); err != nil {
		return nil, err
	}
	resolved, err := e.resolveClashes(q, e.cur.clashesOf(p.id))
	return func() {
		p.state = stateKicked
		e.cur.status[p.device] = statusKicked
		e.publishStatus(p.device)
		e.publishTaken(e.cur)
		resolved()
	}, err
}

// resolveClashes marks the pending name_clash events ids resolved. The change
// it returns forgets them and tells each newcomer device to refetch, as the
// name it asked for may now be free.
func (e *Engine) resolveClashes(q *db.Queries, ids []string) (func(), error) {
	at := sql.NullInt64{Int64: e.now().UnixMilli(), Valid: true}
	for _, id := range ids {
		if err := q.ResolveEvent(ctx, db.ResolveEventParams{ResolvedAt: at, ID: id}); err != nil {
			return nil, err
		}
	}
	return func() {
		for _, id := range ids {
			e.publishStatus(e.cur.clashes[id].device)
			delete(e.cur.clashes, id)
		}
	}, nil
}

// Move hands the participant over to the device toDevice, which continues
// from the answers already stored. Every move, back to an earlier device
// too, counts towards the seq base [Engine.Resume] reports. The old device
// is recorded as moved, and
// pending name_clash events over the participant's name are resolved as in
// [Engine.Kick]. It returns [ErrNotFound] for an unknown participant or
// device, and [ErrInvalid] if the participant is kicked or toDevice writes as
// someone else.
func (e *Engine) Move(participantID, toDevice string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	p, err := e.participant(participantID)
	if err != nil {
		return err
	}
	return e.commit(func(q *db.Queries) (func(), error) { return e.move(q, p, toDevice) })
}

func (e *Engine) move(q *db.Queries, p *participant, to string) (func(), error) {
	if p.state == stateKicked {
		return nil, ErrInvalid
	}
	if p.device == to {
		return func() {}, nil
	}
	if _, err := q.GetDevice(ctx, to); err != nil {
		return nil, notFound(err)
	}
	if e.cur.onDevice(to) != nil {
		return nil, ErrInvalid
	}
	from := p.device
	if err := q.InsertMovedDevice(ctx, db.InsertMovedDeviceParams{DeviceToken: from, ParticipantID: p.id}); err != nil {
		return nil, err
	}
	if err := q.SetParticipantDevice(ctx, db.SetParticipantDeviceParams{DeviceToken: to, ID: p.id}); err != nil {
		return nil, err
	}
	if err := q.AddParticipantMove(ctx, p.id); err != nil {
		return nil, err
	}
	resolved, err := e.resolveClashes(q, e.cur.clashesOf(p.id))
	return func() {
		p.device = to
		p.moves++
		if !slices.Contains(e.cur.movedFrom[from], p.id) {
			e.cur.movedFrom[from] = append(e.cur.movedFrom[from], p.id)
		}
		e.cur.status[from] = statusMoved
		e.cur.status[to] = statusWriting
		e.publishStatus(from)
		e.publishStatus(to)
		e.publishTaken(e.cur)
		resolved()
	}, err
}

func (e *Engine) participant(id string) (*participant, error) {
	if e.cur == nil {
		return nil, ErrNotFound
	}
	if p := e.cur.byID(id); p != nil {
		return p, nil
	}
	return nil, ErrNotFound
}

// ResolveEvent applies the teacher's decision on a pending name_clash event
// and marks it resolved: [ActionKickOld] kicks the participant holding the
// name (see [Engine.Kick]), [ActionKickNew] sends the newcomer device back to
// the name picker unless it writes as someone else by now, and [ActionMove]
// moves the holder to the newcomer device (see [Engine.Move]). It returns
// [ErrNotFound] if no such event is pending and [ErrInvalid] for another
// action.
func (e *Engine) ResolveEvent(eventID, action string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur == nil {
		return ErrNotFound
	}
	c, ok := e.cur.clashes[eventID]
	if !ok {
		return ErrNotFound
	}
	holder := e.cur.byID(c.participantID)
	return e.commit(func(q *db.Queries) (func(), error) {
		// Kicking or moving the holder resolves its clashes, this one included.
		switch action {
		case ActionKickOld:
			return e.kick(q, holder)
		case ActionMove:
			return e.move(q, holder, c.device)
		case ActionKickNew:
			resolved, err := e.resolveClashes(q, []string{eventID})
			return func() {
				if e.cur.onDevice(c.device) == nil {
					e.cur.status[c.device] = statusKicked
				}
				resolved()
			}, err
		}
		return nil, ErrInvalid
	})
}

// RenameDevice sets the label the teacher sees for the device, trimmed of
// surrounding spaces. It returns [ErrInvalid] for an empty label and
// [ErrNotFound] for an unknown device.
func (e *Engine) RenameDevice(token, label string) error {
	label = strings.TrimSpace(label)
	if label == "" {
		return ErrInvalid
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	n, err := e.st.Q().RenameDevice(ctx, db.RenameDeviceParams{Label: label, Token: token})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	e.changed()
	return nil
}
