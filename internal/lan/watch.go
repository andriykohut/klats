package lan

import (
	"context"
	"net/netip"
	"slices"
	"time"
)

// Watch polls list every interval until ctx is done and calls onChange when
// the set of addresses differs from the previous poll, ignoring order. The
// first poll only sets the baseline. every must be positive. ctx is checked
// before each onChange, but a call that has already started may still run once
// after ctx is done.
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
			if ctx.Err() != nil {
				return
			}
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
