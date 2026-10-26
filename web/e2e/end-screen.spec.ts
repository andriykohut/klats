import { CLASS, expect, joinAs, m, pick, TEST, test } from "./fixtures";

test("mistakes mode lists the wrong questions", async ({ klats }) => {
  const { code } = await klats.start(TEST, {
    settings: { reveal: "mistakes" },
  });
  const student = await klats.computer();
  const [q1, q2, q3] = TEST;

  await joinAs(student, klats, code, CLASS[0]);
  await pick(student, q1, "8");
  await student.getByRole("button", { name: m.test_next() }).click();
  await pick(student, q2, "Клавіатура"); // 1 of 2 points
  await student.getByRole("button", { name: m.test_next() }).click();
  await pick(student, q3, "Firefox");
  await student.getByRole("button", { name: m.test_finish() }).click();
  await student.getByRole("button", { name: m.review_finish() }).click();

  // 3 of 4 points: 75 %, a 9.
  await expect(
    student.getByRole("img", { name: m.finish_grade({ grade: 9 }) }),
  ).toBeVisible();
  await expect(
    student.getByText(m.finish_wrong({ list: "2" }), { exact: true }),
  ).toBeVisible();
});

test("nothing mode shows no grade", async ({ klats }) => {
  const { code } = await klats.start(TEST, {
    settings: { reveal: "nothing" },
  });
  const student = await klats.computer();
  const [q1, , q3] = TEST;

  await joinAs(student, klats, code, CLASS[0]);
  await pick(student, q1, "8");
  await student.getByRole("button", { name: m.test_next() }).click();
  await student.getByRole("button", { name: m.test_skip() }).click();
  await pick(student, q3, "Firefox");
  await student.getByRole("button", { name: m.test_finish() }).click();
  const finished = student.waitForResponse((r) =>
    r.url().endsWith("/api/finish"),
  );
  await student.getByRole("button", { name: m.review_finish() }).click();

  expect(await (await finished).text()).toContain('"grade":0');
  const sheet = student.locator(".k-finish");
  await expect(
    sheet.locator(".k-fchip", { hasText: m.finish_sent() }),
  ).toBeVisible();
  await expect(sheet).not.toHaveText(/\d/);
  await expect(student.getByRole("img")).toHaveCount(0);
});
