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
  const language = page.getByRole("button", { name: m.rich_code_language() });
  const codeBlock = page.getByRole("button", { name: m.rich_code_block() });
  const block = async () => {
    const doc = (await saved(page)).questions[0].text as {
      content: {
        type: string;
        attrs?: unknown;
        content?: { text?: string }[];
      }[];
    };
    const b = doc.content.find((n) => n.type === "codeBlock");
    return b && [b.attrs, b.content?.[0].text];
  };
  const choose = async (name: string) => {
    // Tab from the code block reaches the select, which opens with Enter.
    await page.keyboard.press("Tab");
    await expect(language).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByRole("option", { name }).click();
  };

  await text.click();
  await expect(language).toHaveCount(0);
  await codeBlock.click();
  await choose("Python");
  await page.keyboard.type("def f():");

  // The editor colours the tokens it decorates.
  const keyword = text.locator("pre code .hljs-keyword");
  await expect(keyword).toHaveText("def");
  await expect(keyword).toHaveCSS("color", "rgb(166, 36, 74)");
  await expect.poll(block).toEqual([{ language: "python" }, "def f():"]);

  // Choosing no highlighting drops the language from the saved test.
  await choose(m.rich_code_plain());
  await expect(keyword).toHaveCount(0);
  await expect.poll(block).toEqual([undefined, "def f():"]);

  // The select goes with the code block.
  await codeBlock.click();
  await expect(language).toHaveCount(0);
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
