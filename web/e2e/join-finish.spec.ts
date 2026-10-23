import { CLASS, expect, joinAs, m, pick, TEST, test } from "./fixtures";

test("a student joins by the code, answers three questions and finishes", async ({
  klats,
}) => {
  const { code } = await klats.start();
  const teacher = await klats.teacher();
  const student = await klats.computer();
  const [q1, q2, q3] = TEST;

  await joinAs(student, klats, code, CLASS[0]);
  await pick(student, q1, "8"); // 1 of 1 point
  await student.getByRole("button", { name: m.test_next() }).click();
  await pick(student, q2, "Клавіатура"); // 1 of 2: half the correct options
  await student.getByRole("button", { name: m.test_next() }).click();
  await pick(student, q3, "Excel"); // 0 of 1
  await student.getByRole("button", { name: m.test_finish() }).click();
  await student.getByRole("button", { name: m.review_finish() }).click();

  // grading.Grade12: floor(12 × earned / max), at least 1.
  const grade = Math.max(1, Math.floor((12 * 2) / 4));
  await expect(
    student.getByRole("img", { name: m.finish_grade({ grade }) }),
  ).toBeVisible();
  await expect(
    student.getByText(m.finish_correct({ correct: 1, total: 3 }), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    teacher.getByText(new RegExp(`^1\\s*${m.live_finished()}$`)),
  ).toBeVisible();
});
