import type { Test } from "@klats/shared/generated/testfmt.ts";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Page } from "@playwright/test";
import { expect, joinAs, type Klats, m, question, test } from "./fixtures";

/** Opens a new test with one single-choice question in the builder. */
async function newQuestion(klats: Klats) {
  const page = await klats.teacher("/");
  await page.getByRole("button", { name: m.tests_new() }).click();
  await page.getByRole("button", { name: m.builder_add_question() }).click();
  await page
    .getByRole("button", { name: m.type_single_desc(), exact: false })
    .click();
  return page;
}

/** The test as last saved, read through the page's own session. */
async function saved(page: Page): Promise<Test> {
  const id = new URL(page.url()).pathname.split("/").pop();
  const doc: TestDoc = await page.evaluate(
    async (id) => (await fetch(`/api/tests/${id}`)).json(),
    id,
  );
  return doc.test;
}

const dialog = (page: Page) =>
  page.getByRole("dialog", { name: m.rich_formula() });

const insertButton = (page: Page) =>
  dialog(page).getByRole("button", { name: m.formula_insert(), exact: true });

test("a fraction is built from the palette and Tab moves to its denominator", async ({
  klats,
}) => {
  const page = await newQuestion(klats);
  const text = page.getByRole("textbox", { name: m.builder_question_text() });
  await text.click();
  await page.keyboard.type("Чому дорівнює ");
  await page.getByRole("button", { name: m.rich_formula() }).click();

  await expect(dialog(page)).toBeVisible();
  await page.getByRole("button", { name: "a/b", exact: true }).click();
  await page.keyboard.type("1");
  await page.keyboard.press("Tab");
  await page.keyboard.type("2");
  await expect(dialog(page).locator(".katex .mfrac")).toBeVisible();
  await expect(dialog(page).locator(".katex-html")).toContainText("21"); // KaTeX lays the denominator out first
  await insertButton(page).click();

  await expect(text.locator(".katex .mfrac")).toBeVisible();
  const last = async () => {
    const doc = (await saved(page)).questions[0].text as {
      content: { content: unknown[] }[];
    };
    return doc.content[0].content.at(-1);
  };
  await expect.poll(last).toEqual({
    type: "math",
    attrs: { latex: "\\frac{1}{2}" },
  });

  // Clicking the formula reopens the dialog on it, and the edit replaces it.
  await text.locator(".katex").click();
  const field = dialog(page).getByLabel(m.formula_latex());
  await expect(field).toHaveValue("\\frac{1}{2}");
  await field.fill("\\sqrt{2}");
  await dialog(page)
    .getByRole("button", { name: m.action_save(), exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(text.locator(".katex .sqrt")).toBeVisible();
  await expect(text.locator(".katex .mfrac")).toHaveCount(0);

  // The caret is back in the text.
  await page.keyboard.type("!");
  await expect(text).toContainText("!");
  await expect.poll(last).toEqual({
    type: "text",
    text: "!",
  });
});

test("a formula KaTeX cannot read cannot be inserted", async ({ klats }) => {
  const page = await newQuestion(klats);
  await page.getByRole("textbox", { name: m.builder_question_text() }).click();
  await page.getByRole("button", { name: m.rich_formula() }).click();

  await dialog(page).getByLabel(m.formula_latex()).fill("\\frac{1}{");
  await expect(dialog(page).getByText(m.formula_error())).toBeVisible();
  await expect(insertButton(page)).toBeDisabled();

  await dialog(page).getByLabel(m.formula_latex()).fill("\\frac{1}{2}");
  await expect(dialog(page).getByText(m.formula_error())).toHaveCount(0);
  await expect(insertButton(page)).toBeEnabled();
});

test("formulas are drawn after the network drops", async ({ klats }) => {
  const math = (latex: string) => ({ type: "math", attrs: { latex } });
  const q1 = question("q1", "Перше", ["*Так", "Ні"]);
  const q2 = question("q2", "Друге", ["*Так", "Ні"]);
  q2.text = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Чому дорівнює " },
          math("\\frac{1}{2}"),
          { type: "text", text: "?" },
        ],
      },
    ],
  };
  q2.options[0].content = {
    type: "doc",
    content: [{ type: "paragraph", content: [math("\\sqrt{4}")] }],
  };

  const { code } = await klats.start([q1, q2]);
  const page = await klats.computer();
  await joinAs(page, klats, code, "Коваль Максим");
  // The KaTeX chunk, its style and every font face are in the browser.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const faces = [...document.fonts].filter((f) =>
          f.family.includes("KaTeX"),
        );
        return faces.length > 0 && faces.every((f) => f.status === "loaded");
      }),
    )
    .toBe(true);
  await page.context().setOffline(true);

  await page.getByRole("button", { name: m.test_skip() }).click();
  await expect(page.locator(".k-qtext .katex")).toBeVisible();
  await expect(page.locator("[data-option] .katex")).toBeVisible();
  await expect(page.locator(".k-math-src")).toHaveCount(0);
});

test("an answer option takes a formula, and Enter in the dialog inserts it without adding an option", async ({
  klats,
}) => {
  const page = await newQuestion(klats);
  const option = page.getByRole("textbox", {
    name: m.builder_answer_placeholder({ letter: "А" }),
  });
  await option.click();
  await page.keyboard.type("x=");
  const before = await page.getByRole("listitem").count();
  await page.keyboard.press("ControlOrMeta+Shift+L");
  await dialog(page).getByLabel(m.formula_latex()).fill("\\sqrt{2}");
  await page.keyboard.press("Enter");

  await expect(dialog(page)).toHaveCount(0);
  await expect(option.locator(".katex .sqrt")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(before);
});
