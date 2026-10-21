package lan

import (
	"context"
	"net/netip"
	"slices"
	"time"
)

// Watch polls list every interval until ctx is done and calls onChange when
// the set of addresses differs from the previous poll, ignoring order. The
// first poll only sets the baseline.
func Watch(ctx context.Context, every time.Duration, list func() []netip.Addr, onChange func(old, new []netip.Addr)) {
	old := list()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		cur := list()
		if !sameSet(old, cur) {
			onChange(old, cur)
			old = cur
		}
	}
}

func sameSet(a, b []netip.Addr) bool {
	a, b = slices.Clone(a), slices.Clone(b)
	slices.SortFunc(a, netip.Addr.Compare)
	slices.SortFunc(b, netip.Addr.Compare)
	return slices.Equal(a, b)
}
