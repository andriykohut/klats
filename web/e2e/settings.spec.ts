import type { Settings } from "@klats/shared/generated/testfmt.ts";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Locator, Page } from "@playwright/test";
import { expect, m, question, test } from "./fixtures";

const FIVE = Array.from({ length: 5 }, (_, i) =>
  question(`q${i + 1}`, `Питання ${i + 1}`, ["*так", "ні"]),
);

/** The test's settings as last saved, read through the page's own session. */
async function saved(page: Page, id: string): Promise<Settings> {
  const doc: TestDoc = await page.evaluate(
    async (id) => (await fetch(`/api/tests/${id}`)).json(),
    id,
  );
  return doc.test.settings;
}

/** Opens the settings dialog. */
async function open(page: Page) {
  await page.getByRole("button", { name: m.nav_settings() }).click();
  const dialog = page.getByRole("dialog", { name: m.settings_title() });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Types `value` into a number field and commits it with Enter. */
async function type(field: Locator, value: number) {
  await field.fill(String(value));
  await field.press("Enter");
}

/** The accessible name of grade `g`'s threshold field. */
const grade = (g: number) => `${m.settings_grade()} ${g}, ${m.settings_from()}`;

test("settings survive a reload", async ({ klats }) => {
  const id = await klats.create(FIVE);
  const page = await klats.teacher(`/tests/${id}`);
  let dialog = await open(page);

  await dialog.getByText(m.settings_time_student(), { exact: true }).click();
  await type(dialog.getByRole("textbox", { name: m.settings_minutes() }), 25);
  await dialog.getByText(m.settings_shuffle(), { exact: true }).click();
  await dialog.getByText(m.settings_subset(), { exact: true }).click();
  await type(dialog.getByRole("textbox", { name: m.settings_subset() }), 3);
  await dialog.getByText(m.scale_percent(), { exact: true }).click();
  await dialog.getByText(m.scale_points12(), { exact: true }).click();
  await type(dialog.getByRole("textbox", { name: grade(12) }), 95);
  await dialog.getByText(m.settings_reveal_mistakes(), { exact: true }).click();
  await dialog.getByText(m.settings_nav_forward(), { exact: true }).click();

  // Every value is on the server before the reload, not just the first few.
  const all = {
    timeLimit: { mode: "student", minutes: 25 },
    shuffleQuestions: true,
    draw: [{ tag: "", count: 3 }],
    scale: { kind: "points12" },
    reveal: "mistakes",
    navigation: "forward",
  };
  await expect
    .poll(async () => {
      const s = await saved(page, id);
      return { ...s, scale: { ...s.scale, at12: s.scale.thresholds[10] } };
    })
    .toMatchObject({ ...all, scale: { kind: "points12", at12: 95 } });
  await page.reload();
  expect(await saved(page, id)).toMatchObject(all);

  dialog = await open(page);
  await expect(
    dialog.getByRole("radio", { name: m.settings_time_student() }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("textbox", { name: m.settings_minutes() }),
  ).toHaveValue("25");
  await expect(
    dialog.getByRole("switch", { name: m.settings_shuffle() }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("switch", { name: m.settings_subset() }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("textbox", { name: m.settings_subset() }),
  ).toHaveValue("3");
  await expect(
    dialog.getByRole("radio", { name: m.scale_points12() }),
  ).toBeChecked();
  await expect(dialog.getByRole("textbox", { name: grade(12) })).toHaveValue(
    "95",
  );
  await expect(
    dialog.getByRole("radio", {
      name: m.settings_reveal_mistakes(),
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("radio", { name: m.settings_nav_forward() }),
  ).toBeChecked();
});

test("a threshold stays between its neighbours", async ({ klats }) => {
  const id = await klats.create(FIVE);
  const page = await klats.teacher(`/tests/${id}`);
  const dialog = await open(page);
  const five = dialog.getByRole("textbox", { name: grade(5) });

  await type(five, 10);
  await expect(five).toHaveValue("34");
  await type(five, 60);
  await expect(five).toHaveValue("49");
  await expect
    .poll(async () => (await saved(page, id)).scale.thresholds[3])
    .toBe(49);
});
