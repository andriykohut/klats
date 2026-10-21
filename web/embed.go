// Package webui embeds the built student and teacher web apps so the Go
// binary serves them without external files.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:student/dist
var studentDist embed.FS

//go:embed all:teacher/dist
var teacherDist embed.FS

// Student and Teacher are the built apps, rooted at their dist directories.
var (
	Student = mustSub(studentDist, "student/dist")
	Teacher = mustSub(teacherDist, "teacher/dist")
)

func mustSub(fsys fs.FS, dir string) fs.FS {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		panic(err)
	}
	return sub
}
