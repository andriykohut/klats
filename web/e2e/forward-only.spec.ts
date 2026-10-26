import { answers, CLASS, expect, m, pick, TEST, test } from "./fixtures";

test("forward only never goes back", async ({ klats }) => {
  const { code } = await klats.start(TEST, {
    settings: { navigation: "forward" },
  });
  const student = await klats.computer();
  const [q1, q2, q3] = TEST;

  await student.goto(`${klats.student}/?code=${code}`);
  const note = m.pick_forward_only();
  await expect(student.getByText(note, { exact: true })).toBeVisible();
  const start = student.getByRole("button", { name: m.pick_start() });
  await expect(start).toHaveAccessibleDescription(note);
  await student.getByText(CLASS[0], { exact: true }).click();
  await start.click();

  await expect(answers(student, q1)).toBeVisible();
  await student.getByRole("button", { name: m.test_skip() }).click();
  await pick(student, q2, "Клавіатура", "Мишка");
  // The strip shows progress, but none of it leads back.
  await expect(student.locator(".k-seg")).toHaveCount(3);
  await expect(student.locator(".k-progress button")).toHaveCount(0);

  // A reload resumes after the last answer.
  await student.reload();
  await expect(answers(student, q3)).toBeVisible();
  await pick(student, q3, "Firefox");
  await student.getByRole("button", { name: m.test_finish() }).click();

  // The review names the skipped question with no way back to it.
  await expect(
    student.getByRole("heading", { name: m.review_title() }),
  ).toBeVisible();
  const skipped = m.review_question({ number: 1 });
  await expect(student.getByText(skipped, { exact: true })).toBeVisible();
  await expect(student.getByRole("button", { name: skipped })).toHaveCount(0);

  await student.getByRole("button", { name: m.review_back() }).click();
  await expect(answers(student, q3)).toBeVisible();
  await student.reload();
  await expect(answers(student, q3)).toBeVisible();

  await student.getByRole("button", { name: m.test_finish() }).click();
  await student.getByRole("button", { name: m.review_finish() }).click();
  // Q2 and Q3 hold 3 of the 4 points: 75 %, a 9.
  await expect(
    student.getByRole("img", { name: m.finish_grade({ grade: 9 }) }),
  ).toBeVisible();
});
