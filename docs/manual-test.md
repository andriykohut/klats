# Manual release checks

`make check`, `make e2e` and `make load` cover the server, both web apps in
current Chromium and Firefox, and a full-size lesson against the sitting
engine. They cannot cover the old browsers of school labs, the desktop
window on each OS, real Excel, or the oldest systems Klats supports. Run
the checks below on real machines before each release, and record each
result (pass, or what went wrong) in the release pull request.

## Before you start

- **Builds.** Run `make gen web` first.
  - Windows teacher app, on any OS (the Windows shell needs no cgo):

    ```sh
    GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui" ./cmd/klats
    ```

    This gives `klats.exe`, which opens no console window.
  - Linux teacher app: on the Linux machine, install `libgtk-4-dev` and
    `libwebkitgtk-6.0-dev`, then run `make build`.
- **Data.** In the teacher app, make class «7-Б» with five students, and a
  test with:
  - a single-choice and a multiple-choice question;
  - a question of about 1,500 characters with nine answers.
  - for the checks of M2, a test with one question of each of the 15 types,
    with a picture, a formula and a sound. `make demo` builds one.
- **Network.** The teacher computer and the student computers are on one
  LAN, as in a lab. Each student computer opens the address the board view
  («Показати на дошці») shows.

## 1. The student app in Chrome 109 and Firefox 115 (Windows 7 or 8.1)

These are the last browsers for Windows 7 and 8.1, and the floor set in
`web/shared/src/browsers.ts`. Use a lab PC or a VM on the same LAN, with
1024×768 or the PC's real resolution.

Repeat each check in Chrome 109 and in Firefox 115 ESR.

1. **Join.** Open the board address, type the code, pick a name and press
   «Почати тест».
   - *Expected:* the code page shows in the app's fonts, then the class
     list, then the first question. You never see a blank page or «Цей
     браузер застарий…».
2. **Answer.** Answer each question with the mouse. Then use the keys `1`–`9`
   and, on the Ukrainian layout, `А`–`З`, with `Enter` for «Далі».
   - *Expected:* each pick shows its dot or tick at once.
   - The long question fits the screen with «Ще N відповідей нижче». Every
     answer can be scrolled to, and «Далі» stays in view.
3. **Reload.** Reload the page in the middle of the test.
   - *Expected:* the same question, with the answers kept.
4. **Network drop.** Disable the PC's network adapter, answer two more
   questions, wait 20 seconds, then enable it again.
   - *Expected:* the toast says «Немає зв’язку. Відповіді збережено», then
     «Зв’язок відновлено».
   - The teacher's events panel says the student is back, with
     «…збережених під час розриву: 2».
5. **Finish.** Go through the review and press «Завершити тест».
   - *Expected:* the grade and «Правильно: N з M», matching the teacher's
     journal.
6. **Below the floor.** Open the address in an older browser, such as
   Internet Explorer 11 or Chrome 100.
   - *Expected:* only «Цей браузер застарий. Відкрийте тест у Chrome або
     Firefox.» and its English line.
7. **Every type, mouse.** Open a test with one question of each of the 15
   types (`make demo` builds one) and answer each with the mouse only.
   - *Expected:* every answer shows at once, survives a reload and counts in
     the grade the teacher sees.
8. **Every type, keyboard.** Answer one question of each type with the
   keyboard only: `Tab`, the arrow keys, `Space` and `Enter`. A card can
   move by `Enter` on its drag handle, then `Tab` to a place and `Enter`.
   - *Expected:* every type can be answered and the focus is always visible.
9. **Dragging.** Drag with the mouse in the ordering, matching, grouping,
   word bank and label questions.
   - *Expected:* the card follows the pointer, lands where it is dropped and
     is kept after a reload.
   - On a long matching question at 1024×768, drag a card to a place below
     the fold. *Expected:* the page scrolls while dragging and the card lands
     there.
10. **Audio.** Play the question with sound, then seek and pause.
    - *Expected:* it plays, seeks and pauses in Chrome and Firefox.
11. **Formulas offline.** Open a test with formulas and let every page show
    its formulas. Disable the PC's network adapter and move between the
    questions with formulas.
    - *Expected:* the formulas stay set in the KaTeX fonts, with no boxes or
      fallback letters.
12. **1024×768.** Set the screen to 1024×768 and go through one question of
    each type.
    - *Expected:* the question, its answers and «Далі» fit or scroll with
      «Ще N відповідей нижче», and nothing is cut off or overlaps, the
      picture questions and the long code or table included.
13. **A heavy SVG.** On an old lab PC, open a question whose picture is an
    SVG of 1 MB or more, such as a GeoGebra export.
    - *Expected:* it renders acceptably: it shows within a few seconds, and
      scrolling and moving between questions do not stall.
14. **Tests in the older format.** In the teacher app, open five real `.mtf`
    files with pictures, ordering and matching questions, start a sitting of
    each and go through it here. When a Windows PC has the program the files
    were made in, open them there too.
    - *Expected:* each file opens. Its pictures show, and the click areas,
      the order and the pairs are those of the original.

