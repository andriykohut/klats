import type { Question } from "@klats/shared/generated/testfmt.ts";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import { QUESTION_TYPES } from "@klats/shared/questionTypes.ts";
import type { Page } from "@playwright/test";
import { expect, type Klats, m, test } from "./fixtures";

/** The card of question type `type` in the picker, found by its description. */
const DESC: Record<string, () => string> = {
  single: m.type_single_desc,
  multi: m.type_multi_desc,
  truefalse: m.type_truefalse_desc,
  grid: m.type_grid_desc,
  short: m.type_short_desc,
  number: m.type_number_desc,
  gaps: m.type_gaps_desc,
  order: m.type_order_desc,
  match: m.type_match_desc,
  groups: m.type_groups_desc,
  bank: m.type_bank_desc,
  hotspot: m.type_hotspot_desc,
  label: m.type_label_desc,
  highlight: m.type_highlight_desc,
  open: m.type_open_desc,
};

/** The name of each type in the editor's type select. */
const NAME: Record<string, () => string> = {
  single: m.answer_single,
  multi: m.answer_multi,
  truefalse: m.type_truefalse_name,
  grid: m.type_grid_name,
  short: m.type_short_name,
  number: m.type_number_name,
  gaps: m.type_gaps_name,
  order: m.type_order_name,
  match: m.type_match_name,
  groups: m.type_groups_name,
  bank: m.type_bank_name,
  hotspot: m.type_hotspot_name,
  label: m.type_label_name,
  highlight: m.type_highlight_name,
  open: m.type_open_name,
};

/** Opens a new test in the builder. */
async function newTest(klats: Klats) {
  const page = await klats.teacher("/");
  await page.getByRole("button", { name: m.tests_new() }).click();
  await expect(page).toHaveURL(/\/tests\/.+/);
  return page;
}

/** Adds a question of `type` through the picker. */
async function add(page: Page, type: string) {
  await page.getByRole("button", { name: m.builder_add_question() }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: DESC[type](), exact: false })
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

/** The questions as last saved, once the page says they are. */
async function questions(page: Page): Promise<Question[]> {
  await expect(page.getByText(m.builder_saved())).toBeVisible();
  return (await saved(page)).test.questions;
}

/** Turns the selected question into `type` with the editor's type select. */
async function convert(page: Page, type: string) {
  await page.getByRole("button", { name: m.builder_type_label() }).click();
  await page.getByRole("option", { name: NAME[type](), exact: true }).click();
}

const editor = (page: Page) => page.getByRole("main");
const preview = (page: Page) =>
  page.getByRole("complementary", { name: m.builder_preview() });

test("the picker offers all fifteen types, and each starts without a missing-items problem", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await page.getByRole("button", { name: m.builder_add_question() }).click();
  await expect(page.getByRole("dialog").getByRole("button")).toHaveCount(
    QUESTION_TYPES.length,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  for (const { type } of QUESTION_TYPES) await add(page, type);
  const list = page
    .getByRole("listbox", { name: m.builder_questions() })
    .getByRole("option");
  await expect(list).toHaveCount(QUESTION_TYPES.length);

  await expect(page.getByText(m.builder_saved())).toBeVisible();
  const doc = await saved(page);
  expect(doc.test.questions.map((q) => q.type)).toEqual(
    // The picker inserts each question after the selected one, which is the last.
    QUESTION_TYPES.map((t) => t.type),
  );
  expect(doc.problems.filter((p) => p.code.startsWith("too_few"))).toEqual([]);
});

test("the picker works when it is reopened before it has finished closing", async ({
  klats,
}) => {
  const page = await newTest(klats);
  // Each add opens the picker again at once, while the last one is still closing.
  await add(page, "single");
  await add(page, "multi");
  await add(page, "truefalse");
  await expect(
    page
      .getByRole("listbox", { name: m.builder_questions() })
      .getByRole("option"),
  ).toHaveCount(3);
  const types = (await questions(page)).map((q) => q.type);
  expect(types).toEqual(["single", "multi", "truefalse"]);
});

