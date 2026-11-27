import {
  doc,
  expect,
  m,
  png,
  question,
  questionOf,
  settledBox,
  test,
  until,
} from "./fixtures";

const para = (...content: object[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});
const text = (t: string, ...marks: string[]) => ({
  type: "text",
  text: t,
  ...(marks.length && { marks: marks.map((type) => ({ type })) }),
});
const gap = (id: string) => ({ type: "gap", attrs: { id } });
const item = (id: string, label: string, target = "") => ({
  id,
  content: doc(label),
  correct: false,
  target,
});
const statement = (id: string, label: string, correct: boolean) => ({
  id,
  content: doc(label),
  correct,
});
const place = (id: string, label: string, x = 0, y = 0) => ({
  id,
  content: doc(label),
  x,
  y,
});

test("a student on a phone types the code, answers every question type by touch and finishes", async ({
  klats,
}) => {
  const image = { src: await klats.upload(png(800, 600)), w: 800, h: 600 };
  const single = question("q1", "Скільки бітів в одному байті?", [
    "4",
    "*8",
    "16",
  ]);
  const multi = question(
    "q2",
    "Які з цих пристроїв є пристроями введення?",
    ["*Клавіатура", "*Мишка", "Монітор"],
    2,
  );
  const tf = questionOf("truefalse", "q3", "Які твердження правильні?", {
    options: [
      statement("s1", "Земля кругла", true),
      statement("s2", "Сонце холодне", false),
    ],
  });
  const grid = questionOf("grid", "q4", "Хто це: ссавець чи птах?", {
    targets: [place("c1", "Ссавці"), place("c2", "Птахи")],
    options: [item("r1", "Кіт", "c1"), item("r2", "Горобець", "c2")],
  });
  const short = questionOf("short", "q5", "Столиця України?", {
    accepted: ["Київ"],
  });
  const number = questionOf("number", "q6", "Скільки днів у тижні?", {
    number: { mode: "tolerance", value: 7, tolerance: 0, min: 0, max: 0 },
  });
  const order = questionOf("order", "q7", "Розставте події дня по порядку", {
    options: [
      item("a", "Прокинутися"),
      item("b", "Поснідати"),
      item("c", "Піти до школи"),
    ],
  });
  const match = questionOf("match", "q8", "З’єднайте країни зі столицями", {
    targets: [place("t1", "Київ"), place("t2", "Варшава")],
    options: [item("l1", "Україна", "t1"), item("l2", "Польща", "t2")],
  });
  const groups = questionOf("groups", "q9", "Розкладіть тварин за групами", {
    targets: [place("g1", "Ссавці"), place("g2", "Птахи")],
    options: [item("i1", "Кіт", "g1"), item("i2", "Орел", "g2")],
  });
  const hotspot = questionOf("hotspot", "q10", "Торкніться лівого кута", {
    image,
    areas: [{ id: "a1", shape: "rect", x: 0, y: 0, w: 0.3, h: 0.3 }],
  });
  const label = questionOf("label", "q11", "Підпишіть малюнок", {
    image,
    targets: [place("p1", "", 0.25, 0.3), place("p2", "", 0.75, 0.6)],
    options: [item("n1", "Сонце", "p1"), item("n2", "Хмара", "p2")],
  });
  const gaps = questionOf("gaps", "q12", "Заповніть пропуски", {
    body: para(text("Столиця — "), gap("x1"), text(", а 2 + 2 = "), gap("x2")),
    gaps: [
      { id: "x1", accepted: ["Київ"] },
      {
        id: "x2",
        choices: [
          { id: "k1", text: "три", correct: false },
          { id: "k2", text: "чотири", correct: true },
        ],
      },
    ],
  });
  const bank = questionOf("bank", "q13", "Вставте слова в текст", {
    body: para(gap("w1"), text(" сидить на "), gap("w2"), text(".")),
    options: [
      item("b1", "Кіт", "w1"),
      item("b2", "килимку", "w2"),
      item("b3", "хмарі"),
    ],
  });
  const highlight = questionOf("highlight", "q14", "Виділіть прислівники", {
    body: para(
      text("Сонце світить "),
      text("яскраво", "target"),
      text(", а вітер дме "),
      text("холодно", "target"),
      text("."),
    ),
  });
  const open = questionOf("open", "q15", "Опишіть погоду", {
    rubric: "Одне речення",
  });
  const { code, assignmentId } = await klats.start([
    single,
    multi,
    tf,
    grid,
    short,
    number,
    order,
    match,
    groups,
    hotspot,
    label,
    gaps,
    bank,
    highlight,
    open,
  ]);

  const page = await klats.phone();
  // A button cut off at the screen's edge counts as out of view.
  const press = async (name: string) => {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeInViewport({ ratio: 1 });
    await button.tap();
  };
  const next = () => press(m.test_next());

  await page.goto(klats.student);
  await page.getByRole("textbox", { name: m.join_title() }).fill(code);
  await page.getByText("Бондаренко Олена", { exact: true }).tap();
  await press(m.pick_start());

  const tile = (label: string) => page.getByText(label, { exact: true });
  await tile("8").tap();
  await next();
  await tile("Клавіатура").tap();
  await tile("Мишка").tap();
  await next();

  const row = (name: string) =>
    page.getByRole("radiogroup", { name, exact: true });
  await row("Земля кругла").getByText(m.answer_true(), { exact: true }).tap();
  await row("Сонце холодне").getByText(m.answer_false(), { exact: true }).tap();
  await next();
  await row("Кіт").locator(".k-grid-dot").first().tap();
  await row("Горобець").locator(".k-grid-dot").last().tap();
  await next();

  await page.getByRole("textbox", { name: short.title }).fill("Київ");
  await next();
  await page.getByRole("textbox", { name: number.title }).fill("7");
  await next();

  // Ordering: the ↑ buttons move each event up to its place.
  const rows = page.getByRole("grid", { name: order.title }).getByRole("row");
  const sequence = () =>
    rows.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  const want = ["Прокинутися", "Поснідати", "Піти до школи"];
  // The rows are there once the sheet has slid in.
  await expect(rows).toHaveCount(want.length);
  for (const [i, event] of want.entries()) {
    for (let at = (await sequence()).indexOf(event); at > i; at--) {
      await page
        .getByRole("button", { name: m.order_up({ item: event }) })
        .tap();
      await expect
        .poll(async () => (await sequence()).indexOf(event))
        .toBe(at - 1);
    }
  }
  await expect.poll(sequence).toEqual(want);
  await next();

  // Cards: a tap picks a card, and a tap on a place puts it there.
  const put = async (card: string, slot: string) => {
    await page
      .getByRole("grid", { name: m.cards_tray() })
      .getByRole("row", { name: card })
      .tap();
    await page.getByRole("button", { name: m.card_place({ slot }) }).tap();
    await expect(
      page.getByRole("grid", { name: slot }).getByRole("row", { name: card }),
    ).toBeVisible();
  };
  await put("Київ", "Україна");
  await put("Варшава", "Польща");
  await next();
  await put("Кіт", "Ссавці");
  await put("Орел", "Птахи");
  await next();

  const picture = page
    .getByRole("group", { name: hotspot.title })
    .locator("img");
  const box = await settledBox(picture);
  await picture.tap({ position: { x: box.width * 0.1, y: box.height * 0.1 } });
  await next();
  await put("Сонце", m.point_label({ number: 1 }));
  await put("Хмара", m.point_label({ number: 2 }));
  await next();

  await page
    .getByRole("textbox", { name: m.gap_label({ number: 1 }) })
    .fill("Київ");
  await page.getByRole("button", { name: m.gap_label({ number: 2 }) }).tap();
  await page.getByRole("option", { name: "чотири" }).tap();
  await next();
  await put("Кіт", m.gap_label({ number: 1 }));
  await put("килимку", m.gap_label({ number: 2 }));
  await next();

  await page.getByRole("button", { name: "яскраво", exact: true }).tap();
  await page.getByRole("button", { name: "холодно", exact: true }).tap();
  await next();

  await page
    .getByRole("textbox", { name: open.title })
    .fill("Сонячно й вітряно.");
  await press(m.test_finish());
  await press(m.review_finish());
  await expect(page.getByText(m.finish_title())).toBeInViewport();

  // Every answer is right; the written one waits for the teacher.
  await until(klats, (live) => live.rows[0]?.status === "finished");
  const { rows: results } = await klats.results(assignmentId);
  expect(results[0].points).toEqual([
    1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
  ]);
  expect(results[0].pendingIds).toEqual(["q15"]);
});
