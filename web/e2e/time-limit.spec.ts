import type { Page } from "@playwright/test";
import {
  answers,
  CLASS,
  expect,
  joinAs,
  m,
  pick,
  TEST,
  test,
  until,
} from "./fixtures";

/** The seconds left on the student's timer, which reads m:ss or h:mm:ss. */
async function secondsLeft(page: Page): Promise<number> {
  const timer = page.getByRole("timer", { name: m.timer_label() });
  await expect(timer).toBeVisible();
  const text = (await timer.textContent()) ?? "";
  return text.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
}

test("the name screen names the limit", async ({ klats }) => {
  const { code } = await klats.start(TEST, {
    settings: { timeLimit: { mode: "student", minutes: 20 } },
  });
  const student = await klats.computer();
  await student.goto(`${klats.student}/?code=${code}`);

  const text = m.pick_time_student({ minutes: 20, button: m.pick_start() });
  const note = student.getByText(text);
  await expect(note).toBeVisible();
  const start = student.getByRole("button", { name: m.pick_start() });
  await expect(start).toHaveAccessibleDescription(text);
  // The sheet tilts as it slides in, so this waits for it to settle.
  await expect
    .poll(async () => {
      const [n, b] = [await note.boundingBox(), await start.boundingBox()];
      return n && b && n.y + n.height / 2 < b.y;
    })
    .toBe(true);
});

test("the name screen names a common end time", async ({ klats }) => {
  const endsAt = Date.now() + 30 * 60_000;
  const { code } = await klats.start(TEST, {
    settings: { timeLimit: { mode: "common", minutes: 30 } },
    endsAt,
  });
  const student = await klats.computer(false, "Asia/Tokyo");
  await student.goto(`${klats.student}/?code=${code}`);

  const time = new Date(endsAt).toLocaleTimeString("uk", {
    timeStyle: "short",
  });
  expect(time).toMatch(/^\d\d:\d\d$/);
  await expect(
    student.getByText(m.pick_time_common({ time }), { exact: true }),
  ).toBeVisible();
});

test("a reload gains no time", async ({ klats }) => {
  const { code } = await klats.start(TEST, {
    settings: { timeLimit: { mode: "student", minutes: 2 } },
  });
  const student = await klats.computer();
  await joinAs(student, klats, code, CLASS[0]);
  await student.waitForTimeout(3000);
  const before = await secondsLeft(student);
  expect(before).toBeLessThanOrEqual(117);

  await student.reload();
  await expect(
    student.getByRole("button", { name: m.test_skip() }),
  ).toBeVisible();
  const after = await secondsLeft(student);
  expect(after).toBeLessThanOrEqual(before);
  expect(after).toBeGreaterThanOrEqual(before - 10);

  // The review keeps the countdown in view.
  for (const q of TEST) {
    await expect(answers(student, q)).toBeVisible();
    await student.getByRole("button", { name: m.test_skip() }).click();
  }
  await expect(
    student.getByRole("heading", { name: m.review_title() }),
  ).toBeVisible();
  expect(await secondsLeft(student)).toBeLessThanOrEqual(after);
});

test("answers given offline across the deadline arrive, flagged late", async ({
  klats,
}) => {
  test.setTimeout(90_000);
  const { code, assignmentId } = await klats.start(TEST, {
    settings: { timeLimit: { mode: "common", minutes: 30 } },
    endsAt: Date.now() + 20_000,
  });
  const student = await klats.computer();
  const [q1, q2] = TEST;
  const name = CLASS[0];

  await joinAs(student, klats, code, name);
  await pick(student, q1, "8");
  await until(klats, (live) => live.rows[0]?.cells[0] === "correct");
  await student.context().setOffline(true);
  await student.getByRole("button", { name: m.test_next() }).click();
  await pick(student, q2, "Клавіатура", "Мишка");

  // At zero the sheet locks and leaves for the finish screen, which waits
  // for the connection.
  await expect(
    student.getByRole("heading", { name: m.finish_time_up() }),
  ).toBeVisible({ timeout: 25_000 });
  await expect(answers(student, q2)).toBeHidden();
  await expect(
    student.getByText(m.finish_waiting(), { exact: true }),
  ).toBeVisible();

  // Past the server's 10 s grace, so the queued answer counts as late.
  await student.waitForTimeout(12_000);
  await student.context().setOffline(false);
  // Q1 and Q2 hold 3 of the 4 points: 75 %, a 9.
  await expect(
    student.getByRole("img", { name: m.finish_grade({ grade: 9 }) }),
  ).toBeVisible({ timeout: 20_000 });

  const row = (await klats.results(assignmentId)).rows.find(
    (r) => r.name === name,
  );
  expect(row?.answers[q2.id]?.items).toEqual([
    q2.options[0].id,
    q2.options[1].id,
  ]);
  expect(row?.late).toContain(q2.id);
  expect(row?.late).not.toContain(q1.id);
});
