import type { Test } from "@klats/shared/generated/testfmt.ts";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Page } from "@playwright/test";
import { expect, joinAs, m, question, test } from "./fixtures";

/** The test as last saved, read through the page's own session. */
async function saved(page: Page): Promise<Test> {
  const id = new URL(page.url()).pathname.split("/").pop();
  const doc: TestDoc = await page.evaluate(
    async (id) => (await fetch(`/api/tests/${id}`)).json(),
    id,
  );
  return doc.test;
}

test("a code block's language is chosen in the builder and saved with the test", async ({
  klats,
}) => {
  const page = await klats.teacher("/");
  await page.getByRole("button", { name: m.tests_new() }).click();
  await page.getByRole("button", { name: m.builder_add_question() }).click();
  await page
    .getByRole("button", { name: m.type_single_desc(), exact: false })
    .click();

  const text = page.getByRole("textbox", { name: m.builder_question_text() });
  await text.click();
  await page.getByRole("button", { name: m.rich_code_block() }).click();
  const language = page.getByRole("button", { name: m.rich_code_language() });
  await language.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "Python" }).click();
  await page.keyboard.type("def f():");

  // The editor colours the tokens it decorates.
  const keyword = text.locator("pre code .hljs-keyword");
  await expect(keyword).toHaveText("def");
  await expect(keyword).toHaveCSS("color", "rgb(166, 36, 74)");

  await expect
    .poll(async () => {
      const doc = (await saved(page)).questions[0].text as {
        content: { attrs?: unknown; content?: { text?: string }[] }[];
      };
      const block = doc.content.find((n) => n.attrs);
      return [block?.attrs, block?.content?.[0].text];
    })
    .toEqual([{ language: "python" }, "def f():"]);

  // The choice is back to none when the language is cleared.
  await language.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: m.rich_code_plain() }).click();
  await expect(text.locator("pre code .hljs-keyword")).toHaveCount(0);
});

test("code is highlighted on the student's page after the network drops", async ({
  klats,
}) => {
  const q1 = question("q1", "Перше", ["*Так", "Ні"]);
  const q2 = question("q2", "Друге", ["*Так", "Ні"]);
  q2.text = {
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { language: "python" },
        content: [{ type: "text", text: "def f():" }],
      },
    ],
  };

  const { code } = await klats.start([q1, q2]);
  const page = await klats.computer();
  await joinAs(page, klats, code, "Коваль Максим");
  // The highlighter chunk is in the browser once its script has run.
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((e) => /highlighter-.*\.js/.test(e.name)),
      ),
    )
    .toBe(true);
  await page.context().setOffline(true);

  await page.getByRole("button", { name: m.test_skip() }).click();
  await expect(page.locator("pre code .hljs-keyword")).toHaveText("def");
});
