import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Page } from "@playwright/test";
import { expect, type Klats, m, test } from "./fixtures";

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

/** The test as last saved, as JSON, read through the page's own session. */
async function saved(page: Page): Promise<string> {
  const id = new URL(page.url()).pathname.split("/").pop();
  const doc: TestDoc = await page.evaluate(
    async (id) => (await fetch(`/api/tests/${id}`)).json(),
    id,
  );
  return JSON.stringify(doc.test);
}

test("a bullet list sunk three times with Tab is saved", async ({ klats }) => {
  const page = await newQuestion(klats);
  await page.getByRole("textbox", { name: m.builder_question_text() }).click();
  await page.keyboard.type("- a");
  for (const text of ["b", "c", "d"]) {
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type(text);
  }
  await expect
    .poll(async () => (await saved(page)).split('"bulletList"').length - 1)
    .toBe(4);
  await expect(
    page.getByText(m.builder_saved(), { exact: true }),
  ).toBeVisible();
});

test("a save the server refuses is not retried, and the next edit tries again", async ({
  klats,
}) => {
  const page = await newQuestion(klats);
  let puts = 0;
  let refuse = true;
  await page.route(/\/api\/tests\/[^/]+$/, async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    puts++;
    if (!refuse) return route.fallback();
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: '{"error":"invalid"}',
    });
  });

  const text = page.getByRole("textbox", { name: m.builder_question_text() });
  await text.click();
  await page.keyboard.type("Один");
  await expect(
    page.getByText(m.builder_refused(), { exact: true }),
  ).toBeVisible();
  const sent = puts;
  // The first retry of a dropped connection would come after one second.
  await page.waitForTimeout(1500);
  expect(puts).toBe(sent);
  await expect(text).toContainText("Один");

  refuse = false;
  await page.keyboard.type(" два");
  await expect(
    page.getByText(m.builder_saved(), { exact: true }),
  ).toBeVisible();
  expect(await saved(page)).toContain("Один два");
});
