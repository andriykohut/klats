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

test("answers that arrive after the end regrade the results and outdate the export", async ({
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
  await expect(answers(student, q2)).toBeVisible();
  await student.getByRole("button", { name: m.test_skip() }).click();
  await pick(student, q3, "Firefox");

  await teacher.getByRole("button", { name: m.live_end() }).click();
  await teacher
    .getByRole("button", { name: m.end_confirm(), exact: true })
    .click();
  const row = teacher.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("1 / 4");

  // Without the desktop window the export downloads through the browser.
  const download = teacher.waitForEvent("download");
  await teacher.getByRole("button", { name: m.results_export() }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  const stale = teacher.getByText(m.results_stale(), { exact: true });
  await expect(stale).toBeHidden();

  await student.context().setOffline(false);
  await expect(row).toContainText("2 / 4");
  await expect(stale).toBeVisible();
});

test("answers queued offline before the end land when the computer comes back during the next sitting", async ({
  klats,
}) => {
  const { code, assignmentId } = await klats.start();
  const teacher = await klats.teacher();
  const student = await klats.computer();
  const [q1, q2, q3] = TEST;
  const name = CLASS[0];

  await joinAs(student, klats, code, name);
  await pick(student, q1, "8");
  await until(klats, (live) => live.rows[0]?.cells[0] === "correct");
  const browser = student.context();
  await browser.setOffline(true);
  await student.getByRole("button", { name: m.test_next() }).click();
  await expect(answers(student, q2)).toBeVisible();
  await student.getByRole("button", { name: m.test_skip() }).click();
  await pick(student, q3, "Firefox");

  await teacher.getByRole("button", { name: m.live_end() }).click();
  await teacher
    .getByRole("button", { name: m.end_confirm(), exact: true })
    .click();
  await expect(
    teacher.getByRole("row", { name: new RegExp(name) }),
  ).toContainText("1 / 4");

  // The student closes the browser; the next lesson starts a new sitting
  // before the computer is used again.
  await student.close();
  await klats.start();
  await browser.setOffline(false);
  const again = await browser.newPage();
  await again.goto(klats.student);

  await expect
    .poll(
      async () => {
        const { rows } = await klats.results(assignmentId);
        const row = rows.find((r) => r.name === name);
        return { q3: row?.answers[q3.id], late: row?.late };
      },
      { timeout: 15_000 },
    )
    .toEqual({ q3: [q3.options[0].id], late: [q3.id] });
  await expect(
    again.getByRole("heading", { name: m.join_title() }),
  ).toBeVisible();
});
