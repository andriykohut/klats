import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, type Klats, m, TEST, test } from "./fixtures";

/** The library's rows; the toasts are list items too. */
const rows = (page: Page) => page.locator(".t-tests").getByRole("listitem");

/**
 * Writes to `path` a .klats file of a test titled «Дроби» that is no longer in
 * the library, so opening it adds a test, and returns `path`.
 */
async function newFile(klats: Klats, path: string): Promise<string> {
  const id = await klats.create(TEST, undefined, "Дроби");
  writeFileSync(path, await klats.exportFile(id));
  await klats.remove(id);
  return path;
}

test("a file the system opens lands in the library", async ({
  klats,
}, testInfo) => {
  const file = await newFile(klats, testInfo.outputPath("Дроби 7-Б.klats"));
  await klats.create(TEST, undefined, "Вірші");
  const page = await klats.teacher("/classes");
  // The server announces the file on the event stream, so it must be open.
  const stream = page.waitForResponse("**/api/events");
  await page.reload();
  await stream;

  await klats.opened(file);
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByText(m.tests_opened({ title: "Дроби" }), { exact: true }),
  ).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first().getByRole("link")).toHaveText("Дроби");

  await klats.opened(testInfo.outputPath("gone.klats"));
  await expect(
    page.getByText(m.tests_open_missing(), { exact: true }),
  ).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
});

test("a file opened before the window loads lands in the library", async ({
  klats,
}, testInfo) => {
  const file = await newFile(klats, testInfo.outputPath("Дроби.klats"));
  const page = await klats.teacher("/classes");
  const library = new URL("/", page.url()).href;
  // Off the app, the page stands for the window before it opens.
  await page.goto("about:blank");

  await klats.opened(file);
  await page.goto(library);
  await expect(
    page.getByText(m.tests_opened({ title: "Дроби" }), { exact: true }),
  ).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
});

test("a file opened during a lesson waits while its results show", async ({
  klats,
}, testInfo) => {
  const file = await newFile(klats, testInfo.outputPath("Дроби.klats"));
  await klats.start();
  const page = await klats.teacher();
  const stream = page.waitForResponse("**/api/events");
  await page.reload();
  await stream;

  await klats.opened(file);
  await page.getByRole("button", { name: m.live_end() }).click();
  await page
    .getByRole("button", { name: m.end_confirm(), exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: m.results_export() }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/assignments\//);

  await page.getByRole("link", { name: m.nav_tests(), exact: true }).click();
  await expect(
    page.getByText(m.tests_opened({ title: "Дроби" }), { exact: true }),
  ).toBeVisible();
});

test("a file opened twice finds its test, and can still be copied", async ({
  klats,
}, testInfo) => {
  const file = await newFile(klats, testInfo.outputPath("Дроби.klats"));
  const page = await klats.teacher("/");
  const stream = page.waitForResponse("**/api/events");
  await page.reload();
  await stream;
  await klats.opened(file);
  await expect(rows(page)).toHaveCount(1);

  await klats.opened(file);
  const existing = page.getByText(m.tests_open_existing({ title: "Дроби" }), {
    exact: true,
  });
  await expect(existing).toBeVisible();
  await expect(rows(page)).toHaveCount(1);

  await page.getByRole("button", { name: m.tests_open_copy() }).click();
  await expect(existing).toBeHidden();
  await expect(rows(page)).toHaveCount(2);
});
