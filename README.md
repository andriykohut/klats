Klats (Клац) — програма для шкільного тестування. Інструкції українською з'являться на сайті проєкту.

# Klats

Klats is a free, open-source app for running tests in school computer labs.
The teacher builds tests and runs them from one program on their own
computer, and students take them in any browser on the lab PCs, over the
school's local network, with no accounts, no internet and nothing to
install. Answers survive network drops and restarts, and the teacher
watches the class live and gets graded results.

**Status:** milestone 2, pre-release. The core loop works end to end, with
15 question types: single and multiple choice, true/false, choice grids,
short text, numbers, gaps, ordering, matching, grouping, word banks, clicking
a spot on a picture, labelling a picture, highlighting words and written
answers, which the teacher grades. Questions and answers can hold pictures,
audio, formulas, tables and code. There are no installers yet.

## Quick start

You need Go 1.27.3, Node.js 26.12.1 and pnpm 12.14.0. On Linux, the desktop
window also needs GTK 4 and WebKitGTK 6.0 (see
[CONTRIBUTING.md](docs/CONTRIBUTING.md)).

```sh
make gen web build   # the web apps, then the klats binary
make demo            # a sample lesson to try
```

`make demo` prints a student address with the join code, and a teacher
address. Open each in a browser.

## Learn more

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how Klats fits together,
  and why.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md): setup, the make targets
  and the conventions.
- [ROADMAP.md](ROADMAP.md): what comes next.
- [docs/manual-test.md](docs/manual-test.md): the checks run on real
  machines before each release.

## Licence

GPL-3.0. See [LICENSE](LICENSE).
