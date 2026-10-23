package teacherapi

import (
	"context"
	"net/http"
	"time"
	"unicode/utf8"

	"klats/internal/httpx"
	"klats/internal/roster"
	"klats/internal/sitting"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/wire"
)

func (a *api) listClasses(w http.ResponseWriter, r *http.Request) {
	rows, err := a.st.Q().ListClassSummaries(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	out := make([]wire.ClassSummary, 0, len(rows))
	for _, c := range rows {
		out = append(out, wire.ClassSummary{ID: c.ID, Name: c.Name, StudentCount: int(c.StudentCount)})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func loadClass(ctx context.Context, q *db.Queries, id string) (wire.Class, error) {
	c, err := q.GetClass(ctx, id)
	if err != nil {
		return wire.Class{}, err
	}
	rows, err := q.ListStudents(ctx, id)
	if err != nil {
		return wire.Class{}, err
	}
	out := wire.Class{ID: c.ID, Name: c.Name, Students: make([]wire.Student, 0, len(rows))}
	for _, s := range rows {
		out.Students = append(out.Students, wire.Student{ID: s.ID, Name: s.Name})
	}
	return out, nil
}

func (a *api) getClass(w http.ResponseWriter, r *http.Request) {
	c, err := loadClass(r.Context(), a.st.Q(), r.PathValue("id"))
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, c)
}

// cleanClass normalizes the class name and the student names, drops students
// with an empty name, and returns [sitting.ErrInvalid] for an empty class
// name or a name over maxNameRunes.
func cleanClass(c wire.Class) (wire.Class, error) {
	c.Name = roster.Normalize(c.Name)
	if c.Name == "" || utf8.RuneCountInString(c.Name) > maxNameRunes {
		return c, sitting.ErrInvalid
	}
	students := make([]wire.Student, 0, len(c.Students))
	for _, s := range c.Students {
		s.Name = roster.Normalize(s.Name)
		if utf8.RuneCountInString(s.Name) > maxNameRunes {
			return c, sitting.ErrInvalid
		}
		if s.Name != "" {
			students = append(students, s)
		}
	}
	c.Students = students
	return c, nil
}

func (a *api) createClass(w http.ResponseWriter, r *http.Request) {
	var req wire.Class
	if !decode(w, r, &req) {
		return
	}
	req, err := cleanClass(req)
	if err != nil {
		fail(w, r, err)
		return
	}
	id := store.NewID()
	err = a.st.Tx(r.Context(), func(q *db.Queries) error {
		if err := q.InsertClass(r.Context(), db.InsertClassParams{ID: id, Name: req.Name, CreatedAt: time.Now().UnixMilli()}); err != nil {
			return err
		}
		for _, s := range req.Students {
			p := db.InsertStudentParams{ID: store.NewID(), ClassID: id, Name: s.Name, SortKey: roster.SortKey(s.Name)}
			if err := q.InsertStudent(r.Context(), p); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	c, err := loadClass(r.Context(), a.st.Q(), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, c)
}

// putClass renames the class and makes its students match the request:
// entries with an id of the class are updated, entries without one are added,
// and students left out are removed. It is all or nothing.
func (a *api) putClass(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req wire.Class
	if !decode(w, r, &req) {
		return
	}
	req, err := cleanClass(req)
	if err != nil {
		fail(w, r, err)
		return
	}
	err = a.st.Tx(r.Context(), func(q *db.Queries) error {
		ctx := r.Context()
		if _, err := q.GetClass(ctx, id); err != nil {
			return err
		}
		if err := q.RenameClass(ctx, db.RenameClassParams{Name: req.Name, ID: id}); err != nil {
			return err
		}
		existing, err := q.ListStudents(ctx, id)
		if err != nil {
			return err
		}
		unseen := make(map[string]bool, len(existing))
		for _, s := range existing {
			unseen[s.ID] = true
		}
		for _, s := range req.Students {
			key := roster.SortKey(s.Name)
			switch {
			case s.ID == "":
				err = q.InsertStudent(ctx, db.InsertStudentParams{ID: store.NewID(), ClassID: id, Name: s.Name, SortKey: key})
			case unseen[s.ID]:
				delete(unseen, s.ID)
				err = q.UpdateStudent(ctx, db.UpdateStudentParams{Name: s.Name, SortKey: key, ID: s.ID})
			default: // not a student of this class, or listed twice
				err = sitting.ErrInvalid
			}
			if err != nil {
				return err
			}
		}
		for sid := range unseen {
			if err := q.DeleteStudent(ctx, sid); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	c, err := loadClass(r.Context(), a.st.Q(), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, c)
}

func (a *api) deleteClass(w http.ResponseWriter, r *http.Request) {
	n, err := a.st.Q().DeleteClass(r.Context(), r.PathValue("id"))
	if err == nil && n == 0 {
		err = sitting.ErrNotFound
	}
	noContent(w, r, err)
}

func (a *api) parseClass(w http.ResponseWriter, r *http.Request) {
	var req wire.ParseRequest
	if !decode(w, r, &req) {
		return
	}
	names := roster.ParsePaste(req.Text)
	if names == nil {
		names = []string{}
	}
	httpx.JSON(w, http.StatusOK, wire.ParseResult{Names: names})
}
