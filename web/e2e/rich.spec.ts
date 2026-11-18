import { contrast } from "@klats/shared/palettes.ts";
import type { Locator } from "@playwright/test";
import {
  answers,
  doc,
  expect,
  joinAs,
  m,
  pick,
  questionOf,
  test,
} from "./fixtures";

/** A one-paragraph document that is all inline code. */
const code = (text: string) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text, marks: [{ type: "code" }] }],
    },
  ],
});

/** The WCAG contrast between an element's text and its own background. */
async function legibility(el: Locator): Promise<number> {
  const colours = await el.evaluate((e) => {
    const s = getComputedStyle(e);
    return [s.color, s.backgroundColor];
  });
  const [fg, bg] = colours.map(
    (rgb) =>
      `#${(rgb.match(/\d+/g) ?? [])
        .slice(0, 3)
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("")}`,
  );
  return contrast(fg, bg);
}

test("a table and a code block written in the builder reach the student's sheet", async ({
  klats,
}) => {
  const teacher = await klats.teacher("/");
  await teacher.getByRole("button", { name: m.tests_new() }).click();
  await teacher.getByRole("button", { name: m.builder_add_question() }).click();

  await teacher
    .getByRole("button", { name: m.type_single_desc(), exact: false })
    .click();

  const text = teacher.getByRole("textbox", {
    name: m.builder_question_text(),
  });
  await text.click();
  await teacher.getByRole("button", { name: m.rich_table() }).click();
  await text.locator("th").first().click();
  await teacher.keyboard.type("Рік");
  await text.locator("p").last().click();
  await teacher.getByRole("button", { name: m.rich_code_block() }).click();
  await teacher.keyboard.type("print(1)");
  await expect(text.locator("pre code")).toHaveText("print(1)");

  for (const letter of ["А", "Б"]) {
    await teacher
      .getByRole("textbox", { name: m.builder_answer_placeholder({ letter }) })
      .fill(letter);
  }
  await teacher
    .getByRole("button", { name: m.builder_answer_correct({ letter: "А" }) })
    .click();

  await teacher.getByRole("button", { name: m.builder_start() }).click();
  const dialog = teacher.getByRole("dialog");
  await dialog.getByText(m.start_no_list(), { exact: true }).click();
  await dialog.getByRole("button", { name: m.start_go(), exact: true }).click();
  const code = await teacher
    .locator(".l-code strong")
    .textContent({ timeout: 10_000 });

  const student = await klats.computer();
  await student.goto(`${klats.student}/?code=${code}`);
  await student.getByLabel(m.typed_surname()).fill("Коваль");
  await student.getByLabel(m.typed_first_name()).fill("Олена");
  await student.getByLabel(m.typed_class()).fill("7-Б");
  await student.getByRole("button", { name: m.pick_start() }).click();

  await expect(student.locator("table th").first()).toHaveText("Рік");
  await expect(student.locator("pre code")).toHaveText("print(1)");
  expect(
    await student.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1024);
});

test("inline code stays readable on a selected answer and on a picked card", async ({
  klats,
}) => {
  const choice = questionOf("single", "q1", "Яка функція рахує за умовою?", {
    options: [
      { id: "o1", content: code("=SUM(A2:A40)"), correct: false },
      { id: "o2", content: code("=COUNTIF(A2:A40;5)"), correct: true },
    ],
  });
  const match = questionOf("match", "q2", "З’єднайте мову з командою", {
    targets: [
      { id: "t1", content: code("print()"), x: 0, y: 0 },
      { id: "t2", content: code("echo"), x: 0, y: 0 },
    ],
    options: [
      { id: "l1", content: doc("Python"), correct: false, target: "t1" },
      { id: "l2", content: doc("Bash"), correct: false, target: "t2" },
    ],
  });
  const { code: join } = await klats.start([choice, match]);
  const page = await klats.computer();
  await joinAs(page, klats, join, "Бондаренко Олена");

  await pick(page, choice, "=COUNTIF(A2:A40;5)");
  const selected = answers(page, choice).locator("code", {
    hasText: "=COUNTIF(A2:A40;5)",
  });
  await expect.poll(() => legibility(selected)).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: m.test_next() }).click();
  const tray = page.getByRole("grid", { name: m.cards_tray() });
  await tray.getByRole("row", { name: "print()" }).click();
  const picked = page.locator("[data-picked]");
  await expect(picked).toHaveAttribute("aria-label", "print()");
  await expect
    .poll(() => legibility(picked.locator("code")))
    .toBeGreaterThanOrEqual(4.5);
});

test("a formula in an answer option stays on one line", async ({ klats }) => {
  const formulas = [
    '=COUNTIFS(A2:A40;"Samsung";B2:B40;"<15000")',
    '=COUNTIFS(A2:A40;"Samsung";B2:B40;">15000")',
    '=COUNTIF(A2:A40;"Samsung")',
    '=SUMIFS(B2:B40;A2:A40;"Samsung")',
  ];
  const choice = questionOf(
    "single",
    "q1",
    "Скільки телефонів Samsung дешевші за 15000 грн?",
    {
      options: formulas.map((f, i) => ({
        id: `o${i}`,
        content: code(f),
        correct: i === 0,
      })),
    },
  );
  const { code: join } = await klats.start([choice]);
  const page = await klats.computer();
  await joinAs(page, klats, join, "Бондаренко Олена");

  for (const f of formulas) {
    const formula = answers(page, choice).getByText(f, { exact: true });
    await expect
      .poll(() => formula.evaluate((e) => e.getClientRects().length))
      .toBe(1);
  }
});
