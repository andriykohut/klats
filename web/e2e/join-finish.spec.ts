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

  // grading.Grade on the default scale: 2 of 4 points is 50 %, and grade 6 starts at 50 %.
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

const THRESHOLDS = [16, 25, 33, 41, 50, 58, 66, 75, 83, 91, 100];
const SCALES = [
  { kind: "percent", pass: 60, grade: () => m.grade_percent({ n: 50 }) },
  { kind: "pass", pass: 50, grade: () => m.grade_pass() },
  { kind: "pass", pass: 51, grade: () => m.grade_fail() },
];

for (const scale of SCALES) {
  test(`the finish screen shows a ${scale.kind} grade of 50 % with a pass mark of ${scale.pass}`, async ({
    klats,
  }) => {
    const { code } = await klats.start(TEST, {
      settings: {
        scale: { kind: scale.kind, thresholds: THRESHOLDS, pass: scale.pass },
      },
    });
    const student = await klats.computer();
    const [q1, q2, q3] = TEST;

    await joinAs(student, klats, code, CLASS[0]);
    await pick(student, q1, "8");
    await student.getByRole("button", { name: m.test_next() }).click();
    await pick(student, q2, "Клавіатура");
    await student.getByRole("button", { name: m.test_next() }).click();
    await pick(student, q3, "Excel");
    await student.getByRole("button", { name: m.test_finish() }).click();
    await student.getByRole("button", { name: m.review_finish() }).click();

    await expect(
      student.getByRole("img", {
        name: m.finish_grade({ grade: scale.grade() }),
      }),
    ).toBeVisible();
  });
}

test("a second tab waits, and takes the test over once the first is closed", async ({
  klats,
}) => {
  const { code } = await klats.start();
  const first = await klats.computer();
  await joinAs(first, klats, code, CLASS[0]);

  const second = await first.context().newPage();
  await second.goto(klats.student);
  await expect(second.getByText(m.other_tab_title())).toBeVisible();
  // The waiting tab tries the claim every 5 s. Chromium's close releases the
  // lease; Firefox's skips pagehide, as a crash does, so the lease must first
  // go 15 s without a refresh.
  await first.close();
  await expect(second.getByRole("button", { name: m.test_skip() })).toBeVisible(
    { timeout: 25_000 },
  );
});