test("a true/false question keeps the truth of each statement", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await page.getByRole("button", { name: m.builder_preview_show() }).click();
  await add(page, "truefalse");
  await editor(page)
    .getByRole("textbox", { name: m.builder_question_text() })
    .fill("Які твердження правильні?");
  await editor(page)
    .getByRole("textbox", { name: m.builder_statement({ number: 1 }) })
    .fill("Земля кругла");
  await editor(page)
    .getByRole("textbox", { name: m.builder_statement({ number: 2 }) })
    .fill("Сонце холодне");
  await editor(page)
    .getByRole("radiogroup", { name: m.builder_statement_value({ number: 2 }) })
    .getByText(m.answer_true(), { exact: true })
    .click();

  await expect(preview(page).getByText("Земля кругла")).toBeVisible();
  const [q] = await questions(page);
  expect(q.type).toBe("truefalse");
  expect(q.options.map((o) => o.correct)).toEqual([false, true]);

  // A statement can be moved down, and the truth goes with it.
  await editor(page)
    .getByRole("button", {
      name: m.builder_item_down({ item: m.builder_statement({ number: 1 }) }),
    })
    .click();
  await expect
    .poll(async () =>
      (await saved(page)).test.questions[0].options.map((o) => o.correct),
    )
    .toEqual([true, false]);
});

test("a grid question keeps the right column of each row", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await page.getByRole("button", { name: m.builder_preview_show() }).click();
  await add(page, "grid");
  const main = editor(page);
  await main
    .getByRole("textbox", { name: m.builder_question_text() })
    .fill("Метал чи неметал?");
  await main
    .getByRole("textbox", { name: m.builder_column({ number: 1 }) })
    .fill("Метал");
  await main
    .getByRole("textbox", { name: m.builder_column({ number: 2 }) })
    .fill("Неметал");
  await main.getByRole("button", { name: m.builder_add_column() }).click();
  await main
    .getByRole("textbox", { name: m.builder_column({ number: 3 }) })
    .fill("Інертний газ");
  await main
    .getByRole("textbox", { name: m.builder_row({ number: 1 }) })
    .fill("Залізо");
  await main
    .getByRole("textbox", { name: m.builder_row({ number: 2 }) })
    .fill("Хлор");

  const right = (row: number) =>
    main.getByRole("radiogroup", {
      name: m.builder_row_right({ number: row }),
    });
  await right(1).getByText("Метал", { exact: true }).click();
  await right(2).getByText("Неметал", { exact: true }).click();
  await expect(
    right(1).getByRole("radio", { name: "Метал", exact: true }),
  ).toBeChecked();
  await expect(right(1).getByRole("radio")).toHaveCount(3);

  await expect(preview(page).getByText("Залізо")).toBeVisible();
  const [q] = await questions(page);
  expect(q.type).toBe("grid");
  expect(q.targets?.length).toBe(3);
  const ids = q.targets?.map((t) => t.id) ?? [];
  expect(q.options.map((o) => o.target)).toEqual([ids[0], ids[1]]);
  expect(q.options.map((o) => o.correct)).toEqual([false, false]);

  // Columns stop at six, and a grid needs two.
  for (let i = 0; i < 3; i++) {
    await main.getByRole("button", { name: m.builder_add_column() }).click();
  }
  await expect(
    main.getByRole("button", { name: m.builder_add_column() }),
  ).toBeDisabled();
  await expect(right(1).getByRole("radio")).toHaveCount(6);
});

test("removing a grid column and undoing it gives the rows their column back", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, "grid");
  const main = editor(page);
  await main
    .getByRole("textbox", { name: m.builder_column({ number: 1 }) })
    .fill("Метал");
  await main
    .getByRole("textbox", { name: m.builder_column({ number: 2 }) })
    .fill("Неметал");
  await main.getByRole("button", { name: m.builder_add_column() }).click();
  await main
    .getByRole("textbox", { name: m.builder_row({ number: 1 }) })
    .fill("Залізо");
  const right = main.getByRole("radiogroup", {
    name: m.builder_row_right({ number: 1 }),
  });
  await right.getByText("Метал", { exact: true }).click();
  const [before] = await questions(page);
  const column = before.targets?.[0].id;
  expect(before.options[0].target).toBe(column);

  await main
    .getByRole("button", {
      name: m.builder_item_delete({ item: m.builder_column({ number: 1 }) }),
    })
    .click();
  await expect(right.getByRole("radio")).toHaveCount(2);
  await expect(right.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect
    .poll(async () => (await saved(page)).test.questions[0].options[0].target)
    .toBeFalsy();

  await page.getByRole("button", { name: m.action_undo() }).click();
  await expect(right.getByRole("radio")).toHaveCount(3);
  await expect(
    right.getByRole("radio", { name: "Метал", exact: true }),
  ).toBeChecked();
  await expect
    .poll(async () => (await saved(page)).test.questions[0].options[0].target)
    .toBe(column);
});

