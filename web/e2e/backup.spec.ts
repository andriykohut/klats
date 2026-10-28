import type { Page } from "@playwright/test";
import { CLASS, expect, joinAs, m, pick, TEST, test, until } from "./fixtures";

/** The library's link to the test titled exactly `title`. */
const link = (page: Page, title: string) =>
  page.getByRole("link", { name: title, exact: true });

test("restore brings back the backed-up data", async ({ klats }, testInfo) => {
  const { code } = await klats.start(TEST);
  const student = await klats.computer();
  const [q1, q2, q3] = TEST;
  await joinAs(student, klats, code, CLASS[0]);
  await pick(student, q1, "8");
  await student.getByRole("button", { name: m.test_next() }).click();
  await pick(student, q2, "Клавіатура", "Мишка");
  await student.getByRole("button", { name: m.test_next() }).click();
  await pick(student, q3, "Firefox");
  await student.getByRole("button", { name: m.test_finish() }).click();
  await student.getByRole("button", { name: m.review_finish() }).click();
  await until(klats, (l) => l.rows.every((r) => r.status === "finished"));
  const fractions = await klats.create(TEST, undefined, "Дроби");

  const page = await klats.teacher("/live");
  await page.getByRole("button", { name: m.live_end() }).click();
  await page
    .getByRole("button", { name: m.end_confirm(), exact: true })
    .click();
  await expect(page).toHaveURL(/\/assignments\//);

  await page.goto(new URL("/settings", page.url()).href);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: m.backup_export() }).click();
  const file = testInfo.outputPath((await download).suggestedFilename());
  await (await download).saveAs(file);

  // Deleting «Дроби» and making «Вірші» leaves data the backup does not hold.
  await page.evaluate(
    (id) => fetch(`/api/tests/${id}`, { method: "DELETE" }),
    fractions,
  );
  await klats.create(TEST, undefined, "Вірші");
  await page.goto(new URL("/", page.url()).href);
  await expect(link(page, "Вірші")).toBeVisible();
  await expect(link(page, "Дроби")).toBeHidden();

  await page.goto(new URL("/settings", page.url()).href);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: m.backup_restore() }).click();
  await (await chooser).setFiles(file);
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(m.backup_restore_text());
  await dialog
    .getByRole("button", { name: m.backup_restore_confirm() })
    .click();
  await expect(
    page.getByText(m.backup_restored(), { exact: true }),
  ).toBeVisible();

  await page.goto(new URL("/", page.url()).href);
  await expect(link(page, "Дроби")).toBeVisible();
  await expect(link(page, "Вірші")).toBeHidden();
  await page.goto(new URL("/assignments", page.url()).href);
  await expect(page.locator(".r-item")).toHaveCount(1);
  await expect(page.locator(".r-avg b")).toHaveText("12");
});

test("restore is refused during a test", async ({ klats }) => {
  await klats.start(TEST);
  const page = await klats.teacher("/settings");
  await expect(
    page.getByRole("button", { name: m.backup_restore() }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: m.backup_export() }),
  ).toBeDisabled();
  await expect(
    page.getByText(m.backup_running(), { exact: true }),
  ).toBeVisible();
});
