import type { Page } from "@playwright/test";
import {
  answers,
  CLASS,
  expect,
  joinAs,
  m,
  pick,
  question,
  type TestQuestion,
  test,
} from "./fixtures";

/** Five one-point questions whose right answer is «так». */
const FIVE = [1, 2, 3, 4, 5].map((n) =>
  question(`q${n}`, `Питання номер ${n}`, ["*так", "ні"]),
);

/** Waits for a question of FIVE not in `done` to show, and returns it. */
async function shown(page: Page, done: Set<string>): Promise<TestQuestion> {
  let found: TestQuestion | undefined;
  await expect
    .poll(async () => {
      for (const q of FIVE) {
        if (!done.has(q.id) && (await answers(page, q).isVisible())) {
          found = q;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  return found as TestQuestion;
}

test("each student gets 3 of 5 questions", async ({ klats }) => {
  const { code, assignmentId } = await klats.start(FIVE, {
    settings: { shuffleQuestions: true, draw: [{ tag: "", count: 3 }] },
  });

  for (const name of CLASS.slice(0, 2)) {
    const page = await klats.computer();
    await joinAs(page, klats, code, name);
    await expect(page.locator(".k-seg")).toHaveCount(3);
    const done = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const q = await shown(page, done);
      await pick(page, q, "так");
      done.add(q.id);
      const next = i < 2 ? m.test_next() : m.test_finish();
      await page.getByRole("button", { name: next }).click();
    }
    await page.getByRole("button", { name: m.review_finish() }).click();
    await expect(
      page.getByText(m.finish_correct({ correct: 3, total: 3 }), {
        exact: true,
      }),
    ).toBeVisible();
  }

  const results = await klats.teacher(`/assignments/${assignmentId}`);
  const rows = results.locator(".j-table tbody tr");
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    await expect(row.getByRole("img", { name: m.legend_absent() })).toHaveText([
      "—",
      "—",
    ]);
  }
});

test("the detail names a student's own question numbers", async ({ klats }) => {
  const { code, assignmentId } = await klats.start(FIVE, {
    settings: { shuffleQuestions: true },
  });

  // A shuffle can land on the test's order, which leaves every number as it
  // is; the next student then joins, so that some numbers differ.
  let name = "";
  let order: string[] = [];
  for (name of CLASS) {
    const page = await klats.computer();
    await joinAs(page, klats, code, name);
    order = [];
    while (order.length < FIVE.length) {
      if (order.length > 0) {
        await page.getByRole("button", { name: m.test_skip() }).click();
      }
      order.push((await shown(page, new Set(order))).id);
    }
    if (order.some((id, i) => id !== FIVE[i].id)) break;
  }

  const results = await klats.teacher(`/assignments/${assignmentId}`);
  await results.reload();
  await results.getByRole("button", { name, exact: true }).click();
  await expect(results.getByRole("dialog").locator(".r-q-head b")).toHaveText(
    FIVE.map((q, i) => {
      const own = order.indexOf(q.id) + 1;
      return own === i + 1
        ? m.detail_question({ number: i + 1 })
        : m.detail_question_own({ number: i + 1, own });
    }),
  );
});
