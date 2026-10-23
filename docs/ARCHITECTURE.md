# How Klats fits together

Klats runs tests in school computer labs. The teacher's computer runs one
program; the students' computers run nothing but a browser. Most of the
design follows from where it runs:

- **Old lab PCs:** Windows 7 or 8 machines, stuck on Chrome 109 or
  Firefox 115, with 2–4 GB of RAM.
- **A flaky LAN:** the network drops for seconds or minutes, and there may
  be no internet at all.
- **No setup on student PCs:** students open an address, type a code and
  pick their name. There are no accounts.
- **No lost answers:** not to a network drop, a browser crash or a restart
  of the teacher's computer.

## The parts

```
 Teacher's computer                                    Lab computers
+-----------------------------------------------+     +--------------------+
| klats: one Go binary                          |     | any browser        |
|                                               |     |                    |
|  desktop window (Wails)                       |     |  student app       |
|    shows the teacher app, loaded from:        |     |  (React)           |
|                                               |     |                    |
|  teacher API + teacher app                    |     |  answer queue in   |
|    127.0.0.1 only, random port                |     |  localStorage      |
|    guarded by Host, Origin and a token        |     +---------+----------+
|        |                                      |               |
|        v                                      |               |
|  sitting engine --- SQLite: klats.db          |   LAN: HTTP   |
|        ^            snapshots/, logs/         |   and SSE     |
|        |                                      |               |
|  student API + student app                    |<--------------+
|    all interfaces, port 8080 (80 on Windows)  |
+-----------------------------------------------+
```

- **One Go binary** (`cmd/klats`) holds everything: two HTTP servers, the
  sitting engine and the database. The built web apps are embedded in it
  (`web/embed.go`), so it ships as a single file.
