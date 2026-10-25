import { expect, joinAs, m, questionOf, test, until } from "./fixtures";

const para = (...content: object[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});
const text = (t: string) => ({ type: "text", text: t });
const gap = (id: string) => ({ type: "gap", attrs: { id } });

test("short, number and gaps answers are typed, saved and graded", async ({
  klats,
}) => {
  const capital = questionOf("short", "q1", "Столиця України?", {
    accepted: ["Київ"],
  });
  const gravity = questionOf(
    "number",
    "q2",
    "Прискорення вільного падіння, м/с²?",
    {
      number: { mode: "tolerance", value: 9.8, tolerance: 0.1, min: 0, max: 0 },
    },
  );
  const gaps = questionOf("gaps", "q3", "", {
    points: 3,
    body: para(
      text("Столиця — "),
      gap("g1"),
      text(", незалежність проголошено у "),
      gap("g2"),
      text(" році, а "),
      { type: "math", attrs: { latex: "2+2" } },
      text(" = "),
      gap("g3"),
      text("."),
    ),
    gaps: [
      { id: "g1", accepted: ["Київ"] },
      { id: "g2", accepted: ["1991"] },
      {
        id: "g3",
        choices: [
          { id: "c1", text: "три", correct: false },
          { id: "c2", text: "чотири", correct: true },
          { id: "c3", text: "п’ять", correct: false },
        ],
      },
    ],
  });
  const port = questionOf("short", "q4", "Головний порт півдня?", {
    accepted: ["Одеса"],
  });
  const { code, assignmentId } = await klats.start([
    capital,
    gravity,
    gaps,
    port,
  ]);
  const page = await klats.computer();
  await joinAs(page, klats, code, "Бондаренко Олена");
  const next = page.getByRole("button", { name: m.test_next() });

  // Enter moves on from a short answer once it is not blank.
  const field = page.getByRole("textbox", { name: capital.title });
  await field.click();
  await page.keyboard.press("Enter");
  await expect(field).toBeVisible();
  await field.fill("київ ");
  await page.keyboard.press("Enter");

  // Digits typed into a number field never pick an option or move the sheet.
  const number = page.getByRole("textbox", { name: gravity.title });
  await expect(number).toHaveAttribute("inputmode", "decimal");
  await expect(number).toHaveAttribute("placeholder", m.number_placeholder());
  await number.pressSequentially("9,85");
  await expect(number).toHaveValue("9,85");
  await page.keyboard.press("Enter");

  const gapField = (n: number) =>
    page.getByRole("textbox", { name: m.gap_label({ number: n }) });
  const list = page.getByRole("button", { name: m.gap_label({ number: 3 }) });
  await expect(gapField(1)).toBeVisible();
  // A gap field starts narrow and grows with what is typed.
  const before = (await gapField(2).boundingBox())?.width ?? 0;
  await gapField(2).fill("12345678901234567890");
  expect((await gapField(2).boundingBox())?.width ?? 0).toBeGreaterThan(
    before + 40,
  );
  await gapField(2).fill("1990");
  await gapField(1).fill("Київ");
  // Two of three gaps are filled, so the question is still open.
  await expect(next).toBeDisabled();
  await list.click();
  await page.getByRole("option", { name: "чотири" }).click();
  await expect(list).toContainText("чотири");
  await expect(next).toBeEnabled();
  await gapField(2).press("Enter");

  // The request is held back, and the page reloads before it leaves.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/answers", async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  const odesa = page.getByRole("textbox", { name: port.title });
  await odesa.fill("Одеса");
  await page.reload();
  await expect(odesa).toHaveValue("Одеса");
  release();
  await page.getByRole("button", { name: m.test_finish() }).click();
  await page.getByRole("button", { name: m.review_finish() }).click();

  // Gaps: Київ and чотири are right, the typed 1990 is wrong and costs
  // nothing, so 3 × 2 / 3.
  await until(klats, (live) => live.rows[0]?.status === "finished");
  const { rows } = await klats.results(assignmentId);
  expect(rows[0].points).toEqual([1, 1, 2, 1]);
});
