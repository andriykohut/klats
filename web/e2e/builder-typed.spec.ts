import type { Question } from "@klats/shared/generated/testfmt.ts";
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

const editor = (page: Page) => page.getByRole("main");
const preview = (page: Page) =>
  page.getByRole("complementary", { name: m.builder_preview() });

test("a short question keeps its accepted answers and matching switches", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_short_desc);
  const main = editor(page);
  await main
    .getByRole("textbox", { name: m.builder_question_text() })
    .fill("Столиця України?");

  const input = main.getByRole("textbox", { name: m.builder_accepted_add() });
  await input.fill("Київ");
  await input.press("Enter");
  await input.fill("Kyiv");
  await input.press("Enter");
  // A repeated text and a blank one add nothing.
  await input.fill("Київ");
  await input.press("Enter");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  const chips = main.getByRole("grid", { name: m.builder_accepted() });
  await expect(chips.getByRole("row")).toHaveCount(2);

  // The defaults are on, except the typo rule.
  const sw = (name: () => string) => main.getByRole("switch", { name: name() });
  await expect(sw(m.builder_match_case)).toBeChecked();
  await expect(sw(m.builder_match_apostrophes)).toBeChecked();
  await expect(sw(m.builder_match_letters)).toBeChecked();
  await expect(sw(m.builder_match_typo)).not.toBeChecked();
  // The input is visually hidden, so the label takes the click.
  await main.getByText(m.builder_match_typo(), { exact: true }).click();
  await main.getByText(m.builder_match_case(), { exact: true }).click();
  await expect(sw(m.builder_match_typo)).toBeChecked();
  await expect(sw(m.builder_match_case)).not.toBeChecked();

  await expect(preview(page).getByText("Столиця України?")).toBeVisible();
  const q = await question(page);
  expect(q.type).toBe("short");
  expect(q.accepted).toEqual(["Київ", "Kyiv"]);
  expect(q.match).toEqual({
    caseSensitive: true,
    strictApostrophes: false,
    strictLetters: false,
    allowTypo: true,
  });

  // Removing a chip offers an undo that puts it back in place.
  await main
    .getByRole("button", { name: m.builder_accepted_remove({ text: "Київ" }) })
    .click();
  await expect(chips.getByRole("row")).toHaveCount(1);
  await expect
    .poll(async () => (await question(page)).accepted)
    .toEqual(["Kyiv"]);
  await page.getByRole("button", { name: m.action_undo() }).click();
  await expect(chips.getByRole("row")).toHaveCount(2);
  await expect
    .poll(async () => (await question(page)).accepted)
    .toEqual(["Київ", "Kyiv"]);

  // When the last chip goes, focus moves to the field and not to the page.
  for (const text of ["Київ", "Kyiv"]) {
    await main
      .getByRole("button", { name: m.builder_accepted_remove({ text }) })
      .click();
  }
  await expect(chips).toHaveCount(0);
  await expect(input).toBeFocused();
});

test("a number question stays without a key until its fields are filled", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_number_desc);
  const main = editor(page);
  await main
    .getByRole("textbox", { name: m.builder_question_text() })
    .fill("Скільки це буде?");
  const field = (name: () => string) =>
    main.getByRole("textbox", { name: name() });

  await main.getByRole("radio", { name: m.builder_number_range() }).click();
  await field(m.builder_number_min).fill("5");
  await field(m.builder_number_min).press("Tab");
  await expect(preview(page).getByText("Скільки це буде?")).toBeVisible();
  // Half a range is no key.
  expect((await question(page)).number).toBeUndefined();

  await field(m.builder_number_max).fill("10,5");
  await field(m.builder_number_max).press("Tab");
  await expect
    .poll(async () => (await question(page)).number)
    .toMatchObject({ mode: "range", min: 5, max: 10.5 });

  // The other modes keep their own fields.
  await main.getByRole("radio", { name: m.builder_number_tolerance() }).click();
  await expect.poll(async () => (await question(page)).number).toBeUndefined();
  await field(m.builder_number_value).fill("9,8");
  await field(m.builder_number_margin).fill("0,1");
  await field(m.builder_number_margin).press("Tab");
  await expect
    .poll(async () => (await question(page)).number)
    .toMatchObject({ mode: "tolerance", value: 9.8, tolerance: 0.1 });

  // A dot reads as the decimal comma, typed or pasted into part of the field.
  await main.getByRole("radio", { name: m.builder_number_exact() }).click();
  const value = field(m.builder_number_value);
  await value.fill("");
  await value.pressSequentially("10.5");
  await value.press("Tab");
  await expect
    .poll(async () => (await question(page)).number)
    .toMatchObject({ mode: "exact", value: 10.5 });

  // The copy comes from the question text, in the page.
  const text = main.getByRole("textbox", { name: m.builder_question_text() });
  await text.fill(".25");
  await text.press("ControlOrMeta+a");
  await text.press("ControlOrMeta+c");
  await value.fill("");
  await value.pressSequentially("7");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(value).toHaveValue("7,25");
  await value.press("Tab");
  await expect
    .poll(async () => (await question(page)).number)
    .toMatchObject({ mode: "exact", value: 7.25 });
});