- **The student server** listens on every interface. It serves the student
  app and the student API, which is all a lab PC ever talks to. On the
  first run it takes port 80 on Windows, so the address needs no port, or
  else the first free port from 8080 to 8099. It saves that port and uses
  it every time after (see [Answer sync](#answer-sync)).
- **The teacher server** listens on 127.0.0.1 only, on a random port. It
  serves the teacher app and the teacher API.
- **The desktop shell** (`internal/desktop`, Wails v3) is a native window
  that loads the teacher app from the teacher server, as a browser would.
  So the app needs no Wails bindings, and it also runs in a plain browser
  for development and tests. The shell adds:
  - a tray icon while a sitting runs, so closing the window does not stop
    the lesson, and a question before quitting during one;
  - a single instance: a second launch brings the first window forward;
  - the native save dialog for exports.

  It uses WebView2 on Windows, WebKitGTK 6.0 on Linux and WKWebView on
  macOS. With `-dev` there is no window, and the program prints its
  addresses instead. A build tagged `nodesktop` leaves the shell out, needs
  no GTK or WebKit, and runs only with `-dev`.
- **The student app** (`web/student`) is a small React state machine over
  one store:
  - `app.ts` holds the state, what survives a reload, and the flows;
  - `main.tsx` draws the current screen;
  - `sync/` holds the answer queue, the connection and the one-tab lease.
- **The teacher app** (`web/teacher`) is a React app with TanStack Router
  and TanStack Query:
  - `api/` has one function per teacher API route;
  - `events.ts` turns server events into refetches;
  - `pages/` has the library, builder, classes, live view, results and
    settings.
- **The shared package** (`web/shared`) holds what both apps need:
  - the student look (`student-ui/`), which the builder's preview reuses;
  - `browsers.ts` (the [browser floor](#the-browser-floor)), palettes,
    design tokens and fonts;
  - the rich-text renderer;
  - the TypeScript types that tygo generates from Go (`generated/`);
  - the compiled Paraglide messages (`paraglide/`).

  Both of those last two folders are generated and never committed.

### Go packages

| Package | What it is |
|---|---|
| `cmd/klats` | The program: flags, the data folder, both servers, the tick loop, start-up and shutdown. |
| `internal/config` | Finds the per-user data folder and reads and writes `settings.json`: port, address, language. |
| `internal/demo` | Seeds a sample class, test and running sitting for `klats -dev -demo`. |
| `internal/desktop` | The Wails shell: window, tray, single instance, save dialog. The only package that imports Wails. |
| `internal/events` | The in-process pub/sub hub behind the event streams. Its topics are `teacher`, `device:<token>` and `names:<sitting>`. |
| `internal/grading` | Scores single- and multiple-choice answers, and turns points into the 12-point grade. |
| `internal/httpx` | JSON replies, capped body decoding and the single-page-app file server, shared by both APIs. |
| `internal/lan` | Picks the LAN address students are shown and the student port, and watches for address changes. |
| `internal/power` | Keeps the computer awake while a sitting runs, using each OS's own mechanism. |
| `internal/rich` | Validates rich text, a strict subset of ProseMirror JSON. It is the single trust boundary for formatted text. |
| `internal/roster` | Cleans class lists pasted from a spreadsheet, and sorts and tells apart names with Ukrainian collation. |
| `internal/sitting` | The engine: the running sitting, joining, picking names, answer sync, the live view, ending, results and overrides. |
| `internal/sse` | Writes Server-Sent Events from a hub subscription. |
| `internal/store` | SQLite: the connection, embedded goose migrations, transactions and snapshots. `store/db` is generated by sqlc. |
| `internal/studentapi` | The student HTTP API and the student app host: the only thing on the LAN. |
| `internal/teacherapi` | The teacher HTTP API and the teacher app host, with its guard. |
| `internal/testfmt` | The test document a teacher builds, and its checks (`Problems`). |
| `internal/wire` | The JSON shapes of both APIs, from which tygo generates the TypeScript types. |
| `internal/xlsx` | Writes an assignment's results as an Excel workbook. |

## A lesson, end to end

1. **Start.** In the builder, the teacher presses start and picks a class,
   or none, in which case students type their names. `POST /api/sittings`
   calls `Engine.Start`, which:
   - copies the test as it is now into a new *assignment*;
   - opens a *sitting* of it, with a random four-digit join code. The code
     differs from the last 20 sittings', so a device holding an old code
     can't land in the new lesson.

   The board view, for the projector, shows the address, the code and a QR
   code, and never a student's name or grade.
2. **Join.** A student opens the address and types the code, or follows the
   QR code, which carries it as `?code=`. `POST /api/join` returns the class
   list, or asks for a typed name when the sitting has no class. Every
   request carries the browser's *device token*: 16 random bytes made on the
   first visit and kept in localStorage. On its first join, a device gets a
   label, the last number of its IP address (such as `14`), which the
   teacher can rename.
3. **Pick a name.** `POST /api/pick` makes a *participant* and locks the
   name to the device token. The event stream tells every device still
   choosing which names are taken. A second device that asks for a taken
   name is refused and waits, while the teacher gets a pinned decision: send
   the old device back to the names, turn the new one away, or move the
   student to the new device.
4. **Answer.** `GET /api/test` returns:
   - the test, with no correct answers and no points;
   - the answers the server already holds for this participant;
   - the participant's id, the seq base and the device's status.

   Each pick goes into the answer queue and out to `POST /api/answers`. A
   heartbeat, `POST /api/heartbeat`, runs every 5 s, and `POST /api/focus`
   reports each time the student leaves the page.
5. **Live view.** The teacher app shows `GET /api/sittings/current`: one row
   per student, with a cell per question, counts, and events such as joined,
   offline, back online, finished and left the page. It refetches when the
   teacher event stream says `live`, which the engine sends at most every
   250 ms.
6. **End.** `POST /api/sittings/current/end`:
   - finishes everyone still writing;
   - tells every device;
   - snapshots the database.

   A device that was offline at the end can still deliver its answers.
   They are stored, flagged late, regraded, and reported to the teacher.
7. **Results.** The results list and each assignment's results are graded
   from the assignment's copy of the test. The teacher can override the
   points of any answer.
8. **Export.** `POST /api/assignments/{id}/export` writes an Excel
   workbook, to the path the teacher picks in the save dialog, or as a
   download in a plain browser.

## Answer sync

This is the part that keeps every answer, and the part to read before
changing anything in `internal/sitting/sync.go`, `web/student/src/sync/` or
`web/student/src/app.ts`. Its rules are below, each with the problem it
solves.

**Every change has a `changeId`, so a retry is harmless.** A request can
succeed on the server while its response is lost to a dropped connection or
the 8 s timeout. The client then sends the same change again. The server
keeps the id of the change it stored for each question, and skips a change
whose id it holds; a resent change that has since been replaced loses on its
`seq` instead (below). Either way the server acks it, so the client can
forget it. Malformed changes are acked too (and counted as rejected), so a
bad change is never retried forever.

**Each question numbers its changes with a `seq`, and the highest wins.**
Requests arrive out of order after retries, and changes can come from more
than one device. The stored answer is replaced only by a higher `seq`
(`UpsertAnswer`), so an old change can never overwrite a newer one. Client
clocks are never used for ordering or deadlines, because lab PCs often have
the wrong time, and a student could change it. The queue keeps only the
newest unsent change of each question, since the server would ignore the
older ones anyway.

**A move starts a new `seq` generation, so the old device can only fill
gaps.** When the teacher moves a student to another computer, the server
counts the move, and `GET /api/test` returns `seqBase = moves × 1,000,000`.
The new device restores its queue with that base before its first change,
and numbers every later change above it. The old device may still hold
changes it never sent, perhaps because its network died. It numbers them
from the previous base, so they lose to anything the new device sent for the
same question. They still fill the questions the student never answered on
the new device. That is why the server keeps taking changes from a device a
student was moved off, unless the student has since finished on their own
(see `pending` below), and why that device keeps sending until its queue is
empty. This assumes fewer than a million changes to one question between two
moves.

**`pending` holds back the grade until every answer is in.** Every submit
and heartbeat carries `pending`: how many changes the device still holds
unacked after this request. Changes already sent but not yet acked count
too. What happens then depends on how the student finished:
- **On their own:** the device sends everything first. The finish then
  locks the participant against changes from every device, and the grade
  shows at once.
- **By the teacher's End:** the participant keeps taking changes, which are
  stored, flagged late and regraded. Their device shows no grade until it
  reports `pending: 0`. That *settles* the participant: from then on, it
  refuses changes from the device that shows the grade, so a student can't
  probe answers by changing them and watching the grade move.

  Changes from a device the student was moved off still land, flagged late
  and regraded, and the device showing the grade gets a `status` hint to
  fetch it again. The moved-off device never showed a grade, so its changes
  can't be a probe. They may also be the only copy of answers given before
  the move, on an old computer that was offline at the end. So a settled
  grade can still change when such leftovers arrive.
  `participant.refuses`, in `internal/sitting/sync.go`, holds this rule.

**The heartbeat is the source of truth; the event stream only makes things
faster.** Every status a device needs comes back from the heartbeat, every
5 s, and from every submit: writing, finished with the grade, ended, kicked,
moved or unjoined. The event stream carries two hints:
- `status` says the device's status changed, and the client heartbeats at
  once to learn the new one;
- `taken`, while a student chooses a name, lists the names other devices
  hold, and goes straight into the name list.

The app must work with no stream at all: statuses still come with the
heartbeat, and the name list fetches the class list again every 15 s while
the stream is closed. There are three reasons it must:
- antivirus web shields on lab PCs sometimes stall streams;
- the server allows 64 streams per IP address, and a school behind one NAT
  can reach that;
- EventSource never retries after a refusal.

The teacher's stream does reconnect, and each reconnect refetches the live
view in case an event was missed.

**One tab writes, through a lease.** Two tabs of one browser share the
device token and the queue's storage, and two writers would fight over both.
The first tab holds a lease in localStorage, refreshed every 5 s. Another
tab shows a notice and sends nothing, unless the lease has gone 15 s without
a refresh (a crashed tab). If the lease can't be stored, the tab carries on
anyway: a second sender is harmless, because changes are idempotent.

**Offline, nothing is lost and the student keeps going.**
- **On the device:**
  - The queue is saved to localStorage after every change, so a reload or a
    crash loses nothing. A boot that finds the device in no sitting, as
    after the next sitting has started, sends what the queue holds for up
    to 10 s before the code screen; anything left waits for the next boot.
  - The connection counts as offline after two failed requests in a row.
    It then retries after 1, 2, 4 and 8 s, then every 8 s.
  - On reconnect, it sends the queue before it heartbeats, so the server
    has every answer before it reports a status.
  - Finishing waits until the queue is empty.
  - The test itself is kept in memory only. Plain HTTP allows no service
    worker, so a reload needs the teacher's computer.
- **On the server:** a student silent for 15 s is reported offline to the
  teacher. The first request afterwards reports them back online, with the
  number of answers stored since they went offline, those in that request
  included.
- **After a restart:** every change is written to SQLite before the engine
  reports success, so a restarted program resumes the sitting from the
  database. Presence is kept only in memory: after a restart, everyone
  counts as just seen.

**The teacher's address can change mid-lesson.** The program checks its LAN
addresses every 10 s, and the teacher app shows the new address when it
changes. On a student device that went offline, the connection notice
offers a link to type the new address. The app then points every request
and the event stream at it; the student API allows any origin for this,
without credentials. The queue stays in the original page's localStorage,
so nothing is lost. The port never changes on its own: when the saved port is
busy, the program says so, and the teacher picks another in the settings.
Students may have the address bookmarked.

## Security

- **The student API is the only thing on the LAN, and it trusts nothing.**
  - Device tokens must match their format.
  - Bodies are capped at 256 KiB.
  - Joins and picks are rate limited per device token (10 a minute) and
    per IP address or IPv6 /64 (300 a minute, enough for a class behind one
    NAT).
  - Event streams are capped at 64 per address.
  - Errors are fixed codes, without internal detail.
- **The teacher API listens on 127.0.0.1 only, and checks every request
  three ways:**
  - The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`.
    This stops DNS rebinding.
  - An `Origin` header, when present, must be the API's own. This stops
    pages open in a browser on the same computer.
  - The request must carry the launch token, 32 random bytes made at each
    start. This stops other programs on the computer.

  The window opens `/?t=<token>`. That one request sets the token as an
  HttpOnly, SameSite=Strict cookie and redirects to `/`. A bearer header
  works too, for the Vite dev proxy and the end-to-end tests. Bodies are
  capped at 4 MiB.
- **Correct answers never reach students.**
  - The test a device loads has no correct flags and no points.
  - Grading happens only on the server.
  - A student sees only their grade and how many questions they got fully
    right.
- **Rich text is data, not HTML.** Questions and options are stored as
  ProseMirror-style JSON, validated against an allow-list by
  `internal/rich`, and rendered by a React component, never as an HTML
  string.
- **Exports are safe to open.** Student names go into the workbook as
  plain strings, so a name beginning with `=` is never a formula.
- **Nothing leaves the LAN.** There is no telemetry, and no network traffic
  beyond the LAN.

## The browser floor

Student pages must run in **Chrome 109 and Firefox 115**. Those are the last
releases for Windows 7 and 8.1, which many lab PCs still run. Student pages
are also served over plain HTTP, so they are not a secure context: no
service workers, Cache API, `crypto.randomUUID()` or async clipboard.
`crypto.getRandomValues()` and localStorage work.

The floor lives in one module, `web/shared/src/browsers.ts`:
- Its `FLOOR` constant drives the student app's Vite `build.target` and its
  Lightning CSS targets.
- Its doc comment lists what student and shared code must avoid, because
  the build does not polyfill or lower it. Examples are
  `Array.prototype.toSorted`, `Object.groupBy`, `:has()` and `color-mix()`
  with variables. The palettes are precomputed hex colours for that last
  reason.

Raising the floor is a one-line change to `FLOOR`. The avoid-list then
shrinks to match, and the feature check in `web/student/index.html` may need
a newer probe (see below).

A browser below the floor gets a plain notice, «Цей браузер застарий…» with
an English line, instead of a blank page. A few lines of ES5 in
`web/student/index.html` check for features the floor has, and show it.

The teacher app is not held to the floor: it runs in the desktop shell's
current webview.

## Storage

- **Where:** everything lives in the data folder:
  - `%AppData%\Klats` on Windows;
  - `~/Library/Application Support/Klats` on macOS;
  - `$XDG_DATA_HOME/klats` (by default `~/.local/share/klats`) elsewhere.

  It holds `klats.db`, `settings.json`, `snapshots/` and `logs/klats.log`
  (the log is rotated at 5 MB).
- **SQLite** through modernc.org/sqlite, which is pure Go, so the database
  needs no cgo. It runs in WAL mode with foreign keys, over a single
  connection, so writers never contend for the lock.
  - The schema is a set of goose migrations, embedded from
    `internal/store/migrations`. Before migrating an existing database, the
    store snapshots it, and it refuses to touch a database newer than the
    program.
  - Queries are SQL in `internal/store/queries`. sqlc generates the Go for
    them into `internal/store/db`, which is committed.
- **The engine writes through.** It keeps the running sitting in memory,
  behind one mutex. Every change is written to SQLite in a transaction, and
  only then applied in memory and reported as done.
- **A test snapshot per assignment.** Starting a sitting copies the test
  into `assignments.test_snapshot`. Grading, the live view, results and late
  answers all use that copy. Editing or deleting the test afterwards changes
  neither a running sitting nor past results. An assignment can hold several
  sittings: the data model is ready for make-up sittings, which the UI does
  not offer yet.
- **Knowing when an export is out of date.** The `assignments` table has
  three columns for this:
  - Any stored answer, live or late, and any override sets `export_stale`
    and bumps `results_rev`, once per request.
  - An export reads the results along with their `results_rev`. When the
    file is written, it records `exported_at`. It clears `export_stale` only
    if `results_rev` has not moved since, so a change made while the save
    dialog was open keeps the export out of date.
  - The results page says the export is out of date only when both
    `exported_at` and `export_stale` are set. The results list's
    `exportStale` ignores `exported_at`.
- **Snapshots:** `VACUUM INTO` copies in `snapshots/`, taken:
  - at start-up, unless one was already taken that day;
  - after every sitting ends;
  - before a migration.

  The 10 newest are kept.

## Languages

- **Messages:** the UI is in Ukrainian and English. The messages are in
  `web/messages/uk.json` and `en.json`, and Ukrainian (`uk`) is the base
  locale.
- **Compiling:** Paraglide JS compiles them once, in `@klats/shared`'s build
  (`make web`), into `web/shared/src/paraglide`. Both apps import that one
  output, so there is one runtime and one locale state. The first build
  fetches an inlang plugin from a CDN, so it needs internet.
- **Who picks the language:** the teacher, in the settings. Student pages
  follow the teacher's choice, which comes with the join.
- **Go strings:** the Go side shows few strings of its own. The tray menu
  and the quit question are in `internal/desktop/strings.go`, in both
  languages, and the workbook takes the language as an argument. Three are
  Ukrainian only, whatever the language setting:
  - the 401 page's text, «Відкрийте Клац із програми.», in
    `internal/teacherapi/guard.go`;
  - «Новий тест», the title of a new test, in `internal/teacherapi/api.go`;
  - «Тест триває», the reason given to the OS for keeping the computer
    awake, in `cmd/klats/main.go`.
- **Sorting:** student names sort with Ukrainian collation, in Go, through
  `roster.SortKey`, which is also stored as `students.sort_key`. Every list
  and export the server sends is already in that order. The teacher app
  sorts class names itself, with the collation of the UI language.
