import type { Page } from "@playwright/test";
import { CLASS, expect, joinAs, m, pick, TEST, test } from "./fixtures";

/**
 * Makes the second question of the test `page` loads throw while it renders:
 * its text is null, which loading the test passes over and drawing it does not.
 */
async function breakSecondQuestion(page: Page) {
  await page.route("**/api/test", async (route) => {
    const body = await (await route.fetch()).json();
    body.test.questions[1].text = null;
    await route.fulfill({ json: body });
  });
}

test("teacher: a crashed page shows the crash screen and reports it", async ({
  klats,
}) => {
  const page = await klats.teacher("/");
  // A list that is not an array throws while the classes page renders.
  await page.route("**/api/classes", (r) => r.fulfill({ json: {} }));
  const report = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/crash",
  );
  await page.goto(new URL("/classes?from=test", page.url()).href);

  await expect(
    page.getByRole("heading", { name: m.crash_title() }),
  ).toBeVisible();
  await expect(page.getByText("Something went wrong!")).toHaveCount(0);
  const sent = (await report).postDataJSON();
  expect(sent.page).toBe("/classes");
  expect(sent.message).not.toBe("");

  await page.getByRole("button", { name: m.crash_to_tests() }).click();
  await expect(
    page.getByRole("heading", { name: m.tests_empty_title() }),
  ).toBeVisible();

  await page.unroute("**/api/classes");
  await page.goto(new URL("/classes", page.url()).href);
  await expect(
    page.getByRole("heading", { name: m.classes_empty_title() }),
  ).toBeVisible();
});

test("student: a broken question can be skipped, and the test finished", async ({
  klats,
}) => {
  const questions = TEST.slice(0, 2);
  const { code } = await klats.start(questions, {
    settings: { timeLimit: { mode: "student", minutes: 20 } },
  });
  const page = await klats.computer();
  await breakSecondQuestion(page);
  const report = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/crash",
  );
  await joinAs(page, klats, code, CLASS[0]);
  await pick(page, questions[0], "8");
  await page.getByRole("button", { name: m.test_next() }).click();

  const sheet = page.getByRole("heading", { name: m.crash_question_title() });
  await expect(sheet).toBeVisible();
  expect((await report).postDataJSON().page).toBe("test 2");
  await expect(
    page.getByRole("button", {
      name: m.progress_question_answered({ number: 1 }),
    }),
  ).toBeVisible();

  const timer = page.getByRole("timer", { name: m.timer_label() });
  await expect(timer).toBeVisible();

  await page.reload();
  await expect(sheet).toBeVisible();
  await expect(timer).toBeVisible();
  await expect(
    page.getByRole("heading", { name: m.crash_title() }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: m.test_finish() }).click();
  await expect(
    page.getByRole("heading", { name: m.review_title() }),
  ).toBeVisible();
  await expect(page.getByText(m.review_question({ number: 2 }))).toBeVisible();
  await page.getByRole("button", { name: m.review_finish() }).click();
  await expect(
    page.getByRole("heading", { name: m.finish_title() }),
  ).toBeVisible();
});

test("student: a test that can't be loaded shows the crash screen and reports it", async ({
  klats,
}) => {
  const { code } = await klats.start(TEST.slice(0, 2));
  const page = await klats.computer();
  // A question without an options list throws while the test is processed.
  await page.route("**/api/test", async (route) => {
    const body = await (await route.fetch()).json();
    body.test.questions[0].options = null;
    await route.fulfill({ json: body });
  });
  const report = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/crash",
  );
  // Not joinAs: it waits for a question that never shows.
  await page.goto(`${klats.student}/?code=${code}`);
  await page.getByText(CLASS[0], { exact: true }).click();
  await page.getByRole("button", { name: m.pick_start() }).click();

  await expect(
    page.getByRole("heading", { name: m.crash_title() }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: m.crash_reload() }),
  ).toBeVisible();
  const sent = (await report).postDataJSON();
  expect(sent.page).toBe("pick");
  expect(sent.message).not.toBe("");
});

test("student: the broken-question sheet shows when the report can't be sent", async ({
  klats,
}) => {
  const { code } = await klats.start(TEST.slice(0, 2));
  const page = await klats.computer();
  await breakSecondQuestion(page);
  await page.route("**/api/crash", (r) => r.abort());
  await joinAs(page, klats, code, CLASS[0]);
  await page.getByRole("button", { name: m.test_skip() }).click();

  await expect(
    page.getByRole("heading", { name: m.crash_question_title() }),
  ).toBeVisible();
});
