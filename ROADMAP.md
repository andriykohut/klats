# Roadmap

Klats reaches version 1 in five milestones. Each one builds on the one
before it, and the order says why.

## M1: the core loop (done)

A teacher builds a test of single- and multiple-choice questions, keeps
class lists, and runs the test over the school LAN. Students join with a
code and their name, and answer through network drops. The teacher watches
live, ends the sitting, reviews and overrides the results, and exports them
to Excel.

*Why first:* it proves the hardest promise, that no answer is ever lost on
a flaky network, end to end, with the simplest question types.

## M2: every question type, with media

- **The other 13 question types:**
  - true/false grid and choice grid;
  - short text, number, and fill in the gaps;
  - ordering, matching, sorting into groups, and dragging words into a
    text;
  - clicking a spot on a picture, and labelling a picture;
  - highlighting words in a text;
  - a written answer, graded by the teacher.
- **Media:** images, formulas and audio, in questions and answers.

*Why next:* variety is what lets a teacher move all their tests to Klats.
Each type reuses the sync, grading and results paths that M1 proved.

## M3: test settings, the library, sharing and backup

- **Test settings:**
  - time limits;
  - shuffling;
  - grading scales;
  - what students see at the end;
  - a forward-only mode.
- **The test library:** search, duplicate, and exporting and opening
  `.klats` files.
- **Sharing and backup.**

*Why here:* settings such as shuffling and scales must cover every question
type, and a `.klats` file carries the whole test format, media included.
Both wait until M2 has settled that format.

## M4: opening tests from older formats

Teachers who already have tests in older formats can open them in Klats.
They become tests in the library.

*Why here:* a test opened from an older format needs every question type
and setting to map onto, so it waits for M2 and M3.

## M5: installers and the website

- **Installers:** Windows, macOS and Linux.
- **Signing.**
- **The update check:** it only reports a new release, and never updates
  during a lesson.
- **The website:** a bilingual site for teachers, with the instructions in
  Ukrainian.

*Why last:* packaging and the teachers' guide describe a finished product,
so they come once the features are in place.

## Later, after version 1

- Python code questions, graded against the teacher's test cases in a
  sandbox.
- A seat map in the live view.
- A switch for the teacher to turn student animations off, for labs with
  very weak PCs.
- Alternative visual styles per test.
- An MCP server, so AI assistants can create and edit tests.
- Watching a lesson from a tablet, with a teacher login.
- Personal PINs for students.
- A teacher build for Windows 7 and 8.
- Password-protected files in older formats.
- Math-expression answers and file-upload answers.
