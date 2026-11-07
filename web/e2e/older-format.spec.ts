import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Page } from "@playwright/test";
import { expect, m, openFile, TEST, test } from "./fixtures";

// Synthetic files in the older format, written by TestE2EFixtures in
// internal/mtf/mtftest.
const OLDER = join(import.meta.dirname, "fixtures", "older.mtf");
const CLEAN = join(import.meta.dirname, "fixtures", "older-clean.mtf");
const MANY = join(import.meta.dirname, "fixtures", "older-many.mtf");

/**
 * Fires the drag events `types` on the page's document, each carrying the
 * file `name` of `bytes`, as a file dragged in from the system would, or
 * without `bytes` the text `name`. Returns what each `dispatchEvent`
 * returned: false for an event a listener cancelled.
 */
function drag(page: Page, types: string[], name: string, bytes?: Buffer) {
  return page.evaluate(
    ([types, name, base64]) => {
      const data = new DataTransfer();
      if (base64 === null) data.setData("text/plain", name);
      else {
        const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        data.items.add(new File([raw], name));
      }
      return types.map((type) =>
        document.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: data,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    },
    [types, name, bytes?.toString("base64") ?? null] as const,
  );
}

/** Drags the file `name` of `bytes` onto the page and drops it. */
const drop = (page: Page, name: string, bytes: Buffer) =>
  drag(page, ["dragenter", "dragover", "drop"], name, bytes);

const SCRIPTED_FILES =
  "Firefox leaves the files of a script-made DataTransfer empty";

test("an older-format file opens with a report", async ({ klats }) => {
  const page = await klats.teacher("/");
  await openFile(page, OLDER);
  const report = page.getByRole("alertdialog", {
    name: m.tests_opened({ title: "Старий тест" }),
  });
  await expect(
    report.getByText(m.open_report_count({ count: 7 }), { exact: true }),
  ).toBeVisible();
  const links = report.getByRole("link");
  await expect(links).toHaveText([
    m.open_report_question({
      number: 3,
      note: m.note_order_extra_dropped({ count: 1 }),
    }),
    m.open_report_question({ number: 7, note: m.note_area_reshaped() }),
  ]);

  await links.nth(1).click();
  await expect(page).toHaveURL(/\/tests\/[^?]+\?q=q7$/);
  // Questions 1–2, 3–4 and 5–7 sit in three themes; the first two ask one
  // question each.
  const doc: TestDoc = await page.evaluate(
    async (id) => (await fetch(`/api/tests/${id}`)).json(),
    new URL(page.url()).pathname.split("/")[2],
  );
  expect(doc.test.questions.map((q) => q.tags)).toEqual([
    ...Array(2).fill(["Урок 1"]),
    ...Array(2).fill(["Урок 2"]),
    ...Array(3).fill(["Урок 3"]),
  ]);
  expect(doc.test.settings.draw).toEqual([
    { tag: "Урок 1", count: 1 },
    { tag: "Урок 2", count: 1 },
    { tag: "Урок 3", count: 3 },
  ]);
  await expect(
    page
      .getByRole("listbox", { name: m.builder_questions() })
      .getByRole("option")
      .nth(6),
  ).toHaveAttribute("aria-selected", "true");
  const picture = page
    .getByRole("group", { name: m.builder_picture() })
    .locator("img");
  await expect
    .poll(() => picture.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
});

test("a long report scrolls its notes, keeping the title and buttons in view", async ({
  klats,
}) => {
  const page = await klats.teacher("/");
  await openFile(page, MANY);
  const title = m.tests_opened({ title: "Багато підказок" });
  const report = page.getByRole("alertdialog", { name: title });
  const heading = report.getByRole("heading", { name: title });
  const open = report.getByRole("button", { name: m.open_report_open() });
  const links = report.getByRole("link");
  await expect(links).toHaveCount(30);
  await expect(heading).toBeInViewport({ ratio: 1 });
  await expect(open).toBeInViewport({ ratio: 1 });

  const last = links.last();
  await expect(last).toHaveText(
    m.open_report_question({ number: 30, note: m.note_hint_dropped() }),
  );
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
  await expect(heading).toBeInViewport({ ratio: 1 });
  await expect(open).toBeInViewport({ ratio: 1 });
  await last.click();
  await expect(page).toHaveURL(/\/tests\/[^?]+\?q=q30$/);
});

test("a clean older-format file just opens", async ({ klats }) => {
  await klats.create(TEST, undefined, "Дроби");
  const page = await klats.teacher("/");
  await expect(page.getByText(m.tests_count({ count: 1 }))).toBeVisible();

  await openFile(page, CLEAN);
  await expect(
    page.getByText(m.tests_opened({ title: "Байти" }), { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(m.tests_count({ count: 2 }))).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Байти", exact: true }),
  ).toBeVisible();
  // The toast is an alertdialog too, so the report is told by its button.
  await expect(
    page.getByRole("button", { name: m.open_report_open() }),
  ).toBeHidden();
});

test("a damaged older-format file is refused", async ({ klats }, testInfo) => {
  const page = await klats.teacher("/");
  const file = testInfo.outputPath("cut.mtf");
  writeFileSync(file, readFileSync(OLDER).subarray(0, 200));

  await openFile(page, file);
  await expect(
    page.getByText(m.tests_file_damaged(), { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: m.tests_empty_title() }),
  ).toBeVisible();
});

test("the open button offers .mtf", async ({ klats }) => {
  const page = await klats.teacher("/");
  await expect(page.locator("input[type=file]")).toHaveAttribute(
    "accept",
    /\.mtf/,
  );
});

test("dropping a .klats file opens it", async ({ klats, browserName }) => {
  test.skip(browserName === "firefox", SCRIPTED_FILES);
  await klats.create(TEST, undefined, "Дроби");
  const page = await klats.teacher("/");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: m.tests_export() }).click();
  const bytes = readFileSync(await (await download).path());

  await drop(page, "Дроби.klats", bytes);
  await expect(
    page.getByText(m.tests_opened({ title: "Дроби" }), { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(m.tests_count({ count: 2 }))).toBeVisible();
});

test("dropping an .mtf file opens it with the report", async ({
  klats,
  browserName,
}) => {
  test.skip(browserName === "firefox", SCRIPTED_FILES);
  const page = await klats.teacher("/");
  // The extension's case does not matter.
  await drop(page, "older.MTF", readFileSync(OLDER));
  await expect(
    page.getByRole("alertdialog", {
      name: m.tests_opened({ title: "Старий тест" }),
    }),
  ).toBeVisible();
});

test("dropping another file says which files open", async ({
  klats,
  browserName,
}) => {
  test.skip(browserName === "firefox", SCRIPTED_FILES);
  const page = await klats.teacher("/");
  await drop(page, "notes.txt", Buffer.from("x"));
  await expect(
    page.getByText(m.tests_drop_wrong(), { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: m.tests_empty_title() }),
  ).toBeVisible();
});

test("the drop overlay shows while dragging", async ({ klats }) => {
  const page = await klats.teacher("/");
  const overlay = page.getByText(m.tests_drop_here(), { exact: true });
  const bytes = Buffer.from("x");
  await drag(page, ["dragenter", "dragover"], "notes.txt", bytes);
  await expect(overlay).toBeVisible();
  await drag(page, ["dragleave"], "notes.txt", bytes);
  await expect(overlay).toBeHidden();

  await drag(page, ["dragenter", "dragover"], "notes.txt", bytes);
  await expect(overlay).toBeVisible();
  await drag(page, ["drop"], "notes.txt", bytes);
  await expect(overlay).toBeHidden();
});

test("a file dropped off the library does not replace the app", async ({
  klats,
}) => {
  const id = await klats.create(TEST, undefined, "Дроби");
  const bytes = Buffer.from("x");
  const classes = await klats.teacher("/classes");
  await expect(
    classes.getByRole("heading", { name: m.classes_empty_title() }),
  ).toBeVisible();
  expect(await drag(classes, ["dragover", "drop"], "notes.txt", bytes)).toEqual(
    [false, false],
  );

  const builder = await klats.teacher(`/tests/${id}`);
  await expect(
    builder.getByRole("listbox", { name: m.builder_questions() }),
  ).toBeVisible();
  expect(await drag(builder, ["dragover", "drop"], "notes.txt", bytes)).toEqual(
    [false, false],
  );
});

test("the library takes a file drag and leaves a text drag alone", async ({
  klats,
}) => {
  const page = await klats.teacher("/");
  const overlay = page.getByText(m.tests_drop_here(), { exact: true });
  const bytes = Buffer.from("x");
  await expect(
    page.getByRole("heading", { name: m.tests_empty_title() }),
  ).toBeVisible();
  expect(await drag(page, ["dragover", "drop"], "notes.txt", bytes)).toEqual([
    false,
    false,
  ]);

  expect(await drag(page, ["dragenter", "dragover"], "Дроби")).toEqual([
    true,
    true,
  ]);
  // A text drag counted as entering would keep the overlay up after the
  // file drag below leaves.
  await drag(page, ["dragenter"], "notes.txt", bytes);
  await expect(overlay).toBeVisible();
  await drag(page, ["dragleave"], "notes.txt", bytes);
  await expect(overlay).toBeHidden();
  expect(await drag(page, ["drop"], "Дроби")).toEqual([true]);
});
