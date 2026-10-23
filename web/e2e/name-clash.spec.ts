import { CLASS, expect, joinAs, m, test } from "./fixtures";

test("a second computer that picks a taken name waits for the teacher", async ({
  klats,
}) => {
  const { code } = await klats.start();
  const teacher = await klats.teacher();
  const holder = await klats.computer();
  const newcomer = await klats.computer();
  const name = CLASS[1];

  await joinAs(holder, klats, code, name);
  // Every computer here has the label «1» (127.0.0.1); a lab renames its PCs.
  await klats.rename(name, "ПК-1");

  await newcomer.goto(`${klats.student}/?code=${code}`);
  await expect(newcomer.getByText(m.pick_joined())).toBeVisible();
  await newcomer.getByText(name, { exact: true }).click();
  await expect(
    newcomer.getByText(m.pick_name_taken({ label: "ПК-1" })),
  ).toBeVisible();

  const labels = { name, holder: "ПК-1", newcomer: "1" };
  const alert = teacher.getByText(m.ev_clash(labels));
  await expect(alert).toBeVisible();
  await teacher
    .getByRole("button", { name: m.ev_kick({ label: "1" }), exact: true })
    .click();
  await expect(alert).toBeHidden();
  await expect(teacher.getByText(m.ev_clash_done(labels))).toBeVisible();

  // kick_new marks the newcomer kicked, so it shows the kicked screen, whose
  // button leads back to the names, with the name still held.
  await expect(newcomer.getByText(m.kicked_title())).toBeVisible();
  await newcomer.getByRole("button", { name: m.kicked_button() }).click();
  await expect(newcomer.getByText(m.pick_joined())).toBeVisible();
  await expect(newcomer.getByText(name, { exact: true })).toBeVisible();
  await expect(
    holder.getByRole("button", { name: m.test_skip() }),
  ).toBeVisible();
});
