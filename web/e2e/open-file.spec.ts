import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, m, TEST, test } from "./fixtures";

/** The library's rows; the toasts are list items too. */
const rows = (page: Page) => page.locator(".t-tests").getByRole("listitem");

test("a file the system opens lands in the library", async ({
  klats,
}, testInfo) => {
  const file = testInfo.outputPath("Дроби 7-Б.klats");
  const id = await klats.create(TEST, undefined, "Дроби");
  writeFileSync(file, await klats.exportFile(id));
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
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first().getByRole("link")).toHaveText("Дроби");

  await klats.opened(testInfo.outputPath("gone.klats"));
  await expect(
    page.getByText(m.tests_open_missing(), { exact: true }),
  ).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
});
