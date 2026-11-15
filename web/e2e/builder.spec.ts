import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, m, test } from "./fixtures";

// The builder's own sample: a single-choice question marked at the letter
// and a multiple-choice one marked at both ends, with both line endings.
const SAMPLE =
  "1. Скільки біт в одному байті?\r\nа) 2\r\nб) 4\r\n*в) 8\r\n\r\n2. Пристрої введення?\n*а) клавіатура\nб) монітор\nв) мишка*\n";

test("questions pasted as text join the test, and one with no correct answer blocks the start", async ({
  klats,
}) => {
  const page = await klats.teacher("/");
  await page.getByRole("button", { name: m.tests_new() }).click();

  await page.getByRole("button", { name: m.builder_paste() }).click();
  await page.getByRole("textbox", { name: m.paste_label() }).fill(SAMPLE);
  await page.getByRole("button", { name: m.paste_add({ count: 2 }) }).click();
  await expect(
    page
      .getByRole("listbox", { name: m.builder_questions() })
      .getByRole("option"),
  ).toHaveCount(2);

  await page.getByRole("button", { name: m.builder_preview_show() }).click();
  await expect(
    page
      .getByRole("complementary", { name: m.builder_preview() })
      .getByText("Скільки біт в одному байті?"),
  ).toBeVisible();

  const dialog = page.getByRole("dialog");
  const go = dialog.getByRole("button", { name: m.start_go(), exact: true });
  await page.getByRole("button", { name: m.builder_start() }).click();
  await dialog.getByText(m.start_no_list(), { exact: true }).click();
  await expect(go).toBeEnabled();
  await dialog.getByRole("button", { name: m.action_cancel() }).click();

  const correct = page.getByRole("button", {
    name: m.builder_answer_correct({ letter: "В" }),
  });
  await expect(correct).toHaveAttribute("aria-pressed", "true");
  await correct.click();
  await expect(correct).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: m.builder_start() }).click();
  await dialog.getByText(m.start_no_list(), { exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: m.problem_no_correct({ number: 1 }) }),
  ).toBeVisible();
  await expect(go).toBeDisabled();
});

test("a chatbot reply in the prompt's format adds one question of each type, and the test starts", async ({
  klats,
}) => {
  const prompt = readFileSync(
    join(
      import.meta.dirname,
      "../teacher/src/pages/builder/paste-prompt.uk.txt",
    ),
    "utf8",
  );
  const reply = /```\n([\s\S]*?)\n```/.exec(prompt)?.[1] ?? "";
  const page = await klats.teacher("/");
  await page.getByRole("button", { name: m.tests_new() }).click();

  await page.getByRole("button", { name: m.builder_ai() }).click();
  await page.getByRole("textbox", { name: m.ai_reply_label() }).fill(reply);
  await page.getByRole("button", { name: m.paste_add({ count: 15 }) }).click();
  await expect(
    page
      .getByRole("listbox", { name: m.builder_questions() })
      .getByRole("option"),
  ).toHaveCount(15);

  await page.getByRole("button", { name: m.builder_start() }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(m.start_no_list(), { exact: true }).click();
  await dialog.getByRole("button", { name: m.start_go(), exact: true }).click();
  await expect(page.locator(".l-code strong")).toBeVisible({ timeout: 10_000 });
});
