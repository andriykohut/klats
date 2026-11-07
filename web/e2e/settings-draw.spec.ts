import type { Settings } from "@klats/shared/generated/testfmt.ts";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Locator, Page } from "@playwright/test";
import { expect, m, question, test } from "./fixtures";

const FIVE = Array.from({ length: 5 }, (_, i) =>
  question(`q${i + 1}`, `Питання ${i + 1}`, ["*так", "ні"]),
);

/** {@link FIVE}, the first two tagged «A» and the rest «B». */
const AB = FIVE.map((q, i) => ({ ...q, tags: [i < 2 ? "A" : "B"] }));

/** The test's settings as last saved, read through the page's own session. */
async function saved(page: Page, id: string): Promise<Settings> {
  const doc: TestDoc = await page.evaluate(
    async (id) => (await fetch(`/api/tests/${id}`)).json(),
    id,
  );
  return doc.test.settings;
}

/** Opens the settings dialog and turns on the random draw. */
async function openDraw(page: Page) {
  await page.getByRole("button", { name: m.nav_settings() }).click();
  const dialog = page.getByRole("dialog", { name: m.settings_title() });
  await dialog.getByText(m.settings_subset(), { exact: true }).click();
  return dialog;
}

/** Draw line `i`: its count, and the button of its source, named by its value and then its label «з». */
function line(dialog: Locator, i: number) {
  const row = dialog.locator(".s-line").nth(i);
  return {
    count: row.getByRole("textbox"),
    source: row.getByRole("button", { name: new RegExp(`${m.draw_from()}$`) }),
  };
}

/** Sets draw line `i` to `count` questions from the tag `tag`. */
async function setLine(dialog: Locator, i: number, tag: string, count: number) {
  const { count: field, source } = line(dialog, i);
  await source.click();
  await dialog
    .page()
    .getByRole("option", { name: `# ${tag}` })
    .click();
  await field.fill(String(count));
  await field.press("Enter");
}

test("a test with tags draws per tag", async ({ klats }) => {
  const id = await klats.create(AB);
  const page = await klats.teacher(`/tests/${id}`);
  const dialog = await openDraw(page);
  await expect(dialog.locator(".s-line")).toHaveCount(1);
  await expect(line(dialog, 0).source).toContainText(m.draw_all());

  await setLine(dialog, 0, "A", 3);
  await expect(
    dialog.getByText(m.draw_short({ tag: "A", count: 2 }), { exact: true }),
  ).toBeVisible();

  await dialog.getByRole("button", { name: m.draw_add() }).click();
  await setLine(dialog, 1, "B", 1);
  await expect(
    dialog.getByText(m.draw_total({ count: 3, total: 5 }), { exact: true }),
  ).toBeVisible();

  await dialog.getByRole("button", { name: m.action_close() }).click();
  await expect
    .poll(async () => (await saved(page, id)).draw)
    .toEqual([
      { tag: "A", count: 3 },
      { tag: "B", count: 1 },
    ]);
});

test("a test without tags keeps the plain count", async ({ klats }) => {
  const id = await klats.create(FIVE);
  const page = await klats.teacher(`/tests/${id}`);
  const dialog = await openDraw(page);

  await expect(
    dialog.getByRole("textbox", { name: m.settings_subset() }),
  ).toHaveValue("4");
  await expect(
    dialog.getByText(m.settings_subset_count({ count: "", total: 5 }).trim()),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: m.draw_add() })).toHaveCount(
    0,
  );
});
