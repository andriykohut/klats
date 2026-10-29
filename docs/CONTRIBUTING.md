# Contributing to Klats

Thank you for helping. This page gets you from a fresh clone to a running
lesson, then lists the conventions the code follows. To learn how the parts
fit together, and why, read [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

You need:

- **Go 1.27.3**;
- **Node.js 26.12.1** and **pnpm 12.14.0**, for the web apps;
- **for the desktop shell, on Linux:** GTK 4 and WebKitGTK 6.0. On Ubuntu
  24.04, run `sudo apt-get install libgtk-4-dev libwebkitgtk-6.0-dev`. On
  macOS the shell needs the Xcode command line tools; Windows needs nothing
  extra.

Then, from the repository root:

```sh
make gen web    # generated types, the messages and both web apps
make check      # lint, tests, types and the size budget
make demo       # a lesson to try
```

The first `make web` needs internet: Paraglide fetches an inlang plugin
from a CDN when it first compiles the messages. `make e2e` also needs the
Playwright browsers, once:

```sh
cd web && pnpm --filter @klats/e2e exec playwright install chromium firefox
```

On Linux, add `--with-deps` after `install`, as CI does, to install the
system libraries the browsers need too.

## Make targets

| Target | What it does |
|---|---|
| `make demo` | Builds the web apps and starts a lesson: class 7-Б, a six-question test and a running sitting, in a temporary data folder that is removed on exit. It prints the student address with the join code, and the teacher address. Open both in a browser. |
| `make dev` | Runs `klats -dev`: no window, the addresses printed instead. It uses your real data folder; to use another, run `go run -tags nodesktop ./cmd/klats -dev -data <folder>`. |
| `make build` | Builds `klats` with the desktop shell. It embeds the web apps, so run `make web` first. |
| `make web` | Installs the web dependencies, compiles the messages and builds both apps into `web/*/dist`. |
| `make gen` | Regenerates the Go query code (sqlc) and the TypeScript types (tygo). Run it after changing `internal/store/queries`, `internal/store/migrations`, `internal/wire` or `internal/testfmt`. |
| `make check` | golangci-lint and Biome, the Go and Vitest tests, the TypeScript types and the size budget. CI runs it on every push. |
| `make e2e` | Builds the web apps, then runs the Playwright specs in `web/e2e` in Chromium and Firefox. Each test starts its own server with a fresh data folder. |
| `make load` | A lesson at full size: 40 simulated students against the sitting engine for a minute. |
| `make size` | Checks that the student app's JavaScript stays within 350 KB gzipped, as thirty lab PCs load it at once. Part of `make check`. |

While working, `go test -short ./...` skips the slowest Go test, and `cd web && pnpm --filter @klats/e2e exec playwright test --project=chromium <spec>` runs one e2e spec in Chromium, after `make web`. Run `make check` and `make e2e` before pushing.

### Live reload

To work on a web app with Vite's live reload, start the server, then the
app's dev server, which forwards `/api` to it. Each command keeps running,
so use three terminals, all at the repository root:

```sh
# 1: the server, which prints the addresses
go run -tags nodesktop ./cmd/klats -dev -demo
# 2: the student app
cd web && KLATS_API=http://127.0.0.1:8080 pnpm --filter @klats/student dev
# 3: the teacher app
cd web && KLATS_TEACHER_API='<the teacher address>' pnpm --filter @klats/teacher dev
```

`KLATS_API` is the printed student address, without the `?code=`.
`KLATS_TEACHER_API` is the whole teacher address, token included.

## Conventions

- **Comments say how the code works and why.** Write for someone reading
  the code months from now. Leave out its history ("now", "no longer") and
  never address a reviewer. A doc comment states the contract; an inline
  comment gives the reason for something the code can't show.
- **`shortcut:` marks a known limit.** Write it as
  `shortcut: <the limit>, <when to upgrade>`. To list them all, run
  `git grep -n 'shortcut:'`.
- **Every UI string goes through Paraglide, in both languages.** Add each
  message to `web/messages/uk.json` and `web/messages/en.json`, and use it
  through `m` from `@klats/shared/paraglide/messages.js`. Ukrainian is the
  base locale.
- **Student code respects the browser floor.**
  - Anything a student page loads, the shared package included, must run in
    Chrome 109 and Firefox 115. Check the avoid-list in
    `web/shared/src/browsers.ts` before using a newer JS or CSS feature.
  - Student pages are plain HTTP, so they get no secure-context APIs. Use
    `crypto.getRandomValues()` where you might reach for
    `crypto.randomUUID()`.
  - On student pages, animate only `transform`, `opacity` and SVG strokes.
  - Student layouts must work at 1024×768. The teacher UI must work at
    1366×768, in WebView2 and in WebKit.
- **Two lines are never crossed.** Correct answers never reach a student
  device. Teacher endpoints are never reachable from the LAN.
- **New dependencies need a maintainer's approval.** Open an issue first.
  Versions are pinned exactly. Leave pnpm's release-age guard as it is: if
  a release is too new for it, pin an older one rather than adding an
  exclusion.
- **Tests come first for logic.**
  - Go code gets Go tests.
  - Pure TypeScript modules, such as the answer queue or the paste parser,
    get Vitest tests next to them. React components get no unit tests.
  - Screens and flows are covered by the Playwright specs in `web/e2e`.
    Write a spec the way a student or teacher would use the app: by role
    and visible text, with the copy taken from the messages.
- **Formatting is the tools'.** golangci-lint checks the Go, and Biome
  formats and lints the web code. `make check` runs both.
- **JSON is camelCase.** Every field of `internal/wire` and
  `internal/testfmt` carries a camelCase tag, as the TypeScript side reads
  them. Times are unix milliseconds.
- **Commit subjects are conventional**, such as `fix(student): …` or
  `feat(teacherapi): …`.

## Where to start

- [ROADMAP.md](../ROADMAP.md) lists what comes next, in order, and why.
- The issue tracker will hold smaller tasks once the repository is
  published.
- [manual-test.md](manual-test.md) holds the checks run on real machines
  before each release.
