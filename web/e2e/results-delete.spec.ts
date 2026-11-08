import { CLASS, expect, joinAs, m, pick, TEST, test, until } from "./fixtures";

const TITLE = "Інформатика";

test("deleting a student's row waits for the undo window", async ({
  klats,
}) => {
  const { code, assignmentId } = await klats.start(TEST.slice(0, 1));
  const first = await klats.computer();
  await joinAs(first, klats, code, CLASS[0]);
  await pick(first, TEST[0], "8");
  await joinAs(await klats.computer(), klats, code, CLASS[1]);
  await klats.end();

  const page = await klats.teacher(`/assignments/${assignmentId}`);
  const deletes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE") deletes.push(r.url());
  });
  const student = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const bin = page
    .getByRole("dialog")
    .getByRole("button", { name: m.results_student_delete() });
  const toast = page.getByText(m.results_student_deleted({ name: CLASS[0] }), {
    exact: true,
  });

  await student(CLASS[0]).click();
  await bin.click();
  await expect(student(CLASS[0])).toBeHidden();
  await expect(toast).toBeVisible();
  await page.getByRole("button", { name: m.action_undo() }).click();
  await expect(student(CLASS[0])).toBeVisible();
  await expect(toast).toBeHidden();
  expect(deletes).toEqual([]);

  await student(CLASS[0]).click();
  const sent = page.waitForRequest((r) => r.method() === "DELETE", {
    timeout: 10_000,
  });
  await bin.click();
  await sent;
  await expect(student(CLASS[0])).toBeHidden();
  await expect(student(CLASS[1])).toBeVisible();
  await expect(page.locator(".r-head p")).toContainText(
    m.classes_students({ count: 1 }),
  );
});

test("deleting a whole entry from its page returns to the list", async ({
  klats,
}) => {
  const { code, assignmentId } = await klats.start(TEST.slice(0, 1));
  await joinAs(await klats.computer(), klats, code, CLASS[0]);
  await klats.end();

  const page = await klats.teacher(`/assignments/${assignmentId}`);
  const sent = page.waitForRequest((r) => r.method() === "DELETE", {
    timeout: 10_000,
  });
  await page
    .getByRole("button", { name: m.results_delete({ title: TITLE }) })
    .click();
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(page.getByRole("link", { name: TITLE })).toBeHidden();
  await expect(
    page.getByText(m.results_deleted({ title: TITLE }), { exact: true }),
  ).toBeVisible();
  await sent;
  await expect(page.getByText(m.results_empty_title())).toBeVisible();
});

test("the bin of a running test is disabled", async ({ klats }) => {
  await klats.start(TEST.slice(0, 1));
  await until(klats, (live) => !live.sitting.ended);
  const page = await klats.teacher("/assignments");
  await expect(
    page.getByRole("button", { name: m.results_delete({ title: TITLE }) }),
  ).toBeDisabled();
});