## 2. The Windows teacher app (Windows 10)

Start from an empty data folder (`%APPDATA%\Klats`, or move it aside).

1. **Window and single instance.** Start `klats.exe`, then start it again.
   - *Expected:* one window titled «Клац» opens on «Мої тести», at least
     1366×768.
   - The second start brings the first window forward and opens nothing
     new.
2. **WebView2 requests.** Create a test, edit it until «Збережено» shows,
   delete another test and let the undo toast run out, then start a sitting.
   - *Expected:* every step works: «Збережено» shows, the deleted test
     leaves the list with no error toast, and the live view opens.
   - These are POST, PUT and DELETE requests. The teacher API refuses any
     request whose `Origin` header is present and is neither
     `http://127.0.0.1:<port>` nor `http://localhost:<port>`; a request with
     no `Origin` passes. If WebView2 sends any other Origin, such as `null`,
     the save never reaches «Збережено», the deleted test comes back with an
     error, and the sitting does not start.
3. **Port 80.** On the first run, look at the board address.
   - *Expected:* the address has no port, and student PCs open
     `http://<address>/`.
   - Repeat with another program holding port 80, such as IIS or a second
     web server. Also try one bound to a single address only (for example
     `127.0.0.1:80`).
   - *Expected:* Klats takes a port from 8080–8099 and shows it, or shows the
     red «Порт … зайнятий» banner. It never runs with an address students
     cannot reach.
4. **Firewall.** On the first start, answer Windows Firewall's question for
   private networks.
   - *Expected:* once it is allowed, student PCs connect.
5. **Keep-awake.** Set sleep to 1 minute (Settings → System → Power). Start a
   sitting and leave the PC idle for 3 minutes. Then end the sitting and wait
   2 minutes.
   - *Expected:* the PC stays awake during the sitting and sleeps after it.
   - During the sitting, `powercfg /requests` lists `klats.exe` under
     SYSTEM. After the end it lists nothing for it.
6. **Close, tray and quit.** While a sitting runs, close the window.
   - *Expected:* the window hides and a tray icon «Клац» appears.
     «Показати вікно» brings the window back.
   - Choose «Вийти» in the tray menu. *Expected:* «Тест ще триває. Вийти?»
     in front of the window.
   - Dismiss the question with «Скасувати», then with `Esc`, then with the
     dialog's close button. Ask again after each one.
   - *Expected:* each way keeps Klats running, and the question can be asked
     again.
   - Confirm «Вийти». *Expected:* Klats quits. At the next start, the
     sitting is still running and students go on writing.
   - With no sitting running, close the window. *Expected:* Klats quits,
     and no tray icon shows.
7. **Save dialog.** End a sitting, open its results and press «Експорт в
   Excel».
   - *Expected:* a save dialog opens in Documents, with «<test> — <class> —
     <date>.xlsx» as the name.
   - Save it. *Expected:* the toast «Збережено: <path>».
   - Press «Експорт в Excel» again and cancel the dialog. *Expected:* no
     toast and no error.
   - Open the file in Excel and export to the same path again.
     *Expected:* «Не вдалося записати файл. Якщо він відкритий в Excel,
     закрийте його й спробуйте ще раз.»
8. **A failed start.** Quit Klats, copy the data folder aside, and mark the
   database as made by a newer version:
   `sqlite3 klats.db "insert into goose_db_version(version_id, is_applied) values (99, 1)"`.
   Start Klats.
   - *Expected:* «Не вдалося відкрити дані Клацу» comes to the front, with
     no window behind it. Its message ends with «Відкрити сайт?», and its
     buttons are Windows's own «Так» and «Ні» (Yes and No on an English
     Windows).
   - Press «Так». *Expected:* the browser opens the website's download
     section, and Klats exits. Start Klats again and press «Ні».
     *Expected:* Klats exits.
   - Put the data folder back, rename `klats.db` and make a folder named
     `klats.db` in its place. Start Klats. *Expected:* «Клац не запустився»
     comes to the front with the path of `logs\klats.log`, then «Показати
     журнал?», over «Так» and «Ні».
   - Press «Так». *Expected:* Explorer opens the `logs` folder, and Klats
     exits. Start Klats again and press «Ні». *Expected:* Klats exits.
   - Remove the folder and rename the file back. Start Klats, then quit it
     and double-click a `.klats` file. *Expected:* the window opens each
     time.

## 3. A Linux teacher run (Ubuntu 24.04, amd64)

Use a real desktop session, not a container.

1. **Window.** Start `./klats`.
   - *Expected:* the window opens on «Мої тести», drawn by WebKitGTK 6.0.
2. **A lesson.** Start a sitting, and let two student PCs or browsers join
   over the LAN, answer and finish.
   - *Expected:* the live view follows them, as on Windows.
3. **Tray and quit.** Repeat check 2.6.
   - *Expected:* the same results. Where the desktop shows no tray icon
     (stock GNOME), starting `./klats` again brings the hidden window back.
