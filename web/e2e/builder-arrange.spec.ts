import type { Option, Question } from "@klats/shared/generated/testfmt.ts";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Page } from "@playwright/test";
import { expect, type Klats, m, test } from "./fixtures";

/** Opens a new test in the builder with the preview showing. */
async function newTest(klats: Klats) {
  const page = await klats.teacher("/");
  await page.getByRole("button", { name: m.tests_new() }).click();
  await expect(page).toHaveURL(/\/tests\/.+/);
  await page.getByRole("button", { name: m.builder_preview_show() }).click();
  return page;
}

/** Adds a question of the type whose picker description is `desc`. */
async function add(page: Page, desc: () => string) {
  await page.getByRole("button", { name: m.builder_add_question() }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: desc(), exact: false })
    .click();
}

/** The test document as last saved, read through the page's own session. */
async function saved(page: Page): Promise<TestDoc> {
  const id = new URL(page.url()).pathname.split("/").pop();
  return page.evaluate(
    async (id) => (await fetch(`/api/tests/${id}`)).json(),
    id,
  );
}

/** The first question as last saved, once the page says it is. */
async function question(page: Page): Promise<Question> {
  await expect(page.getByText(m.builder_saved())).toBeVisible();
  return (await saved(page)).test.questions[0];
}

/** The text of an option or target stored as one paragraph. */
const textOf = (o: { content: unknown }) =>
  (o.content as { content: { content?: { text: string }[] }[] }).content[0]
    .content?.[0].text ?? "";

const editor = (page: Page) => page.getByRole("main");
const preview = (page: Page) =>
  page.getByRole("complementary", { name: m.builder_preview() });
const field = (page: Page, name: string) =>
  editor(page).getByRole("textbox", { name, exact: true });

test("ordering saves the items in the list's order, whether moved by a button or dragged", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_order_desc);
  const main = editor(page);
  await field(page, m.builder_question_text()).fill("Розставте події");
  const item = (n: number) => m.builder_order_item({ number: n });
  await field(page, item(1)).fill("Перша");
  await field(page, item(2)).fill("Друга");
  await field(page, item(3)).fill("Третя");

  // Three items is the least there is to order.
  await expect(
    main.getByRole("button", {
      name: m.builder_item_delete({ item: item(1) }),
    }),
  ).toBeDisabled();
  await expect(
    main.getByRole("button", { name: m.builder_item_up({ item: item(1) }) }),
  ).toBeDisabled();
  await expect(
    main.getByRole("button", { name: m.builder_item_down({ item: item(3) }) }),
  ).toBeDisabled();

  await main
    .getByRole("button", { name: m.builder_item_up({ item: item(3) }) })
    .click();
  await expect(preview(page).getByText("Третя")).toBeVisible();
  await expect
    .poll(async () => (await question(page)).options.map(textOf))
    .toEqual(["Перша", "Третя", "Друга"]);
  const q = await question(page);
  expect(q.type).toBe("order");
  expect(q.options.some((o) => o.target)).toBe(false);

  // A row dragged by its handle lands where it is dropped.
  const rows = main.locator("[data-item]");
  await rows.nth(0).locator("[data-grip]").dragTo(rows.nth(2));
  await expect
    .poll(async () => (await question(page)).options.map(textOf))
    .toEqual(["Третя", "Друга", "Перша"]);
  await expect(field(page, item(3))).toHaveText("Перша");
});

