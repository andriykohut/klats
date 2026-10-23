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
