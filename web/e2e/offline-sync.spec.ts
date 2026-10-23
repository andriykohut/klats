import { CLASS, expect, joinAs, m, pick, TEST, test, until } from "./fixtures";

test("answers given while the network is down reach the teacher once it is back", async ({
  klats,
}) => {
  const { code } = await klats.start();
  const teacher = await klats.teacher();
  const student = await klats.computer();
  const [q1, q2, q3] = TEST;
  const name = CLASS[0];

  await joinAs(student, klats, code, name);
  await pick(student, q1, "8");
  await until(klats, (live) => live.rows[0]?.cells[0] === "correct");

  await student.context().setOffline(true);
  await student.getByRole("button", { name: m.test_next() }).click();
  await pick(student, q2, "Клавіатура", "Мишка");
  await student.getByRole("button", { name: m.test_next() }).click();
  await pick(student, q3, "Firefox");
  await expect(
    student.getByText(m.toast_offline(), { exact: true }),
  ).toBeVisible();
  await student.getByRole("button", { name: m.test_finish() }).click();
  await student.getByRole("button", { name: m.review_finish() }).click();
  await expect(
    student.getByText(m.finish_waiting(), { exact: true }),
  ).toBeVisible();

  // The server calls a computer offline after 15 s without a request.
  await expect(teacher.getByText(m.ev_offline({ name }))).toBeVisible({
    timeout: 30_000,
  });
  await student.context().setOffline(false);
  await expect(
    student.getByRole("img", { name: m.finish_grade({ grade: 12 }) }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    teacher.getByText(m.ev_online_synced({ name, count: 2 })),
  ).toBeVisible();
});