test("a matching question saves each pair with a target of its own, and the extra choices as targets no pair names", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_match_desc);
  const main = editor(page);
  await field(page, m.builder_question_text()).fill("З’єднайте країни");
  const left = (n: number) => m.builder_pair_left({ number: n });
  const right = (n: number) => m.builder_pair_right({ number: n });
  await field(page, left(1)).fill("Україна");
  await field(page, right(1)).fill("Київ");
  await field(page, left(2)).fill("Польща");
  await field(page, right(2)).fill("Варшава");
  await main.getByRole("button", { name: m.builder_add_decoy() }).click();
  await field(page, m.builder_decoy({ number: 1 })).fill("Прага");

  // Enter in the right side of the last pair opens the next pair.
  await field(page, right(2)).press("Enter");
  await expect(field(page, left(3))).toBeFocused();
  await field(page, left(3)).fill("Чехія");
  await field(page, right(3)).fill("Лондон");
  await expect(preview(page).getByText("Лондон")).toBeVisible();
  await expect(preview(page).getByText("Чехія")).toBeVisible();

  // Removing a pair removes its right side too, and an undo brings both back.
  const pair = (n: number) => m.builder_pair({ number: n });
  await main
    .getByRole("button", { name: m.builder_item_delete({ item: pair(3) }) })
    .click();
  await expect(field(page, left(3))).toHaveCount(0);
  await expect
    .poll(async () => {
      const q = await question(page);
      return [q.options.length, q.targets?.length];
    })
    .toEqual([2, 3]);
  await page.getByRole("button", { name: m.action_undo() }).click();
  await expect(field(page, right(3))).toHaveText("Лондон");
  await main
    .getByRole("button", { name: m.builder_item_delete({ item: pair(3) }) })
    .click();

  await expect(preview(page).getByText("Київ")).toBeVisible();
  const q = await question(page);
  expect(q.type).toBe("match");
  expect(q.options.map(textOf)).toEqual(["Україна", "Польща"]);
  const targets = q.targets ?? [];
  expect(targets.map(textOf).sort()).toEqual(["Варшава", "Київ", "Прага"]);
  const named = q.options.map((o) => o.target);
  expect(new Set(named).size).toBe(2);
  expect(textOf(targets.find((t) => t.id === named[0]) ?? targets[0])).toBe(
    "Київ",
  );
  expect(textOf(targets.find((t) => t.id === named[1]) ?? targets[0])).toBe(
    "Варшава",
  );
  expect(named.every((id) => targets.some((t) => t.id === id))).toBe(true);

  // An extra choice goes with an undo as well.
  await main
    .getByRole("button", {
      name: m.builder_item_delete({ item: m.builder_decoy({ number: 1 }) }),
    })
    .click();
  await expect.poll(async () => (await question(page)).targets?.length).toBe(2);
  await page
    .locator(".t-toast")
    .filter({
      hasText: m.builder_item_removed({ item: m.builder_decoy({ number: 1 }) }),
    })
    .getByRole("button", { name: m.action_undo() })
    .click();
  await expect(field(page, m.builder_decoy({ number: 1 }))).toHaveText("Прага");
  await expect.poll(async () => (await question(page)).targets?.length).toBe(3);
});

test("a grouping question saves each item under its group, and removing a group takes its items along", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_groups_desc);
  const main = editor(page);
  await field(page, m.builder_question_text()).fill("Розкладіть тварин");
  const name = (n: number) => m.builder_group_name({ number: n });
  const item = (g: number, n: number) =>
    m.builder_group_item({ group: g, number: n });
  const addItem = (g: number) =>
    main.getByRole("button", { name: m.builder_add_group_item({ group: g }) });
  await field(page, name(1)).fill("Ссавці");
  await field(page, name(2)).fill("Птахи");
  await field(page, item(1, 1)).fill("Кіт");
  await field(page, item(2, 1)).fill("Горобець");
  await addItem(2).click();
  await field(page, item(2, 2)).fill("Орел");
  await addItem(2).click();
  await field(page, item(2, 3)).fill("Кит");

  // An item put in the wrong group moves with the group choice beside it.
  await main
    .getByLabel(m.builder_group_item_group({ item: item(2, 3) }))
    .selectOption({ label: "Ссавці" });
  await expect(field(page, item(1, 2))).toHaveText("Кит");
  await expect(field(page, item(2, 3))).toHaveCount(0);

  await expect(preview(page).getByText("Горобець")).toBeVisible();
  const q = await question(page);
  expect(q.type).toBe("groups");
  const groups = q.targets ?? [];
  expect(groups.map(textOf)).toEqual(["Ссавці", "Птахи"]);
  const under = (id: string) =>
    q.options.filter((o) => o.target === id).map(textOf);
  expect(under(groups[0].id).sort()).toEqual(["Кит", "Кіт"]);
  expect(under(groups[1].id).sort()).toEqual(["Горобець", "Орел"]);

  // A third group, removed: its items go with it, and an undo restores both.
  await main.getByRole("button", { name: m.builder_add_group() }).click();
  await field(page, name(3)).fill("Земноводні");
  await addItem(3).click();
  await field(page, item(3, 1)).fill("Жаба");
  await expect.poll(async () => (await question(page)).options.length).toBe(5);
  await main
    .getByRole("button", {
      name: m.builder_item_delete({ item: m.builder_group({ number: 3 }) }),
      exact: true,
    })
    .click();
  await expect(field(page, item(3, 1))).toHaveCount(0);
  await expect
    .poll(async () => {
      const x = await question(page);
      return [x.options.length, x.targets?.length];
    })
    .toEqual([4, 2]);
  await page.getByRole("button", { name: m.action_undo() }).click();
  await expect(field(page, item(3, 1))).toHaveText("Жаба");
  await expect
    .poll(async () => {
      const x = await question(page);
      return [x.options.length, x.targets?.length];
    })
    .toEqual([5, 3]);
  const back = await question(page);
  const third = back.targets?.[2].id;
  expect(back.options.filter((o) => o.target === third).map(textOf)).toEqual([
    "Жаба",
  ]);
});