test("a gaps question saves a gap made of the selected text, and an undo brings it back whole", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_gaps_desc);
  const main = editor(page);
  await main
    .getByRole("textbox", { name: m.builder_question_text() })
    .fill("Вставте слова");
  const body = main.getByRole("textbox", { name: m.builder_gaps_body() });
  await body.click();
  await body.pressSequentially("Столиця — Київ");
  for (let i = 0; i < 4; i++) await body.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: m.rich_gap(), exact: true }).click();

  const chip = body.locator("[data-klats-gap]");
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAccessibleName(m.gap_label({ number: 1 }));
  const card = (n: number) =>
    main.getByRole("group", { name: m.builder_gap({ number: n }) });
  await expect(card(1)).toBeVisible();
  await expect(
    card(1).getByRole("row", { name: "Київ", exact: true }),
  ).toBeVisible();

  const q = await question(page);
  expect(q.type).toBe("gaps");
  expect(q.gaps).toHaveLength(1);
  expect(q.gaps?.[0]).toMatchObject({ accepted: ["Київ"] });
  const para = (q.body as { content: { content: object[] }[] }).content[0];
  expect(para.content).toEqual([
    { type: "text", text: "Столиця — " },
    { type: "gap", attrs: { id: q.gaps?.[0].id } },
  ]);
  const typed = preview(page).getByRole("textbox", {
    name: m.gap_label({ number: 1 }),
  });
  await expect(typed).toBeVisible();

  // A second gap, from a list.
  await body.press("End");
  await body.pressSequentially(" і ");
  await page.getByRole("button", { name: m.rich_gap(), exact: true }).click();
  await expect(chip).toHaveCount(2);
  await card(2).getByRole("radio", { name: m.builder_gap_list() }).click();
  const choice = (n: number) =>
    card(2).getByRole("textbox", { name: m.builder_gap_choice({ number: n }) });
  await choice(1).fill("Львів");
  await choice(2).fill("Харків");
  await card(2)
    .getByRole("button", {
      name: m.builder_gap_choice_correct({ number: 2 }),
    })
    .click();
  await expect
    .poll(async () => (await question(page)).gaps?.[1]?.choices)
    .toMatchObject([
      { text: "Львів", correct: false },
      { text: "Харків", correct: true },
    ]);
  const list = preview(page).getByRole("button", {
    name: m.gap_label({ number: 2 }),
  });
  // The preview is a picture, so the list is shown closed.
  await expect(list).toBeVisible();

  // Deleting the first gap drops its card and its entry from the save, and
  // an undo in the text brings both back.
  await chip.first().click();
  await page.keyboard.press("Backspace");
  await expect(chip).toHaveCount(1);
  await expect(card(2)).toHaveCount(0);
  await expect
    .poll(async () =>
      (await question(page)).gaps?.map((g) => g.choices?.length),
    )
    .toEqual([2]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(chip).toHaveCount(2);
  await expect(
    card(1).getByRole("row", { name: "Київ", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await question(page)).gaps?.map((g) => g.accepted ?? []))
    .toEqual([["Київ"], []]);

  // A gap that is cut and pasted back keeps its id, and its answers with it.
  const idsBefore = (await question(page)).gaps?.map((g) => g.id);
  await chip.first().click();
  await page.keyboard.press("ControlOrMeta+x");
  await expect(chip).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(chip).toHaveCount(2);
  await expect(
    card(1).getByRole("row", { name: "Київ", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await question(page)).gaps?.map((g) => g.id))
    .toEqual(idsBefore);

  // A copied gap pastes as a new gap: its own id, and no answers.
  await chip.first().click();
  await page.keyboard.press("ControlOrMeta+c");
  // The copied chip is still selected, and a paste would replace it.
  await body.press("ArrowRight");
  await body.press("End");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(chip).toHaveCount(3);
  await expect(card(3)).toBeVisible();
  await expect
    .poll(async () => {
      const { gaps, body } = await question(page);
      const inBody = JSON.stringify(body).match(/"id":"[a-z0-9]+"/g) ?? [];
      return {
        ids: new Set(gaps?.map((g) => g.id)).size,
        inBody: new Set(inBody).size,
        pasted: gaps?.[2],
      };
    })
    .toMatchObject({ ids: 3, inBody: 3, pasted: { id: expect.any(String) } });
  expect((await question(page)).gaps?.[2].accepted).toBeUndefined();
});

test("a gap is inserted from the keyboard", async ({ klats }) => {
  const page = await newTest(klats);
  await add(page, m.type_gaps_desc);
  const main = editor(page);
  const body = main.getByRole("textbox", { name: m.builder_gaps_body() });
  await body.click();
  await body.pressSequentially("Столиця — Київ");
  for (let i = 0; i < 4; i++) await body.press("Shift+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+Shift+g");

  await expect(body.locator("[data-klats-gap]")).toHaveCount(1);
  await expect(body).toBeFocused();
  const q = await question(page);
  expect(q.gaps?.[0]).toMatchObject({ accepted: ["Київ"] });
  const para = (q.body as { content: { content: object[] }[] }).content[0];
  expect(para.content).toEqual([
    { type: "text", text: "Столиця — " },
    { type: "gap", attrs: { id: q.gaps?.[0].id } },
  ]);
});
