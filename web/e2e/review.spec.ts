import { doc, expect, joinAs, m, questionOf, test, until } from "./fixtures";

const statement = (id: string, text: string, correct: boolean) => ({
  id,
  content: doc(text),
  correct,
});
const item = (id: string, text: string) => ({
  id,
  content: doc(text),
  correct: false,
});

test("the teacher reviews every answer type and grades the written one", async ({
  klats,
}) => {
  const tf = questionOf("truefalse", "q1", "Які твердження правильні?", {
    points: 2,
    options: [
      statement("s1", "Земля кругла", true),
      statement("s2", "Сонце холодне", false),
    ],
  });
  const order = questionOf("order", "q2", "Розставте події дня", {
    points: 3,
    options: [
      item("a", "Прокинутися"),
      item("b", "Поснідати"),
      item("c", "Піти до школи"),
    ],
  });
  const open = questionOf("open", "q3", "Поясніть чому", {
    points: 2,
    rubric: "Назвіть дві причини",
  });
  const { code, assignmentId } = await klats.start([tf, order, open]);

  const page = await klats.computer();
  await joinAs(page, klats, code, "Бондаренко Олена");
  const next = page.getByRole("button", { name: m.test_next() });
  const group = (name: string) =>
    page.getByRole("radiogroup", { name, exact: true });
  await group("Земля кругла")
    .getByText(m.answer_true(), { exact: true })
    .click();
  await group("Сонце холодне")
    .getByText(m.answer_true(), { exact: true })
    .click();
  await next.click();

  // One move of the second card up makes an answer.
  const rows = page.getByRole("grid", { name: order.title }).getByRole("row");
  await expect(rows).toHaveCount(3);
  const [, second] = await rows.evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")),
  );
  await page
    .getByRole("button", { name: m.order_up({ item: second ?? "" }) })
    .click();
  await expect(next).toBeEnabled();
  await next.click();

  await page
    .getByRole("textbox", { name: open.title })
    .fill("Бо так\nі ще інакше");
  await page.getByRole("button", { name: m.test_finish() }).click();
  await page.getByRole("button", { name: m.review_finish() }).click();
  await expect(page.locator(".k-finish-note")).toBeVisible();
  await until(klats, (live) => live.rows[0]?.status === "finished");

  // The live view marks the written answer pending and has no grade yet.
  const live = await klats.teacher("/live");
  await expect(live.locator('tbody .j-cell[data-state="pending"]')).toHaveCount(
    1,
  );
  await expect(
    live.locator(".j-legend").getByText(m.legend_pending()),
  ).toBeVisible();
  await expect(
    live.locator("td.j-grade").getByText(m.status_pending()),
  ).toBeVisible();
  await expect(live.locator(".l-ev-grade")).toHaveText(m.legend_pending());

  // The results list the pending cell and «Перевірити: 1».
  const results = await klats.teacher(`/assignments/${assignmentId}`);
  await expect(
    results
      .getByRole("button", { name: m.status_pending(), exact: false })
      .first(),
  ).toBeVisible();
  const review = results.getByRole("button", {
    name: m.results_review({ count: 1 }),
  });
  await expect(review).toBeVisible();
  await expect(
    results.locator("td.j-grade").getByText(m.status_pending()),
  ).toBeVisible();
  await review.click();

  const detail = results.getByRole("dialog");
  const questions = detail.locator(".r-q");
  const points = questions.nth(2).getByLabel(m.col_points());
  await expect(points).toBeFocused();

  // True/false rows carry the server's verdicts, and ordering shows both orders.
  const tfRows = questions.nth(0).locator(".r-row");
  await expect(tfRows).toHaveCount(2);
  await expect(
    tfRows.nth(0).getByRole("img", { name: m.review_right() }),
  ).toBeVisible();
  await expect(
    tfRows.nth(1).getByRole("img", { name: m.review_wrong() }),
  ).toBeVisible();
  await expect(tfRows.nth(1)).toContainText(
    `${m.review_right()}: ${m.answer_false()}`,
  );
  await expect(
    questions.nth(1).getByRole("heading", { name: m.review_order_student() }),
  ).toBeVisible();
  await expect(
    questions.nth(1).getByRole("heading", { name: m.review_order_key() }),
  ).toBeVisible();
  await expect(questions.nth(2)).toContainText("Назвіть дві причини");
  await expect(questions.nth(2).locator(".r-written p")).toContainText(
    "і ще інакше",
  );

  // Two points grade the answer: the chip goes and a grade comes.
  await expect(questions.nth(2)).toContainText(m.status_pending());
  await points.fill("2");
  await points.press("Enter");
  await expect(questions.nth(2)).not.toContainText(m.status_pending());
  await expect(points).toBeFocused();
  await detail.getByRole("button", { name: m.action_close() }).click();
  await expect(review).toHaveCount(0);
  await expect(
    results.locator('tbody .j-cell[data-state="pending"]'),
  ).toHaveCount(0);
  await expect(results.locator("td.j-grade .j-gr")).toBeVisible();

  const graded = await klats.results(assignmentId);
  expect(graded.rows[0].pendingIds).toEqual([]);
  expect(graded.rows[0].points[2]).toBe(2);

  // The student's finish screen shows the grade.
  await expect(
    page.getByRole("img", {
      name: m.finish_grade({ grade: graded.rows[0].grade }),
    }),
  ).toBeVisible();
});

test("zero points grade a written answer too", async ({ klats }) => {
  const open = questionOf("open", "q1", "Поясніть чому", { points: 2 });
  const { code, assignmentId } = await klats.start([open]);
  const page = await klats.computer();
  await joinAs(page, klats, code, "Бондаренко Олена");
  await page.getByRole("textbox", { name: open.title }).fill("Не знаю");
  await page.getByRole("button", { name: m.test_finish() }).click();
  await page.getByRole("button", { name: m.review_finish() }).click();
  await until(klats, (live) => live.rows[0]?.status === "finished");

  const results = await klats.teacher(`/assignments/${assignmentId}`);
  await results
    .getByRole("button", { name: m.results_review({ count: 1 }) })
    .click();
  const detail = results.getByRole("dialog");
  const points = detail.getByLabel(m.col_points());
  await expect(points).toBeFocused();
  await points.fill("0");
  await points.press("Enter");
  await expect(detail).not.toContainText(m.status_pending());
  const graded = await klats.results(assignmentId);
  expect(graded.rows[0].pendingIds).toEqual([]);
  expect(graded.rows[0].overridden).toEqual(["q1"]);
});