test("a single-choice question turned into ordering keeps its text and answers", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, "single");
  const main = editor(page);
  await main
    .getByRole("textbox", { name: m.builder_question_text() })
    .fill("Розставте літери");
  const field = (letter: string) =>
    main.getByRole("textbox", {
      name: m.builder_answer_placeholder({ letter }),
    });
  await field("А").fill("Перша");
  await field("Б").fill("Друга");
  await field("Б").press("Enter");
  await field("В").fill("Третя");
  await field("В").press("Enter");
  await field("Г").fill("Четверта");
  await main
    .getByRole("button", { name: m.builder_answer_correct({ letter: "Б" }) })
    .click();

  await convert(page, "order");

  await expect(
    main.getByRole("textbox", { name: m.builder_question_text() }),
  ).toHaveText("Розставте літери");
  const [q] = await questions(page);
  expect(q.type).toBe("order");
  expect(q.text).toMatchObject({
    content: [{ content: [{ text: "Розставте літери" }] }],
  });
  expect(
    q.options.map(
      (o) =>
        (o.content as { content: { content: { text: string }[] }[] }).content[0]
          .content[0].text,
    ),
  ).toEqual(["Перша", "Друга", "Третя", "Четверта"]);
  expect(q.options.some((o) => o.correct)).toBe(false);

  // Back to single choice, the four answers are in the editor again.
  await convert(page, "single");
  await expect(field("Г")).toHaveText("Четверта");
});

test("every conversion of a filled question is saved", async ({ klats }) => {
  const page = await newTest(klats);
  await add(page, "single");
  const main = editor(page);
  await main
    .getByRole("textbox", { name: m.builder_question_text() })
    .fill("Текст");
  await main
    .getByRole("textbox", {
      name: m.builder_answer_placeholder({ letter: "А" }),
    })
    .fill("Один");
  await main
    .getByRole("button", { name: m.builder_answer_correct({ letter: "А" }) })
    .click();
  for (const { type } of QUESTION_TYPES) {
    await convert(page, type);
    await expect
      .poll(async () => (await saved(page)).test.questions[0]?.type)
      .toBe(type);
    await expect(page.getByText(m.builder_saved())).toBeVisible();
  }
});

test("a body moves between gaps, word bank and highlight and is saved", async ({
  klats,
}) => {
  const page = await newTest(klats);
  const text = (t: string, marks?: { type: string }[]) => ({
    type: "text",
    text: t,
    ...(marks ? { marks } : {}),
  });
  const body = (...content: object[]) => ({
    type: "doc",
    content: [{ type: "paragraph", content }],
  });
  const base = {
    text: { type: "doc", content: [] },
    points: 1,
    shuffleOptions: false,
    partial: true,
    options: [],
  };
  const id = new URL(page.url()).pathname.split("/").pop();
  await page.evaluate(
    async ({ id, questions }) => {
      await fetch(`/api/tests/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          id,
          version: 1,
          title: "T",
          palette: "teal",
          questions,
        }),
      });
    },
    {
      id,
      questions: [
        {
          ...base,
          id: "hl",
          type: "highlight",
          body: body(
            text("Кіт", [{ type: "bold" }, { type: "target" }]),
            text(" спить"),
          ),
        },
        {
          ...base,
          id: "gp",
          type: "gaps",
          body: body(
            text("Кіт "),
            { type: "gap", attrs: { id: "g1" } },
            { type: "math", attrs: { latex: "x" } },
          ),
        },
      ],
    },
  );
  await page.reload();
  const list = page
    .getByRole("listbox", { name: m.builder_questions() })
    .getByRole("option");
  await list.nth(0).click();
  for (const type of ["gaps", "bank", "highlight"]) {
    await convert(page, type);
    await expect
      .poll(async () => (await saved(page)).test.questions[0].type)
      .toBe(type);
  }
  await list.nth(1).click();
  for (const type of ["highlight", "bank", "gaps"]) {
    await convert(page, type);
    await expect
      .poll(async () => (await saved(page)).test.questions[1].type)
      .toBe(type);
  }
  await expect(page.getByText(m.builder_saved())).toBeVisible();
});
