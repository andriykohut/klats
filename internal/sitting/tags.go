package sitting

import (
	"math"
	"slices"

	"klats/internal/testfmt"
	"klats/internal/wire"
)

// tagScores returns the tags of qs in order of first appearance, each with
// the share of points all rows together earned on it (see [wire.TagScore]),
// and for each row of rows its own shares, aligned with the tags. A row's
// Points are in the order of qs. Both slices, and each row's shares, are
// empty but never nil when no question has a tag.
func tagScores(qs []testfmt.Question, rows []wire.ResultRow) ([]wire.TagScore, [][]*int) {
	var names []string
	index := map[string]int{}
	for _, q := range qs {
		for _, tag := range q.Tags {
			if _, ok := index[tag]; !ok {
				index[tag] = len(names)
				names = append(names, tag)
			}
		}
	}
	classEarned, classAvailable := make([]float64, len(names)), make([]float64, len(names))
	per := make([][]*int, len(rows))
	for r, row := range rows {
		earned, available := make([]float64, len(names)), make([]float64, len(names))
		for i, q := range qs {
			if len(q.Tags) == 0 || !slices.Contains(row.Order, q.ID) || slices.Contains(row.PendingIDs, q.ID) {
				continue
			}
			for _, tag := range q.Tags {
				earned[index[tag]] += row.Points[i]
				available[index[tag]] += float64(q.Points)
			}
		}
		per[r] = make([]*int, len(names))
		for j := range names {
			per[r][j] = percent(earned[j], available[j])
			classEarned[j] += earned[j]
			classAvailable[j] += available[j]
		}
	}
	tags := make([]wire.TagScore, len(names))
	for j, name := range names {
		tags[j] = wire.TagScore{Tag: name, Pct: percent(classEarned[j], classAvailable[j])}
	}
	return tags, per
}

// percent returns round(100 × earned / available), or nil when nothing is
// available.
func percent(earned, available float64) *int {
	if available == 0 {
		return nil
	}
	p := int(math.Round(100 * earned / available))
	return &p
}
