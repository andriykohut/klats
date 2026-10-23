import {
  answers,
  CLASS,
  expect,
  joinAs,
  m,
  pick,
  question,
  test,
} from "./fixtures";

const PASSAGE =
  "Учениця зберегла реферат на флешку вдома, а в школі комп’ютер не відкрив файл і повідомив, що такий формат невідомий. Вчитель попросив пояснити, що могло статися і як цьому запобігти наступного разу. ";

const OPTIONS = [
  "Файл пошкодився під час копіювання на флешку",
  "На шкільному комп’ютері немає програми для цього формату",
  "Флешку відформатовано в іншій файловій системі",
  "Файл заражено вірусом, і антивірус його заблокував",
  "Ім’я файлу задовге для шкільного комп’ютера",
  "Реферат збережено в новішій версії програми, ніж у школі",
  "Флешку витягнули до завершення запису",
  "У файлу змінили розширення, і система не впізнає формат",
  "Усі названі причини можливі, тому варто перевірити кожну",
];

/** A reading question of 1,500 characters with nine answers, the last correct. */
const long = (id: string, n: number) =>
  question(
    id,
    `${n}. ${PASSAGE.repeat(8)}`.slice(0, 1500),
    OPTIONS.map((o, i) => (i === OPTIONS.length - 1 ? `*${o}` : o)),
  );

/** «Ще N відповідей нижче», whatever N is. */
const CUE = new RegExp(
  OPTIONS.map((_, n) => m.answers_below({ count: n + 1 })).join("|"),
);

test("a long question with nine answers fits a 1024×768 lab screen", async ({
  klats,
}) => {
  const questions = [long("q1", 1), long("q2", 2)];
  const { code } = await klats.start(questions);
  const page = await klats.computer();
  await joinAs(page, klats, code, CLASS[0]);

  for (const [i, q] of questions.entries()) {
    await expect(answers(page, q)).toBeVisible();
    const cue = page.getByRole("button", { name: CUE });
    await expect(cue).toBeVisible();
    // Clicking a tile scrolls it into view and fails if anything covers it.
    await pick(page, q, ...OPTIONS);
    await expect(cue).toBeHidden();
    const go = page.getByRole("button", {
      name: i === questions.length - 1 ? m.test_finish() : m.test_next(),
    });
    await expect(go).toBeInViewport();
    await expect(
      page.getByRole("button", { name: m.test_skip() }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= window.innerHeight,
      ),
    ).toBe(true);
    await go.click();
  }
  await expect(
    page.getByRole("button", { name: m.review_finish() }),
  ).toBeVisible();
});
