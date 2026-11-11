# Screenshot slots

The install page shows some screens of Windows and macOS that no script can
take. Until someone captures them by hand, each is a dashed box
(`<figure class="slot">`) with a one-line description. The slots, their
descriptions and their file names are in `src/i18n.ts`, under
`install.windows.steps` and `install.mac.steps`.

Capture each one on a real machine whose system language matches the page:
Ukrainian for the Ukrainian page (`/klats/install/`), English for the English
one (`/klats/en/install/`). Save it as `src/assets/shots/<lang>/<file>.png`,
and the next build shows it in place of the box.

| File                  | Screen                                                               | Step            | System language |
| --------------------- | -------------------------------------------------------------------- | --------------- | --------------- |
| `windows-smartscreen` | The blue «Windows захистив ваш ПК» window                            | Windows, step 2 | uk, en          |
| `windows-run-anyway`  | The same window after «Докладніше», with «Усе одно запустити»        | Windows, step 2 | uk, en          |
| `windows-uac`         | The admin prompt «Дозволити цій програмі вносити зміни…» for Klats   | Windows, step 3 | uk, en          |
| `mac-dmg`             | The opened `Klats.dmg` window with Klats and the Applications folder | Mac, step 2     | uk, en          |
| `mac-not-opened`      | macOS refusing to open Klats on its first launch                     | Mac, step 3     | uk, en          |
| `mac-privacy`         | System Settings → Privacy & Security with «Усе одно відкрити»        | Mac, step 4     | uk, en          |

The app's own screens (`live`, `builder`, `student` and `results` in
`src/assets/shots/<lang>/`) are not slots: they are captured from Klats
itself.