test("a word bank question saves a word for each gap, and shows a word whose gap is gone among the extra words", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_bank_desc);
  const main = editor(page);
  await field(page, m.builder_question_text()).fill("Вставте слова");
  const body = field(page, m.builder_bank_body());
  await body.click();
  await body.pressSequentially("кіт сидить");
  for (let i = 0; i < 10; i++) await body.press("ArrowLeft");
  for (let i = 0; i < 3; i++) await body.press("Shift+ArrowRight");
  await page
    .getByRole("button", { name: m.builder_bank_make_gap(), exact: true })
    .click();

  const chip = body.locator("[data-klats-gap]");
  await expect(chip).toHaveCount(1);
  // The chip is drawn with its word and not a number.
  await expect
    .poll(() => chip.evaluate((el) => getComputedStyle(el, "::before").content))
    .toBe('"кіт"');
  await expect(field(page, m.builder_bank_word({ number: 1 }))).toHaveText(
    "кіт",
  );
  await expect(chip).toHaveAccessibleName(
    m.gap_label_word({ number: 1, word: "кіт" }),
  );
  await expect(preview(page).getByText("сидить")).toBeVisible();

  const q = await question(page);
  expect(q.type).toBe("bank");
  expect(q.options).toHaveLength(1);
  const para = (q.body as { content: { content: object[] }[] }).content[0];
  expect(para.content).toEqual([
    { type: "gap", attrs: { id: q.options[0].target } },
    { type: "text", text: " сидить" },
  ]);
  expect(textOf(q.options[0])).toBe("кіт");

  // The word follows its gap when the gap goes, and comes back with it. The
  // editor's history joins edits made within half a second, and then an undo
  // would take back the gap's making as well.
  await page.waitForTimeout(600);
  await chip.click();
  await page.keyboard.press("Backspace");
  await expect(chip).toHaveCount(0);
  const decoy = field(page, m.builder_bank_decoy({ number: 1 }));
  await expect(decoy).toHaveText("кіт");
  await expect(field(page, m.builder_bank_word({ number: 1 }))).toHaveCount(0);
  await expect
    .poll(async () => {
      const x = await question(page);
      return [x.options.length, x.options[0].target || ""];
    })
    .toEqual([1, ""]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(chip).toHaveCount(1);
  await expect(decoy).toHaveCount(0);
  await expect(field(page, m.builder_bank_word({ number: 1 }))).toHaveText(
    "кіт",
  );
  await expect
    .poll(() => chip.evaluate((el) => getComputedStyle(el, "::before").content))
    .toBe('"кіт"');
  await expect
    .poll(async () => (await question(page)).options[0].target)
    .toBe(q.options[0].target);

  // A second gap from the keyboard, and an extra word typed in. The restored
  // chip is still selected; the arrows take the caret over it and the text.
  for (let i = 0; i < 8; i++) await body.press("ArrowRight");
  for (let i = 0; i < 6; i++) await body.press("Shift+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+Shift+g");
  await expect(chip).toHaveCount(2);
  await expect(field(page, m.builder_bank_word({ number: 2 }))).toHaveText(
    "сидить",
  );
  await main.getByRole("button", { name: m.builder_add_bank_decoy() }).click();
  await field(page, m.builder_bank_decoy({ number: 1 })).fill("лежить");
  await expect(preview(page).getByText("лежить")).toBeVisible();
  const done = await question(page);
  const words = (opts: Option[]) =>
    opts.map((o) => [textOf(o), o.target ? "gap" : "extra"]);
  expect(words(done.options)).toEqual([
    ["кіт", "gap"],
    ["сидить", "gap"],
    ["лежить", "extra"],
  ]);
  const ids = JSON.stringify(done.body).match(/"id":"[a-z0-9]+"/g) ?? [];
  expect(ids).toHaveLength(2);
  expect(new Set(done.options.map((o) => o.target).filter(Boolean)).size).toBe(
    2,
  );
});