4. **Keep-awake.** Start a sitting, then end it.
   - *Expected:* `systemd-inhibit --list` shows Klats while the sitting runs
     and not after.
   - After the end, and again after quitting, `pgrep -a systemd-inhibit`
     and `pgrep -a tail` show nothing Klats started.
5. **Save dialog.** Repeat check 2.7 with the GTK dialog.
   - *Expected:* the same results.
6. **A failed start.** Repeat check 2.8.
   - *Expected:* the same results, except that the buttons read «Відкрити
     сайт» or «Показати журнал», in place of «Так», and «Закрити», in place
     of «Ні». «Показати журнал» opens the `logs` folder in the file manager.

## 4. The export in real Excel

Open a workbook from check 2.7 in Microsoft Excel. Use a current version
and the oldest one the school uses.

- *Expected:* it opens without a repair prompt.
- Both sheets, «Результати» and «Питання», show Ukrainian text correctly.
- Points and grades are numbers, and the date column shows dates at its
  default width, not `####`.
- A student whose name starts with `=` shows the name, not a formula.

## 5. The oldest supported systems

On each system, install the teacher app the way a teacher would, start it,
and run one sitting with one student browser.

| System | Expected |
|---|---|
| macOS 13 Ventura | Starts and works; Go 1.27 sets this floor. |
| Ubuntu 24.04 | Starts and works. |
| Debian 13 | Starts and works. |
| Fedora 40 | Starts and works. |
| One version older (macOS 12, Ubuntu 22.04) | Does not start, or the package refuses to install. Note what the teacher sees, for the user docs. |

## 6. The teacher program

The builder, the library and the results use browser features and native
dialogs that differ between the three desktop webviews, and the tests cannot
reach them. Run the checks on
Windows 10 (WebView2), macOS 13 or newer (WKWebView) and Ubuntu 24.04
(WebKitGTK), and note which system each result is from. A check marked with a
system is for that system only. Each line says what to do, then what should
happen.

### Dragging, typing and pasting

- In the builder, drag items to a new place in the lists of an ordering, a
  matching, a grouping and a word bank question. *Expected:* the item
  follows the pointer and the new order is saved.
- On a picture, drag an area of a hotspot question and a point of a label
  question. *Expected:* they follow the pointer and stay where they are
  dropped.
- In a number field, type «.». *Expected:* it turns into the decimal comma «,».
- Windows only: double-click a word in a gaps question and press
  `Ctrl+Shift+G`, then double-click another and press `Ctrl+K` in a
  highlight question. *Expected:* the gap or the mark covers the word and
  not the space after it.
- In the picture field, click it and paste a picture, then drop another
  picture file on it. *Expected:* each shows in the field.
- Windows only: upload the same picture twice at once, for example by pasting
  it into two fields quickly. *Expected:* both show, with no error.
- Paste a PNG, or a WebP, that WebKit must re-encode, and a HEIC photo from
  an iPhone. *Expected:* each is stored as a picture the students see; if a
  format is not supported, the message asks to save it as JPG or PNG.
- Copy text that holds only a picture from Word and paste it into a question.
  *Expected:* the picture shows and nothing else is added.
- Add a WAV over 10 MiB as a sound. *Expected:* it is refused with a message
  that says audio is limited to 10 MB, and the test is unchanged.

### Opening and exporting tests

- In the library, press «Відкрити». *Expected:* the system's file picker
  opens, and a `.klats` or `.mtf` file can be chosen in it. Choosing one adds
  the test at the top of the list with «Тест «…» відкрито».
- Drag a `.klats` file, then an `.mtf` file, from the system's file manager
  (Explorer, Finder or Files) onto the library. *Expected:* while the file is
  over the window, «Перетягніть файл сюди» shows over the page; dropping it
  opens the test as «Відкрити» does.
- Press «Експортувати» on a test with a picture. *Expected:* the system's
  save dialog opens in Documents with the file type «Тест Клацу» and the
  test's title as the name. The file appears where it was saved.
- Open a test exported on another of the three systems. *Expected:* it
  opens with every question, picture and sound.
- In «Налаштування», press «Експортувати все» on one machine and «Відновити з
  копії…» with that file on another, then confirm. *Expected:* the save dialog
  opens with the file type «Резервна копія Клацу»; after the restore every test,
  class, result and picture is there.

### Layout

- At 1366×768, open the picture field of a hotspot question and a long
  question's answer-review drawer in the results. *Expected:* nothing is cut
  off or overlaps, and the drawer scrolls inside the window.

### Students and the program

- With formulas on a student page in Chrome 109 and Firefox 115 and the KaTeX
  fonts already loaded, disable the student PC's network. *Expected:* the
  formulas on the pages already opened stay set in the KaTeX fonts.
- While a sitting runs with student pages open, stop the program and start it
  again, once by closing it and once by killing it (Task Manager,
  `kill -9`). *Expected:* each time, the student
  pages reconnect with «Зв’язок відновлено», and every answer given before
  and during the break is in the results.

### Starting

- macOS only: repeat check 2.8, starting Klats.app from the Dock or Finder.
  *Expected:* the same results as check 3.6.
