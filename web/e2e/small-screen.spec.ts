import {
  answers,
  CLASS,
  doc,
  expect,
  joinAs,
  m,
  pick,
  question,
  questionOf,
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

test("answers that overflow only at the first density stop at the second", async ({
  klats,
}) => {
  // Six short answers under a four-line question fit once the tiles tighten
  // by one step and no further; data-density counts the steps.
  const q = question("q1", `Питання. ${"Слово ".repeat(40)}`, [
    "*Відповідь",
    ...[1, 2, 3, 4, 5].map((n) => `Відповідь ${n}`),
  ]);
  const { code } = await klats.start([q]);
  const page = await klats.computer();
  await joinAs(page, klats, code, CLASS[0]);

  await expect(answers(page, q)).toBeVisible();
  await expect(page.locator(".k-sheet")).toHaveAttribute("data-density", "1");
  await expect(page.locator(".k-more[data-show]")).toHaveCount(0);
});

test("a matching question taller than the screen keeps its cards in reach", async ({
  klats,
}) => {
  const pairs = [
    ["Україна", "Київ"],
    ["Польща", "Варшава"],
    ["Німеччина", "Берлін"],
    ["Чехія", "Прага"],
    ["Австрія", "Відень"],
    ["Італія", "Рим"],
    ["Іспанія", "Мадрид"],
    ["Португалія", "Лісабон"],
  ];
  const q = questionOf("match", "q1", "З’єднайте країни зі столицями", {
    targets: pairs.map(([, city], i) => ({
      id: `t${i}`,
      content: doc(city),
      x: 0,
      y: 0,
    })),
    options: pairs.map(([country], i) => ({
      id: `o${i}`,
      content: doc(country),
      correct: false,
      target: `t${i}`,
    })),
  });
  const { code } = await klats.start([q]);
  const page = await klats.computer();
  await joinAs(page, klats, code, CLASS[0]);
  const tray = page.getByRole("grid", { name: m.cards_tray() });
  const card = (label: string) => tray.getByRole("row", { name: label });
  const place = (name: string) => page.getByRole("grid", { name });

  // Scrolled down to the last place, the tray is still on screen, and a card
  // dragged from it by the mouse lands there. A drag started while the tray
  // is still settling can miss, so it is tried again.
  await place("Португалія").scrollIntoViewIfNeeded();
  await expect(tray).toBeInViewport({ ratio: 1 });
  await expect(async () => {
    const from = await card("Лісабон").boundingBox();
    const to = await place("Португалія").boundingBox();
    if (!from || !to) throw new Error("the card or the place is not shown");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 5,
    });
    await page.mouse.up();
    await expect(
      place("Португалія").getByRole("row", { name: "Лісабон" }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  // A keyboard pick sends focus up to the first place, which scrolls into
  // view below the tray rather than under it.
  await card("Київ").focus();
  await page.keyboard.press("Space");
  const first = page.getByRole("button", {
    name: m.card_place({ slot: "Україна" }),
  });
  await expect(first).toBeFocused();
  await expect
    .poll(() =>
      first.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const at = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return e.contains(at);
      }),
    )
    .toBe(true);
});