test("a single-choice question turned into ordering shows its text and four answers in the editor", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_single_desc);
  const main = editor(page);
  await field(page, m.builder_question_text()).fill("Розставте літери");
  const answer = (letter: string) =>
    field(page, m.builder_answer_placeholder({ letter }));
  await answer("А").fill("Перша");
  await answer("Б").fill("Друга");
  await answer("Б").press("Enter");
  await answer("В").fill("Третя");
  await answer("В").press("Enter");
  await answer("Г").fill("Четверта");

  await page.getByRole("button", { name: m.builder_type_label() }).click();
  await page
    .getByRole("option", { name: m.type_order_name(), exact: true })
    .click();

  await expect(field(page, m.builder_question_text())).toHaveText(
    "Розставте літери",
  );
  const item = (n: number) => m.builder_order_item({ number: n });
  await expect(main.locator("[data-item]")).toHaveCount(4);
  for (const [i, text] of ["Перша", "Друга", "Третя", "Четверта"].entries()) {
    await expect(field(page, item(i + 1))).toHaveText(text);
  }
});

/** Puts `edit`'s version of the first question into the open test, and reloads the builder. */
async function seed(page: Page, edit: (q: Question) => Question) {
  const { test: doc } = await saved(page);
  doc.questions = [edit(doc.questions[0])];
  await page.evaluate(async (doc) => {
    await fetch(`/api/tests/${doc.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
  }, doc);
  await page.reload();
}

/** Returns `n` empty options that all name `target`. */
const filler = (n: number, target = ""): Option[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `filler${i}`,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    correct: false,
    target,
  }));

for (const [type, desc, label, grouped] of [
  ["single choice", m.type_single_desc, m.builder_add_answer, false],
  ["true/false", m.type_truefalse_desc, m.builder_add_statement, false],
  ["grid", m.type_grid_desc, m.builder_add_row, false],
  ["ordering", m.type_order_desc, m.builder_add_order_item, false],
  [
    "grouping",
    m.type_groups_desc,
    () => m.builder_add_group_item({ group: 2 }),
    true,
  ],
] as const) {
  test(`a ${type} question with 50 options offers no way to add another`, async ({
    klats,
  }) => {
    const page = await newTest(klats);
    await add(page, desc);
    await expect(page.getByText(m.builder_saved())).toBeVisible();
    await seed(page, (q) => ({
      ...q,
      options: filler(50, grouped ? q.targets?.[0].id : ""),
    }));
    await expect(
      editor(page).getByRole("button", { name: label() }),
    ).toBeDisabled();
  });
}

test("a word bank at 50 words makes no more gaps", async ({ klats }) => {
  const page = await newTest(klats);
  await add(page, m.type_bank_desc);
  await expect(page.getByText(m.builder_saved())).toBeVisible();
  await seed(page, (q) => ({
    ...q,
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "кіт сидить" },
            { type: "gap", attrs: { id: "g1" } },
          ],
        },
      ],
    },
    options: [
      { ...filler(1, "g1")[0], id: "w1" },
      ...filler(49).map((o) => ({ ...o, id: `x${o.id}` })),
    ],
  }));
  const body = field(page, m.builder_bank_body());
  await body.click();
  await body.press("ArrowLeft");
  await body.press("Shift+ArrowLeft");
  await expect(
    page.getByRole("button", { name: m.builder_bank_make_gap(), exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+Shift+g");
  await expect(body.locator("[data-klats-gap]")).toHaveCount(1);
});

test("a gap made of a selection with spaces around its word keeps the spaces in the text", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_bank_desc);
  const body = field(page, m.builder_bank_body());
  await body.click();
  await body.pressSequentially("а кіт б");
  await body.press("ArrowLeft");
  for (let i = 0; i < 5; i++) await body.press("Shift+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+Shift+g");
  await expect(body.locator("[data-klats-gap]")).toHaveCount(1);
  const q = await question(page);
  expect(textOf(q.options[0])).toBe("кіт");
  const para = (q.body as { content: { content: object[] }[] }).content[0];
  expect(para.content).toEqual([
    { type: "text", text: "а " },
    { type: "gap", attrs: { id: q.options[0].target } },
    { type: "text", text: " б" },
  ]);
});

test("changing an item's group from the keyboard leaves focus on its group choice", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_groups_desc);
  const item = (g: number, n: number) =>
    m.builder_group_item({ group: g, number: n });
  await field(page, m.builder_group_name({ number: 1 })).fill("Ссавці");
  await field(page, m.builder_group_name({ number: 2 })).fill("Птахи");
  await field(page, item(1, 1)).fill("Кіт");
  await field(page, item(2, 1)).fill("Орел");

  const choice = editor(page).getByLabel(
    m.builder_group_item_group({ item: item(1, 1) }),
  );
  await choice.focus();
  await choice.selectOption({ label: "Птахи" });
  // The item leads group 2 now, and its choice keeps the focus.
  await expect(field(page, item(2, 1))).toHaveText("Кіт");
  await expect(
    editor(page).getByLabel(m.builder_group_item_group({ item: item(2, 1) })),
  ).toBeFocused();
});
