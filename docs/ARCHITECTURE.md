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
  - a single instance: a second launch brings the first window forward and
    hands it the `.klats` files among its arguments;
  - double-clicked `.klats` files. A path from the system or from a second
    launch waits in `teacherapi.OpenedFiles`, and the `file_opened` event
    announces it. The library takes each file from `GET /api/opened` and
    opens it as «Відкрити» does. The other pages in the top bar's frame go
    to the library first; the builder and the live view leave the file
    waiting until the teacher leaves them;
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
| `cmd/klats` | The program: flags, the data folder, both servers, the tick loop, start-up and shutdown. Its version is `dev` unless a release build sets `main.version` with `-ldflags`; the settings page shows it under «Про програму». |
| `internal/backup` | Writes all the data to one `.klatsbackup` file, the database and the media it uses, and checks one before a restore. It is the trust boundary for restored backups. |
| `internal/config` | Finds the per-user data folder and reads and writes `settings.json`: port, address, language, and whether to check for updates, which is on unless the teacher turns it off. `PUT /api/settings` sets the port, the language and the update switch together, so the teacher app always sends all three; the address goes through `PUT /api/network`. |
| `internal/demo` | Seeds a sample class, test and running sitting for `klats -dev -demo`. |
| `internal/desktop` | The Wails shell: window, tray, single instance, save dialog, the system browser for links out, and the `.klats` files the system opens. The only package that imports Wails. |
| `internal/events` | The in-process pub/sub hub behind the event streams. Its topics are `teacher`, `device:<token>` and `names:<sitting>`. |
| `internal/grading` | Judges answers (`Judge`: points, plus a verdict for each part of the answer), and turns points into a grade on the test's scale (12-point, percent or pass/fail). It covers every question type. |
| `internal/httpx` | JSON replies, capped body decoding, file names safe on every OS and the single-page-app file server, shared by both APIs. |
| `internal/klatsfile` | Reads and writes `.klats` files, the zips teachers share tests in: `test.json` and the media the test uses. It is the trust boundary for opened tests. |
| `internal/lan` | Picks the LAN address students are shown and the student port, and watches for address changes. |
| `internal/media` | The store for test images and audio: files named by their SHA-256, typed by sniffing their bytes, with size caps. |
| `internal/mediazip` | The zip layout `.klats` files and backups share, one main entry and `media/<name>` files, and its safe reading: the directory budget, entry names, capped reads and the media hash check. |
| `internal/mtf` | Reads tests in the older format, `.mtf` files, and converts them into Klats tests, with notes on what needs the teacher's attention. It is the trust boundary for those files. |
| `internal/power` | Keeps the computer awake while a sitting runs, using each OS's own mechanism. |
| `internal/rich` | Validates rich text, a strict subset of ProseMirror JSON. It is the single trust boundary for formatted text. |
| `internal/roster` | Cleans class lists pasted from a spreadsheet, and sorts and tells apart names with Ukrainian collation. |
| `internal/sitting` | The engine: the running sitting, joining, picking names, answer sync, time limits, each student's own questions, the live view, ending, results, overrides and restore. |
| `internal/sse` | Writes Server-Sent Events from a hub subscription. |
| `internal/store` | SQLite: the connection, embedded goose migrations, transactions, snapshots, and replacing every row from another database for a restore. `store/db` is generated by sqlc. |
| `internal/studentapi` | The student HTTP API and the student app host: the only thing on the LAN. |
| `internal/teacherapi` | The teacher HTTP API and the teacher app host, with its guard. |
| `internal/testfmt` | The test document a teacher builds, its settings and their defaults (`settings.go`), the fields each question type keeps (`types.go`), its checks (`Problems`) and what makes an answer valid (`CleanAnswer`). |
| `internal/update` | Asks GitHub whether a newer release is out, and compares versions (see [Updates](#updates)). |
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
   - the test, with no correct answers and no points, holding only the
     participant's own questions;
   - the answers the server already holds for this participant;
   - the participant's id, the seq base and the device's status.

   The participant's questions are a pure function of the assignment's
   snapshot and the participant id (`questionsFor`, in
   `internal/sitting/questions.go`): the questions the draw lines of the
   test's settings pick at random, when there are any (each line a count from
   one tag or from all questions, the tag lines first, none picked twice),
   kept in test order unless questions are shuffled, and an order of the
   participant's own when they are. Nothing is stored, and a reload or a move
   to another computer shows the same questions in the same order. Options are
   shuffled per device instead. Grading, the live view, the results and the
   export work over each participant's own questions; a question a participant
   did not get counts in no percent, and a change for it is rejected. When the
   test has draw lines, the live and results journals give each participant
   one column per question they got, in their own order and numbered as on
   their screen, each cell's tooltip naming the question's number and text in
   the test; there is no row of class percents, and «—» only pads a row
   shorter than the longest. The export's «Результати» sheet keeps one column
   per test question and leaves a question the participant did not get empty.

   A test whose settings say forward only carries `navigation: "forward"`,
   and the student app alone enforces it: the progress strip and the
   review's unanswered questions are not buttons, Skip and Next only go on,
   and a reload or a move resumes at the saved place or the question after
   the last answered one, whichever is later (`resume`, in
   `web/student/src/app.ts`). The server does not check positions.

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

   Written answers wait for the teacher. Until the teacher sets its points,
   an answered written question is *pending*:
   - it scores 0;
   - the student's finish result says a grade is still to come;
   - the live view shows a `pending` cell;
   - the results list leaves the row out of the average grade;
   - the export leaves the row's grade and that question's points blank.

   A blank written answer scores 0 and is not pending. Setting the points,
   even 0, grades it, and the student's device gets the new grade.

   When the test's questions carry tags, the results also score each tag
   (`tagScores`, in `internal/sitting/tags.go`): the points earned on its
   questions out of the points available on them, counting only the
   questions each participant got and leaving out answers still pending. A
   question with two tags counts toward both. The results page shows the
   whole class's percent per tag in a «За тегами» block above the journal,
   and the export adds a «Теги» sheet with each student's percents and a
   last row «Увесь клас». A test without tags has neither.

   How much of the grade a device is told follows the test's `reveal`
   setting. Every result a device gets, from the finish or in the status of
   a heartbeat, a submit or `GET /api/test`, comes from `finishResult` in
   `internal/sitting/sync.go`:
   - `grade`: the grade and how many questions got full points;
   - `mistakes`: also the student's own numbers of the questions short of
     full points, leaving out written answers until the teacher grades them;
   - `nothing`: no grade, count or pending flag at all. The teacher's
     finished event and the results still carry the grade.
8. **Export.** `POST /api/assignments/{id}/export` writes an Excel
   workbook, to the path the teacher picks in the save dialog, or as a
   download in a plain browser. The library's `.klats` export
   (`POST /api/tests/{id}/export`) goes the same way, through `deliver` in
   `internal/teacherapi/results.go`. The save dialog's file replaces the
   old one whole, through a temporary file and a rename. A download is
   written to a temporary file in the data folder's `tmp/` first and sent
   with its length, so a write that fails partway is an error, never a short
   file.

## Answer sync

This is the part that keeps every answer, and the part to read before
changing anything in `internal/sitting/sync.go`, `web/student/src/sync/` or
`web/student/src/app.ts`. Its rules are below, each with the problem it
solves.

**An answer is a value, not a list of option ids.** A change carries a
`testfmt.Answer`: `items`, `pairs`, `text` and `point`, each omitted when
empty. The server stores its JSON in `answers.value`, reduced to the field
the question's type uses. A change whose answer names an id the question
lacks, or a value its type does not allow, is rejected whole
(`Question.CleanAnswer`). The
queue saves `{v: 2, …}` under `klats.answers.<participantId>`. `isAnswered`
in `web/shared/src/answers.ts` and `Answer.IsEmpty` in Go both say whether an
answer holds anything.

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

**Time is the server's, and the server never cuts a student off.** A test's
time limit (`internal/sitting/time.go`) runs in one of two ways:
- **per student**, from the moment the participant is created
  (`joined_at`);
- **to a common end time**, which the teacher picks at start
  (`sittings.ends_at`), after now and at most 12 h ahead.

Either deadline adds `participants.extra_ms`, which the teacher raises for
one writing student with `POST /api/participants/{id}/time` (1 to 60
minutes) so that the deadline lands that many minutes after the later of the
deadline and now; the device gets a `status` hint. Every status of a writing
participant in a timed test carries `remainingMs`, the time to the deadline
by the server's clock, never below 0, so neither a reload nor a wrong lab
clock can stretch it. The server never finishes anyone when time runs out: a
computer that died stays writing until the teacher gives it more time or ends
the sitting.

The teacher app shows a common end time in its live bar, with a countdown on
`Date.now()`: it runs on the server's own machine, so its clock is the
server's. The start dialog asks for the end time only for a "common" test and
sends `endsAt`; the live rows carry no time left, and a row menu's «+5 хв»
(timed sitting, row not finished) is the only way to add time.

A change stored more than 10 s (`lateGrace`) after the participant's deadline
is still stored and graded, but flagged late, as after the end. The grace
covers a change made just before the deadline and still in flight. While the
sitting runs, such changes raise an `overtime_answers` event instead of
`late_answers`, once per participant and request, with their count.

The student app counts down from the last `remainingMs` on
`performance.now()` (`web/student/src/app.ts`), so it keeps counting offline,
and every status sets the count again. At zero it locks the answers and
finishes, as the student's own finish does: it waits for the queue to empty,
so answers given offline before zero still arrive, flagged late if they come
after the grace. More time that arrives before the finish is sent, such as
«+5 хв» seen on reconnecting, takes the student back to the test. A test that
opens already out of time, after a reload, a reboot or a move past the
deadline, locks and says «Час вийшов» but sends no finish: it keeps syncing
until «+5 хв» brings the test back or the sitting ends.

**The heartbeat is the source of truth; the event stream only makes things
faster.** Every status a device needs comes back from the heartbeat, every
5 s, and from every submit: writing, finished with the grade, ended, kicked,
moved or unjoined. The event stream carries two hints:
- `status` says the device's status changed, and the client heartbeats at
  once to learn the new one;
- `taken`, while a student chooses a name, lists the names other devices
  hold, and goes straight into the name list.

The app must work with no stream at all. While a test syncs, statuses still
come with the heartbeat. The name list has no heartbeat: while the stream is
closed it fetches the class list again every 15 s, and a computer waiting
after a name clash learns that the teacher moved the student to it only when
the student taps the name again. The server answers that pick idempotently
with the moved participant, and the test opens. There are three reasons it
must:
- antivirus web shields on lab PCs sometimes stall streams;
- the server allows 64 streams per IP address, and a school behind one NAT
  can reach that;
- EventSource never retries after a refusal.

The teacher's stream does reconnect, and each reconnect refetches the live
view in case an event was missed.

**One tab writes, through a lease.** Two tabs of one browser share the
device token and the queue's storage, and two writers would fight over both.
The first tab holds a lease in localStorage, refreshed every 5 s. Another
tab shows a notice and sends nothing. It tries again every 5 s, and takes
over once the lease is released, when the first tab closes, or has gone 15 s
without a refresh (a crashed tab). If the lease can't be stored, the tab carries on
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
  - Bodies are capped at 1 MiB, room for a batch of 5,000-character written
    answers.
  - Media files are served only for the running test (or the last ended
    one), so a student cannot fetch the files of other tests.
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
  capped at 4 MiB, and media uploads at 10 MiB.
- **Uploads are sniffed and capped.** The media store decides a file's type
  from its leading bytes, never from the name or header the client sent.
  Only JPEG, PNG, GIF, WebP, SVG, MP3, M4A, Ogg and WAV are kept; HTML and
  anything else is refused. An SVG is XML whose root element is `<svg>`,
  which `encoding/xml` must find starting within the first 8 KiB; it is
  stored as it came. Images are capped at 5 MiB and audio at 10 MiB. Files are served by
  their content-hash name only, with the type the store chose and `nosniff`.
  SVG responses also carry `Content-Security-Policy: sandbox`: an `<img>`
  never runs an SVG's scripts, and the sandbox stops them in an SVG opened
  directly. The student app keeps its offline copy of an SVG as a `data:`
  URL, not a `blob:` URL, because a blob URL opened in a tab of its own runs
  the SVG's scripts in the student app's origin.
- **Opened files are untrusted:** `.klats` files and backups.
  - `internal/klatsfile` stores nothing from a `.klats` file until every
    check that does not need the media store has passed. Only `test.json`
    and `media/<media name>` entries are allowed.
  - The file is capped at 256 MiB and its central directory at 1 MiB, read
    through a budget, since `archive/zip` reads directory entries past the
    count the file declares. `test.json` is capped at 4 MiB, the entries at
    2,000, and the media the test uses at 256 MiB in all, so a small file
    cannot fill the disk. Each entry is read through its cap, whatever size
    the zip claims.
  - `test.json` must pass `testfmt.Decode`, and each media file must hash to
    its name and then pass the media store's sniffing and caps.
  - `POST /api/tests/import` reads the request body through the same 256 MiB
    cap into a temporary file in the data folder's `tmp/`, removed whatever
    happens, and stores the test as a new one. An export whose media come to
    over 256 MiB is refused, since the file could not be opened again.
  - `GET /api/opened` reads only a path the shell queued, never one from the
    request, and refuses a file over the same 256 MiB cap. The teacher app
    sends the bytes back through `POST /api/tests/import`. Only under `-dev`
    does `POST /api/opened` queue any path, for the end-to-end tests.
  - A backup goes through the same pieces (`internal/mediazip`), with caps
    for a whole library: the body at 2 GiB, the central directory at 8 MiB,
    50,000 entries, `klats.db` at 2 GiB inflated, each media entry at
    10 MiB and the media in all at 2 GiB inflated. Only `klats.db` and
    `media/<media name>` entries are allowed. `backup.Prepare` stores
    nothing until `klats.db` has opened (migrated if older), passed
    `PRAGMA integrity_check` and had every test and assignment snapshot pass
    `testfmt.Decode`, and every used media entry has hashed to its name.
    Beyond those checks and the database's own constraints, which every
    restored row must meet, a backup is trusted as the teacher's own file:
    nothing guards against one crafted by hand.
- **Correct answers never reach students.**
  - The test a device loads has no correct flags and no points.
  - Grading happens only on the server.
  - A student sees what the test's reveal setting allows: their grade and
    how many questions they got fully right, that and the numbers of the
    questions they missed, or nothing.
- **Rich text is data, not HTML.** Questions and options are stored as
  ProseMirror-style JSON, validated against an allow-list by
  `internal/rich`, and rendered by a React component, never as an HTML
  string.
- **Formulas are LaTeX, drawn by KaTeX with `trust` off.** A formula is a
  `math` node holding LaTeX source, which `internal/rich` length-checks like
  any attribute. KaTeX draws it into DOM nodes it builds itself, never from
  an HTML string, and cannot make links or raw HTML. Its `maxSize` and
  `maxExpand` options bound what one formula may cost.
- **Highlighted code is a token tree, never HTML.** A code block holds plain
  text and a `language` that `internal/rich` checks against six ids. lowlight
  turns the text into a tree of tokens, and the shared `CodeView` builds
  elements from it, so highlighting never passes through an HTML string.
- **Exports are safe to open.** Student names go into the workbook as
  plain strings, so a name beginning with `=` is never a formula.
- **Nothing leaves the LAN but the update check.** There is no telemetry.
  The one request beyond the LAN asks GitHub for the newest release (see
  [Updates](#updates)), and the teacher can turn it off.

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

Formulas need KaTeX, which the student app loads only
for a test that has formulas, at test load, as its own chunk with its style
and fonts (`web/student/src/math.ts`). It then fetches the font faces at once,
so formulas still draw after the network drops. Until it arrives, a formula
shows its LaTeX source.

Syntax highlighting is loaded the same way, for a test that has a code block
with a language: lowlight and six grammars form their own chunk
(`web/student/src/highlighter.ts`). Until it arrives, or if it fails to load,
code shows as plain text.

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

  It holds `klats.db`, `settings.json`, `media/`, `snapshots/`, `tmp/` and
  `logs/klats.log` (the log is rotated at 5 MB). A damaged `settings.json` is logged, and the
  program starts with the defaults.
- **`tmp/`** holds what lives only for one request: uploaded files and
  backups spooled from the request body, downloads waiting to be sent, the
  database copy a backup is made from and the folder a restore checks a
  backup in. Each is removed when its request ends, and start-up empties the
  folder, once the program holds the single instance, so a crash
  mid-backup leaves nothing behind past the next start.
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
- **Media files.** `media/<sha256>.<ext>` holds the images and audio of
  tests. A name is the hash of the bytes, so a file never changes and
  uploading it again stores nothing new. Writes go to a temporary file that
  is then renamed, so a crash leaves no half-written file. Media are never
  deleted: a file no test uses costs disk space and nothing else, and after
  a restore the folder may hold files the restored data does not use.
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
  - before a migration;
  - before a restore.

  The 10 newest are kept.
- **Backup and restore.** `POST /api/backup` writes a `.klatsbackup` file
  through `deliver`, as an export does, named «Клац — резервна копія —
  YYYY-MM-DD.klatsbackup» after the local date. The file is a zip of
  `klats.db`, a `VACUUM INTO` copy made in `tmp/` and deflated, and
  `media/<name>`, uncompressed, for every file a test or an assignment's
  snapshot in that copy uses (`internal/backup`). A used file missing from
  the media folder is logged and left out.

  `POST /api/backup/restore` takes the raw file and replaces every test,
  class and result, with no restart:
  1. The body is spooled to `tmp/`.
  2. `backup.Prepare` extracts `klats.db` into a folder in `tmp/`, opens it
     with `store.Open`, which migrates a backup an older version made, and
     checks it (see [Security](#security)). It stores the media the backup
     uses. All of this runs outside the engine's lock.
  3. `Engine.Restore` takes the lock and refuses while a sitting runs
     (409 `sitting_active`). It snapshots the database, then
     `Store.ReplaceFrom` attaches the checked copy and, in one transaction
     with foreign keys checked at the commit, empties every table but
     `goose_db_version` and refills it from the copy, column by column and
     keeping rowids. The copy must be at the program's schema version. On
     any error nothing changes.
  4. The engine reloads the latest sitting from the new rows, as at
     start-up.

  A backup from a newer version is a 422 `backup_too_new`, and one that is
  not a valid backup a 422 `file_damaged`. A failure of the disk or the
  media folder is a 500.

  Both routes are refused while a sitting runs (409 `sitting_active`): a
  backup made then would restore with the sitting still running, and a
  restore checks before it reads the body as well as under the lock. A
  backup that would come to over 2 GiB, which a restore would refuse, is
  stopped as it is written and is a 422 `too_large`.

## Opening tests in the older format

Teachers bring tests from the program they used before Klats, saved as
`.mtf` files of version 10.2 of the older format. `internal/mtf` reads them
and turns each into a Klats test. Klats never writes the format.

- **The file:** one encrypted stream of a signature, a version string and a
  zlib stream holding the body. The body is a fixed sequence of records: the
  test header, its themes, its questions and, last, a table of picture files
  that questions name by key.
- **Streaming:** `mtf.Open` decrypts and inflates as it reads, walking the
  body field by field and keeping only what a converted test uses. Each
  picture of the table goes to the media store as soon as it is read, so a
  body of a hundred megabytes is never held in memory.
- **Caps:** files arrive by e-mail or on flash drives, so every count and
  length is checked against a cap before anything is allocated: the inflated
  body at 256 MiB, a string at 8,388,608 UTF-16 code units, a list at 10,000
  entries and a picture file at 16 MiB. A malformed file is an error wrapping
  `mtf.ErrDamaged`, never a panic (`FuzzRead`, `FuzzRTF`, `FuzzPictWMF`). A
  file in the format's 2008–2012 layout is `mtf.ErrOldLayout`; Klats cannot
  read it.
- **Converting:**
  - Texts are RTF. Bold, italic, superscript and subscript are kept, every
    other style is dropped, and a `\'xx` byte is decoded by the charset of
    its font rather than by the document's code page, since Cyrillic fonts
    often sit in documents declared Western.
  - Pictures are BMP, JPEG or PNG files in the table, or WMF pictures inside
    RTF. A BMP, and the bitmap a WMF draws, are stored as PNG, since the
    media store refuses BMP.
  - The eight question types become `single`, `multi`, `order`, `match`,
    `truefalse`, `number`, `short` and `hotspot`. A click area becomes the
    rectangle around it.
  - The time limit becomes each student's own timer. Every other setting is
    the default; the file's grade table is read and ignored.
  - Themes group questions, and a theme may ask some of its own at random. A
    file with one theme holding questions gets no tags; when that theme asks
    some but not all of them at random, the test draws as many from all its
    questions. With more, each theme holding questions becomes a tag named
    after it, a repeated name numbered « (2)», « (3)» in theme order. When any
    of them asks at random, each gets a draw line in theme order: as many as
    it asks, at most its size; none when it asks 0, since then none of it is
    asked; and all of it when it does not ask at random.
  - The converted test passes `testfmt.Decode` before `Open` returns it. A
    test that Decode refuses is a converter bug, not a damaged file.
- **Notes:** `Open` also returns what did not carry over exactly, as
  `wire.OpenNote`s. On a question:
  - `image_lost`: a picture could not be read or was refused by the store,
    with how many;
  - `area_reshaped`: a click area that was not a rectangle became the
    rectangle around it;
  - `order_extra_dropped`: ordering items outside the order were removed,
    with how many;
  - `hint_dropped`: a hint or an explanation, which Klats has no place for;
  - `text_cut`: a text over the caps of Klats was shortened.
- **Real files in tests:** real files hold personal data, so none is in the
  repository, and tests build synthetic ones with `internal/mtf/mtftest`,
  which only tests import. `TestCorpus` opens every `.mtf` file under the
  directories listed in `KLATS_MTF_CORPUS`, joined by the OS's list
  separator, and logs for each directory the questions per type, the notes
  per code and the slowest file. It is skipped when the variable is unset.

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
  languages, and the workbook takes the language as an argument. Six are
  Ukrainian only, whatever the language setting:
  - the 401 page's text, «Цю сторінку можна відкрити лише у вікні Клацу.», in
    `internal/teacherapi/guard.go`;
  - «Новий тест», the title of a new test, in `internal/teacherapi/api.go`;
  - the backup's file name, «Клац — резервна копія — YYYY-MM-DD.klatsbackup»,
    in `internal/teacherapi/backup.go`;
  - «Тест триває», the reason given to the OS for keeping the computer
    awake, in `cmd/klats/main.go`;
  - «Тест», the file name of a test whose title is empty once made safe for
    a file name, in `internal/teacherapi/tests.go`;
  - «Тест», the file name of a results workbook whose test title is empty
    once made safe for a file name, in `internal/xlsx/xlsx.go`.
- **Sorting:** student names sort with Ukrainian collation, in Go, through
  `roster.SortKey`, which is also stored as `students.sort_key`. Every list
  and export the server sends is already in that order. The teacher app
  sorts class names itself, with Ukrainian collation too, whatever the UI
  language.

## Updates

Klats never updates itself: it says when a newer version is out, and the
teacher downloads it from the website.

- **The check:** `update.Watch` asks GitHub's `releases/latest` endpoint,
  which leaves out drafts and pre-releases, at start and then once a day.
  It looks every hour whether a check is due, so a failed one is retried an
  hour later. It never checks from a `dev` build, during a sitting, or with
  «Перевіряти оновлення» off.
- **The notice:** a newer release is held in memory by `teacherapi.Updates`,
  which `GET /api/about` reports and the `update_found` event announces.
  Once the live view has loaded and no sitting runs, the top bar shows
  «Нова версія» where the live chip goes, and its card links to the
  website's download section and to the release's notes.
- **Links out:** `POST /api/open/{target}` opens, in the system browser,
  only pages the server names: `download`, in the UI language, or `notes`,
  the release's https page. Under `-dev` it replies with the page, and the
  teacher app opens it in a new tab.

## Packaging

Each system has a script under `build/` that turns a version into that
system's installers in `dist/`.

- **Windows:** `build/windows/build.ps1 -Version 1.2.3` builds `klats.exe`
  with the version stamped in and Wails' `production` tag, which turns
  DevTools off, then compiles `build/windows/klats.iss` with Inno Setup 6
  twice, into `Klats-Setup.exe` and `Klats-Setup-Offline.exe`.
  The offline one carries Microsoft's WebView2 runtime installer, which the
  script downloads, and runs it only when the runtime is missing.
  - Both ask for admin rights and install for every user into Program
    Files. They speak the Windows display language if it is Ukrainian or
    English, and otherwise ask, offering Ukrainian.
  - They add a firewall rule that lets the local subnet reach `klats.exe` on
    domain, private and public networks, and make `.klats` files open in
    Klats with the path as the only argument, the one case in which Wails
    reports a file opened at launch.
  - `klats.exe` has no icon resource: the window takes its icon from Wails,
    and the shortcuts, the uninstall entry and the file type use
    `klats.ico` and `klats-file.ico`, installed beside it.
  - Installing over an older version keeps the data; the restart manager
    offers to close a running Klats first. Uninstalling removes the rule
    and asks, defaulting to «Ні», whether to delete the data folder of the
    user who uninstalls.
- **macOS:** `build/macos/build.sh 1.2.3` builds the binary for Apple
  Silicon and for Intel with the same version stamp and tag, joins them
  with `lipo` into one universal `Klats.app`, signs it ad hoc and packs it
  into `Klats.dmg`, a volume named «Клац» that holds the app and a link to
  `/Applications`.
  - The app has no Developer ID signature; the ad hoc one makes macOS
    report an app from an unidentified developer rather than a damaged one.
  - `build/macos/Info.plist.in` gives the bundle the single-instance ID
    `ua.klats.teacher` and macOS 13 as its floor, and exports the type
    `ua.klats.test` for `.klats` files with Klats as their editor; macOS
    sends Klats a document open only for a type the bundle declares.
- **Linux:** `build/linux/build.sh 1.2.3` builds one x86_64 binary on
  Ubuntu 24.04 with the version stamped in and the `production` tag, and
  packs it into `klats_amd64.deb` and `Klats-x86_64.AppImage`. Both run on
  the system's GTK 4 and WebKitGTK 6.0, and the AppImage bundles no
  libraries, so both need a system no older than Ubuntu 24.04, Debian 13
  or Fedora 40.
  - The `.deb` depends on `libgtk-4-1` and `libwebkitgtk-6.0-4` and installs
    the binary, a menu entry, the icon and the `application/x-klats-test`
    type for `.klats` files. The menu entry runs `klats %f`, so a
    double-clicked file arrives as the only argument, as Wails needs at
    launch. The menu and type caches update through the dpkg triggers of
    `desktop-file-utils` and `shared-mime-info`, so the package has no
    maintainer scripts. A pre-release version such as `0.1.0-rc.1` becomes
    `0.1.0~rc.1`, which dpkg sorts before `0.1.0`.
  - The AppImage holds the same files and an `AppRun` that passes its
    arguments on unchanged. It runs without installing and registers no
    menu entry or file type itself. The script builds it with
    `appimagetool` 1.9.0 and the AppImage runtime from the `type2-runtime`
    release `20251108`, downloading both and checking each against a
    pinned SHA-256.
- **Releases:** pushing a tag such as `v1.2.3` starts
  `.github/workflows/release.yml`, which runs the three scripts on
  `windows-2025`, `macos-15` and `ubuntu-24.04` with the tag's version, then
  drafts a release titled «Клац 1.2.3» that holds the five installers, with
  `build/release-notes.md` as its notes. A tag with a `-`, such as
  `v0.1.0-rc.1`, makes it a pre-release. The owner fills in the notes and
  publishes the draft; the [update check](#updates) sees neither drafts nor
  pre-releases. Started by hand on a branch, the workflow builds version
  `0.0.0-dev.N`, N being the run number, keeps the installers as the run's
  artifacts for a week and drafts nothing.

## Website

The teachers' website, `andriykohut.github.io/klats`, is a plain Astro site
in the `web/site` workspace package. `make web` builds it with the apps, and
`.github/workflows/pages.yml` publishes it on GitHub Pages when `web/site`
or the fonts change on `main`.

- **Languages:** Ukrainian at the root and English under `/en/`, with every
  string in `web/site/src/i18n.ts`. Each page under `src/pages/en/` renders
  its Ukrainian page with `lang="en"`.
- **What it shares with the app:** only the fonts, through
  `@klats/shared/fonts.css`. The teal palette is copied into CSS variables
  in `src/layouts/Page.astro`.
- **Downloads:** the buttons link to `releases/latest/download/<installer>`,
  so a release needs no change to the site. A small script picks the
  visitor's system; without it, the page shows the Windows button and links
  to the other four installers. The front page's first download block has
  the id `download`, which the app's [update notice](#updates) opens.
- **Screenshots:** the app's own screens are in `src/assets/shots/<lang>/`.
  Screens of Windows and macOS that no script can take are dashed slots,
  listed with their file names in `web/site/SLOTS.md`.
- **Browsers:** teachers may read it on the same old lab PCs, so it uses no
  CSS or JS beyond [the browser floor](#the-browser-floor).
