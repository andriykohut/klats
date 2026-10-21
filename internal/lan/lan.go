// Package lan picks the LAN address students are shown and the port the
// server listens on.
package lan

import (
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"slices"
	"sort"
	"strconv"
	"strings"

	"klats/internal/config"
)

// Iface is a network interface reduced to what address selection needs.
type Iface struct {
	Name         string
	Up, Loopback bool
	Addrs        []netip.Addr
}

// System lists the machine's interfaces. On error it logs and returns nil.
func System() []Iface {
	nis, err := net.Interfaces()
	if err != nil {
		slog.Error("list network interfaces", "err", err)
		return nil
	}
	var out []Iface
	for _, ni := range nis {
		i := Iface{Name: ni.Name, Up: ni.Flags&net.FlagUp != 0, Loopback: ni.Flags&net.FlagLoopback != 0}
		as, err := ni.Addrs()
		if err != nil {
			slog.Error("list interface addresses", "interface", ni.Name, "err", err)
			continue
		}
		for _, a := range as {
			if n, ok := a.(*net.IPNet); ok {
				if addr, ok := netip.AddrFromSlice(n.IP); ok {
					i.Addrs = append(i.Addrs, addr.Unmap())
				}
			}
		}
		out = append(out, i)
	}
	return out
}

var (
	virtualHints  = []string{"virtual", "vmware", "vmnet", "vbox", "vethernet", "hyper-v", "docker", "veth", "br-", "tailscale", "zerotier", "utun", "wsl"}
	wirelessHints = []string{"wi-fi", "wifi", "wlan", "wireless", "бездрот", "беспровод"}
	privateRanges = []netip.Prefix{
		netip.MustParsePrefix("192.168.0.0/16"),
		netip.MustParsePrefix("10.0.0.0/8"),
		netip.MustParsePrefix("172.16.0.0/12"),
	}
)

func containsAny(s string, hints []string) bool {
	return slices.ContainsFunc(hints, func(h string) bool { return strings.Contains(s, h) })
}

// Candidates returns the private IPv4 addresses of up, non-loopback
// interfaces that students may be able to reach, best first: physical before
// virtual adapters, then 192.168/16, 10/8, 172.16/12, then wired before
// wireless, then input order. Link-local, CGNAT and public addresses are
// dropped.
func Candidates(ifaces []Iface) []netip.Addr {
	type cand struct {
		addr                   netip.Addr
		virtual, rng, wireless int
	}
	var cs []cand
	for _, i := range ifaces {
		if !i.Up || i.Loopback {
			continue
		}
		name := strings.ToLower(i.Name)
		var virtual, wireless int
		if containsAny(name, virtualHints) {
			virtual = 1
		}
		if strings.HasPrefix(name, "wl") || containsAny(name, wirelessHints) {
			wireless = 1
		}
		for _, a := range i.Addrs {
			if !a.Is4() {
				continue
			}
			r := slices.IndexFunc(privateRanges, func(p netip.Prefix) bool { return p.Contains(a) })
			if r < 0 || slices.ContainsFunc(cs, func(c cand) bool { return c.addr == a }) {
				continue
			}
			cs = append(cs, cand{a, virtual, r, wireless})
		}
	}
	sort.SliceStable(cs, func(x, y int) bool {
		a, b := cs[x], cs[y]
		if a.virtual != b.virtual {
			return a.virtual < b.virtual
		}
		if a.rng != b.rng {
			return a.rng < b.rng
		}
		return a.wireless < b.wireless
	})
	out := make([]netip.Addr, len(cs))
	for i, c := range cs {
		out[i] = c.addr
	}
	return out
}

// Choose returns saved when it parses and is among cands, otherwise the first
// candidate. It reports false when cands is empty.
func Choose(cands []netip.Addr, saved string) (netip.Addr, bool) {
	if len(cands) == 0 {
		return netip.Addr{}, false
	}
	if a, err := netip.ParseAddr(saved); err == nil && slices.Contains(cands, a) {
		return a, true
	}
	return cands[0], true
}

// URL is the address students open; the port is omitted when it is 80.
func URL(addr netip.Addr, port int) string {
	if port == 80 {
		return "http://" + addr.String()
	}
	return "http://" + net.JoinHostPort(addr.String(), strconv.Itoa(port))
}

// ErrPortBusy reports that the saved port could not be bound. The port is
// never swapped for another, because students may have it bookmarked.
type ErrPortBusy struct {
	Port int
	Err  error
}

func (e ErrPortBusy) Error() string { return fmt.Sprintf("port %d is unavailable: %v", e.Port, e.Err) }
func (e ErrPortBusy) Unwrap() error { return e.Err }

// ports lists the ports tried on first run: 80 on Windows (so the URL needs
// no port), then 8080-8099.
func ports(goos string) []int {
	var out []int
	if goos == "windows" {
		out = append(out, 80)
	}
	for p := 8080; p <= 8099; p++ {
		out = append(out, p)
	}
	return out
}

// Listen binds all interfaces. With s.Port == 0 it takes the first free port
// for goos and stores it in s.Port; the caller persists the settings. With a
// saved port it binds exactly that port or returns ErrPortBusy.
func Listen(s *config.Settings, goos string) (net.Listener, error) {
	return listen(s, ports(goos))
}

func listen(s *config.Settings, candidates []int) (net.Listener, error) {
	if s.Port != 0 {
		l, err := net.Listen("tcp", ":"+strconv.Itoa(s.Port))
		if err != nil {
			return nil, ErrPortBusy{Port: s.Port, Err: err}
		}
		return l, nil
	}
	for _, p := range candidates {
		if l, err := net.Listen("tcp", ":"+strconv.Itoa(p)); err == nil {
			s.Port = p
			return l, nil
		}
	}
	return nil, fmt.Errorf("no free port among %v", candidates)
}
