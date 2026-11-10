import { randomBytes } from "node:crypto";
import { truncateSync, writeFileSync } from "node:fs";
import type { Download, Page } from "@playwright/test";
import { expect, type Klats, m, openFile, TEST, test } from "./fixtures";

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Makes a test titled `title` of TEST whose first question shows a picture,
 * and returns its id.
 */
async function pictureTest(klats: Klats, title: string): Promise<string> {
  const src = await klats.upload(PNG);
  const [q1, ...rest] = TEST;
  const text = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: q1.title }] },
      { type: "image", attrs: { src, w: 64, h: 40 } },
    ],
  };
  return klats.create([{ ...q1, text }, ...rest], undefined, title);
}

/** The library's rows; the toasts are list items too. */
const rows = (page: Page) => page.locator(".t-tests").getByRole("listitem");

/** The library's row of the test titled exactly `title`. */
const row = (page: Page, title: string) =>
  rows(page).filter({
    has: page.getByRole("link", { name: title, exact: true }),
  });

/** Exports the test titled `title` and returns the download. */
async function exportTest(page: Page, title: string): Promise<Download> {
  const download = page.waitForEvent("download");
  await row(page, title)
    .getByRole("button", { name: m.tests_export() })
    .click();
  return download;
}

/**
 * Checks that the builder lists every question of TEST and that the preview
 * draws the first one's picture.
 */
async function expectPictureTest(page: Page) {
  await expect(
    page
      .getByRole("listbox", { name: m.builder_questions() })
      .getByRole("option"),
  ).toHaveCount(TEST.length);
  await page.getByRole("button", { name: m.builder_preview_show() }).click();
  const picture = page
    .getByRole("complementary", { name: m.builder_preview() })
    .locator("img");
  await expect
    .poll(() => picture.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBe(1);
}

test("search filters by title", async ({ klats }) => {
  await klats.create(TEST, undefined, "Дроби 7/8");
  await klats.create(TEST, undefined, "Вірші");
  await klats.create(TEST, undefined, "Комп’ютерні мережі");
  const page = await klats.teacher("/");
  await expect(rows(page)).toHaveCount(3);
  const none = page.getByText(m.tests_none_found(), { exact: true });
  await expect(none).toBeHidden();

  const search = page.getByRole("searchbox", { name: m.tests_search() });
  await search.fill("дроби");
  await expect(row(page, "Дроби 7/8")).toBeVisible();
  await expect(row(page, "Вірші")).toBeHidden();
  await expect(rows(page)).toHaveCount(1);

  // Typed with a plain apostrophe, the title holds ’.
  await search.fill("комп'ютер");
  await expect(row(page, "Комп’ютерні мережі")).toBeVisible();
  await expect(rows(page)).toHaveCount(1);

  await search.fill("хімія");
  await expect(rows(page)).toHaveCount(0);
  await expect(none).toBeVisible();

  await search.fill("");
  await expect(rows(page)).toHaveCount(3);
  await expect(none).toBeHidden();
});

test("duplicate opens with the same questions", async ({ klats }) => {
  await pictureTest(klats, "Дроби");
  const page = await klats.teacher("/");
  await row(page, "Дроби")
    .getByRole("button", { name: m.tests_duplicate() })
    .click();
  const copy = m.tests_copy_title({ title: "Дроби" });
  await expect(row(page, copy)).toBeVisible();

  await page.reload();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first().getByRole("link")).toHaveText(copy);
  await row(page, copy).getByRole("link").click();
  await expectPictureTest(page);
});

test("an exported file opens as its test, or as a copy", async ({
  klats,
}, testInfo) => {
  const original = await pictureTest(klats, "Дроби");
  const page = await klats.teacher("/");
  const download = await exportTest(page, "Дроби");
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);

  await openFile(page, file);
  await expect(
    page.getByText(m.tests_open_existing({ title: "Дроби" }), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole("button", { name: m.tests_open_copy() }).click();
  await expect(
    page.getByText(m.tests_opened({ title: "Дроби" }), { exact: true }),
  ).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await expect(page).toHaveURL(/\/$/);

  await page.reload();
  await expect(rows(page)).toHaveCount(2);
  // The opened test is the newest, so it is listed first.
  await rows(page).first().getByRole("link").click();
  await expect(page).toHaveURL(/\/tests\/[^/]+$/);
  expect(page.url()).not.toContain(original);
  await expectPictureTest(page);
});

test("a damaged file is refused", async ({ klats }, testInfo) => {
  await klats.create(TEST, undefined, "Дроби");
  const page = await klats.teacher("/");
  await expect(rows(page)).toHaveCount(1);
  const file = testInfo.outputPath("x.klats");
  writeFileSync(file, randomBytes(4096));

  await openFile(page, file);
  await expect(
    page.getByText(m.tests_file_damaged(), { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(m.tests_count({ count: 1 }))).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
});

test("a file over 256 MB is refused", async ({ klats }, testInfo) => {
  await klats.create(TEST, undefined, "Дроби");
  const page = await klats.teacher("/");
  await expect(rows(page)).toHaveCount(1);
  // Sparse, so the run writes nothing near 256 MiB to disk.
  const file = testInfo.outputPath("big.klats");
  writeFileSync(file, "");
  truncateSync(file, 256 * 2 ** 20 + 1);

  await openFile(page, file);
  await expect(
    page.getByText(m.tests_file_too_large(), { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: m.tests_open() }),
  ).toBeEnabled();
  await page.reload();
  await expect(page.getByText(m.tests_count({ count: 1 }))).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
});

test("an unsafe title exports to a safe name", async ({ klats }, testInfo) => {
  const title = "7/8: Дроби?";
  await klats.create(TEST, undefined, title);
  const page = await klats.teacher("/");
  const download = await exportTest(page, title);
  expect(download.suggestedFilename()).toBe("7_8_ Дроби_.klats");
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);

  await openFile(page, file);
  await page.getByRole("button", { name: m.tests_open_copy() }).click();
  await expect(
    page.getByText(m.tests_opened({ title }), { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first().getByRole("link")).toHaveText(title);
});
