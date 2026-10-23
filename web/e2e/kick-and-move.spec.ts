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

test("the teacher sends a student back to the names, and moves another to a new computer", async ({
  klats,
}) => {
  const { code, assignmentId } = await klats.start();
  const teacher = await klats.teacher();
  const [q1, q2] = TEST;

  // The kicked student sees why and picks the name again.
  const kicked = CLASS[2];
  const a = await klats.computer();
  await joinAs(a, klats, code, kicked);
  await pick(a, q1, "4");
  await until(
    klats,
    (live) => live.rows.find((r) => r.name === kicked)?.cells[0] === "wrong",
  );
  await teacher
    .getByRole("button", { name: m.live_row_menu({ name: kicked }) })
    .click();
  await teacher.getByRole("menuitem", { name: m.live_kick() }).click();
  await teacher
    .getByRole("alertdialog")
    .getByRole("button", { name: m.live_kick() })
    .click();
  await expect(a.getByText(m.kicked_title())).toBeVisible();
  await a.getByRole("button", { name: m.kicked_button() }).click();
  await a.getByText(kicked, { exact: true }).click();
  await a.getByRole("button", { name: m.pick_start() }).click();
  await expect(
    answers(a, q1).getByRole("radio", { name: "4" }),
  ).not.toBeChecked();

  // The moved student's computer drops off the network; the student goes on
  // at another one with the answers the server holds.
  const moved = CLASS[3];
  const old = await klats.computer();
  await joinAs(old, klats, code, moved);
  await pick(old, q1, "8");
  await until(
    klats,
    (live) => live.rows.find((r) => r.name === moved)?.cells[0] === "correct",
  );
  await old.context().setOffline(true);
  // The server calls a computer offline after 15 s without a request.
  await expect(teacher.getByText(m.ev_offline({ name: moved }))).toBeVisible({
    timeout: 30_000,
  });

  const next = await klats.computer();
  await next.goto(`${klats.student}/?code=${code}`);
  await next.getByText(moved, { exact: true }).click();
  await expect(next.getByText(m.pick_name_taken({ label: "1" }))).toBeVisible();
  await teacher
    .getByRole("button", { name: m.ev_move({ label: "1" }) })
    .click();
  await expect(
    answers(next, q1).getByRole("radio", { name: "8" }),
  ).toBeChecked();
  await next.getByRole("button", { name: m.test_next() }).click();
  await pick(next, q2, "Клавіатура");
  await expect
    .poll(
      async () => {
        const { rows } = await klats.results(assignmentId);
        return rows.find((r) => r.name === moved)?.answers[q2.id]?.items;
      },
      { timeout: 10_000 },
    )
    .toEqual([q2.options[0].id]);

  await old.context().setOffline(false);
  await expect(old.getByText(m.moved_title())).toBeVisible({ timeout: 15_000 });
});
