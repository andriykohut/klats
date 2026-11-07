// Package update asks GitHub whether a newer Klats is out. It only tells: the
// teacher downloads and installs a new version by hand, so Klats never
// replaces itself.
package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"time"
)

// Release is a published Klats release.
type Release struct {
	// Version is the release's version without the leading "v", such as "1.2.0".
	Version string
	// NotesURL is the release's page on GitHub, with its notes.
	NotesURL string
}

var (
	tagPattern     = regexp.MustCompile(`^v(\d+\.\d+\.\d+)$`)
	versionPattern = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)(-.+)?$`)
)

// Latest returns the release that url, a GitHub /releases/latest endpoint,
// describes; that endpoint leaves out drafts and pre-releases. It gives up
// after 10 s. A reply other than 200, a body that is not the release's JSON,
// a tag other than v<major>.<minor>.<patch>, or a page that is not https is
// an error.
func Latest(ctx context.Context, c *http.Client, url string) (Release, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Release{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := c.Do(req)
	if err != nil {
		return Release{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return Release{}, fmt.Errorf("update: %s replied %s", url, resp.Status)
	}
	var body struct {
		Tag  string `json:"tag_name"`
		Page string `json:"html_url"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return Release{}, fmt.Errorf("update: the reply is not a release: %w", err)
	}
	m := tagPattern.FindStringSubmatch(body.Tag)
	if m == nil {
		return Release{}, fmt.Errorf("update: the tag %q is not a version", body.Tag)
	}
	// The page opens in the system browser, which must get nothing but a web page.
	if !isHTTPS(body.Page) {
		return Release{}, errors.New("update: the release page is not an https URL")
	}
	return Release{Version: m[1], NotesURL: body.Page}, nil
}

func isHTTPS(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != ""
}

// Newer reports whether latest is a later version than current. Both are
// <major>.<minor>.<patch>, compared as numbers, with an optional suffix such
// as "-rc.1" that marks a pre-release of that version. A version that is not
// in that form, such as "dev", is never newer nor older.
func Newer(current, latest string) bool {
	c, cPre, cOK := parse(current)
	l, lPre, lOK := parse(latest)
	if !cOK || !lOK {
		return false
	}
	if d := slices.Compare(c, l); d != 0 {
		return d < 0
	}
	return cPre && !lPre
}

func parse(v string) (nums []int, pre, ok bool) {
	m := versionPattern.FindStringSubmatch(v)
	if m == nil {
		return nil, false, false
	}
	for _, s := range m[1:4] {
		n, err := strconv.Atoi(s)
		if err != nil {
			return nil, false, false
		}
		nums = append(nums, n)
	}
	return nums, m[4] != "", true
}

// Options configure [Watch].
type Options struct {
	URL    string // the releases/latest endpoint
	Client *http.Client
	// Every is how long a successful check holds; Retry is how often Watch
	// looks whether one is due, and so how soon a failed check is retried.
	Every, Retry time.Duration
	// Current is the running version, compared with [Newer].
	Current string
	// Allowed reports whether a check may run now.
	Allowed func() bool
	// Found receives a release newer than Current, after each check that
	// finds one.
	Found func(Release)
}

// Watch checks for a new release at once and then every o.Retry while one is
// due: until a check succeeds, and again once o.Every has passed since. It
// skips while o.Allowed reports false, logs a failed check, and returns when
// ctx is done.
func Watch(ctx context.Context, o Options) {
	var last time.Time // the last successful check; zero before the first
	t := time.NewTicker(o.Retry)
	defer t.Stop()
	for {
		if (last.IsZero() || time.Since(last) >= o.Every) && o.Allowed() {
			r, err := Latest(ctx, o.Client, o.URL)
			switch {
			case err == nil:
				// Round(0) drops the monotonic reading, so time asleep counts.
				last = time.Now().Round(0)
				if Newer(o.Current, r.Version) {
					o.Found(r)
				}
			case ctx.Err() == nil:
				slog.Info("update check failed; trying again later", "err", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
