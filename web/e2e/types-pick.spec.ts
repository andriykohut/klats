import type { Page } from "@playwright/test";
import { doc, expect, joinAs, m, questionOf, test, until } from "./fixtures";

/** Presses a Cyrillic key, which Playwright's keyboard has no name for. */
const pressLetter = (page: Page, key: string) =>
  page.evaluate(
    (key) =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      ),
    key,
  );

test("true/false and grid answers are chosen, saved and graded", async ({
  klats,
}) => {
  const statement = (id: string, text: string, correct: boolean) => ({
    id,
    content: doc(text),
    correct,
  });
  const tf = questionOf("truefalse", "q1", "Які твердження правильні?", {
    points: 2,
    options: [
      statement("s1", "Земля кругла", true),
      statement("s2", "Сонце холодне", false),
      statement("s3", "Вода суха", true),
      statement("s4", "Місяць квадратний", false),
    ],
  });
  const row = (id: string, text: string, target: string) => ({
    id,
    content: doc(text),
    correct: false,
    target,
  });
  const grid = questionOf("grid", "q2", "Хто це: ссавець чи птах?", {
    points: 3,
    targets: [
      { id: "c1", content: doc("Ссавці"), x: 0, y: 0 },
      { id: "c2", content: doc("Птахи"), x: 0, y: 0 },
    ],
    options: [
      row("r1", "Кіт", "c1"),
      row("r2", "Горобець", "c2"),
      row("r3", "Кит", "c1"),
    ],
  });
  const { code, assignmentId } = await klats.start([tf, grid]);
  const page = await klats.computer();
  await joinAs(page, klats, code, "Бондаренко Олена");

  const group = (name: string) =>
    page.getByRole("radiogroup", { name, exact: true });
  // Two of four are right, one is wrong and one stays open: 2 × (2 − 1) / 4.
  await group("Земля кругла")
    .getByText(m.answer_true(), { exact: true })
    .click();
  await group("Сонце холодне")
    .getByText(m.answer_false(), { exact: true })
    .click();
  await group("Вода суха").getByText(m.answer_false(), { exact: true }).click();
  await expect(
    group("Вода суха").getByRole("radio", { name: m.answer_false() }),
  ).toBeChecked();
  // The fourth statement is the one the digit and the letter would pick in a
  // single-choice question; here they do nothing, and no key hint shows.
  await page.keyboard.press("4");
  await pressLetter(page, "Г");
  await expect(
    group("Місяць квадратний").getByRole("radio", { checked: true }),
  ).toHaveCount(0);
  await expect(page.locator(".k-keys")).toHaveCount(0);
  // A statement is still open, so the question is skipped, not finished.
  await expect(
    page.getByRole("button", { name: m.test_next() }),
  ).toBeDisabled();
  await page.getByRole("button", { name: m.test_skip() }).click();

  // Every row is answered by mouse except the last, which takes keys alone.
  const column = (name: string) =>
    page.getByRole("columnheader", { name, exact: true });
  await expect(column("Ссавці")).toBeVisible();
  await page.keyboard.press("1");
  await pressLetter(page, "А");
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  // A radio's own input is a hidden pixel, so the mouse takes its round mark.
  await group("Кіт").locator(".k-dot").first().click();
  await group("Горобець").locator(".k-dot").first().click();
  const whale = group("Кит").getByRole("radio", { name: "Ссавці" });
  for (let i = 0; i < 8; i++) {
    if (await whale.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(whale).toBeFocused();
  await page.keyboard.press("Space");
  await expect(whale).toBeChecked();
  const birds = group("Кит").getByRole("radio", { name: "Птахи" });
  await page.keyboard.press("ArrowRight");
  await expect(birds).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(whale).toBeChecked();

  await page.getByRole("button", { name: m.test_finish() }).click();
  await page.getByRole("button", { name: m.review_finish() }).click();
  // Three rows, two right and one wrong: 3 × (2 − 1) / 3.
  await until(klats, (live) => live.rows[0]?.status === "finished");
  const { rows } = await klats.results(assignmentId);
  expect(rows[0].points).toEqual([0.5, 1]);
});
