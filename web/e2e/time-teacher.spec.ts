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

/** The seconds left on a timer that reads m:ss or h:mm:ss. */
async function secondsLeft(page: Pick<Page, "getByRole">): Promise<number> {
  const timer = page.getByRole("timer", { name: m.timer_label() });
  await expect(timer).toBeVisible();
  const text = (await timer.textContent()) ?? "";
  return text.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
}

/** `at` as the teacher's clock shows it, such as 10:40. */
const clock = (at: number) =>
  new Date(at).toLocaleTimeString("uk", { timeStyle: "short" });

/** `at` as the value of a time field, "HH:MM". */
const field = (at: number) =>
  new Date(at).toLocaleTimeString("en-GB", { timeStyle: "short" });

const FIVE_MINUTES = 5 * 60_000;

/** Opens the menu of `name`'s row on the teacher's live page. */
async function openMenu(teacher: Page, name: string) {
  await teacher
    .getByRole("button", { name: m.live_row_menu({ name }) })
    .click();
}

test("start asks for the end time", async ({ klats }) => {
  const id = await klats.create(TEST, {
    timeLimit: { mode: "common", minutes: 40 },
  });
  const teacher = await klats.teacher(`/tests/${id}`);
  await teacher.getByRole("button", { name: m.builder_start() }).click();
  const dialog = teacher.getByRole("dialog");
  const end = dialog.getByLabel(m.start_end_at());

  // Now plus 40 minutes, up to the next 5; the minute may tick over while it loads.
  const before = Date.now();
  await expect(end).toBeVisible();
  const after = Date.now();
  const round = (t: number) =>
    field(Math.ceil((t + 40 * 60_000) / FIVE_MINUTES) * FIVE_MINUTES);
  expect([round(before), round(after)]).toContain(await end.inputValue());

  const start = dialog.getByRole("button", { name: m.start_go() });
  await dialog.getByText(m.start_no_list(), { exact: true }).click();
  await expect(start).toBeEnabled();
  await end.fill(field(Date.now() - 2 * 60_000));
  await expect(
    dialog.getByText(m.start_end_past(), { exact: true }),
  ).toBeVisible();
  await expect(start).toBeDisabled();

  const endsAt =
    Math.ceil((Date.now() + 30 * 60_000) / FIVE_MINUTES) * FIVE_MINUTES;
  await end.fill(field(endsAt));
  await expect(start).toBeEnabled();
  await start.click();

  await expect(
    teacher.getByText(m.live_time_until({ time: clock(endsAt) })),
  ).toBeVisible();
  const left = await secondsLeft(teacher);
  expect(left).toBeGreaterThan(29 * 60);
  expect(left).toBeLessThanOrEqual(35 * 60);
  const live = await klats.live();
  expect(live.sitting.timeMode).toBe("common");
  expect(live.sitting.endsAt).toBeGreaterThan(Date.now());
});

test("an empty end time blocks the start", async ({ klats }) => {
  const id = await klats.create(TEST, {
    timeLimit: { mode: "common", minutes: 40 },
  });
  const teacher = await klats.teacher(`/tests/${id}`);
  await teacher.getByRole("button", { name: m.builder_start() }).click();
  const dialog = teacher.getByRole("dialog");
  const start = dialog.getByRole("button", { name: m.start_go() });
  await dialog.getByText(m.start_no_list(), { exact: true }).click();
  await expect(start).toBeEnabled();
  await dialog.getByLabel(m.start_end_at()).fill("");
  await expect(start).toBeDisabled();
});

test("the board shows the time left", async ({ klats }) => {
  const endsAt = Date.now() + 40 * 60_000;
  await klats.start(TEST, {
    settings: { timeLimit: { mode: "common", minutes: 40 } },
    endsAt,
  });
  const teacher = await klats.teacher();
  await expect(
    teacher.getByText(m.live_time_until({ time: clock(endsAt) })),
  ).toBeVisible();
  const first = await secondsLeft(teacher);
  expect(first).toBeLessThanOrEqual(40 * 60);
  expect(first).toBeGreaterThan(39 * 60);
  // It runs down by itself.
  await expect.poll(() => secondsLeft(teacher)).toBeLessThan(first);

  // The board covers the bar, so it carries the time too.
  await teacher.getByRole("button", { name: m.live_show_board() }).click();
  const board = teacher.getByRole("dialog", { name: m.live_show_board() });
  await expect(
    board.getByText(m.live_time_until({ time: clock(endsAt) })),
  ).toBeVisible();
  const onBoard = await secondsLeft(board);
  expect(onBoard).toBeLessThan(first);
  expect(onBoard).toBeGreaterThan(39 * 60 - 30);
  await expect.poll(() => secondsLeft(board)).toBeLessThan(onBoard);
});

test("the bar names a per-student limit", async ({ klats }) => {
  await klats.start(TEST, {
    settings: { timeLimit: { mode: "student", minutes: 25 } },
  });
  const teacher = await klats.teacher();
  await expect(
    teacher.getByText(m.live_time_student({ minutes: 25 }), { exact: false }),
  ).toBeVisible();
  await expect(
    teacher.getByRole("timer", { name: m.timer_label() }),
  ).toBeHidden();
});

test("+5 хв is offered only in a timed sitting", async ({ klats }) => {
  const { code } = await klats.start();
  const student = await klats.computer();
  await joinAs(student, klats, code, CLASS[0]);
  const teacher = await klats.teacher();
  await openMenu(teacher, CLASS[0]);
  await expect(
    teacher.getByRole("menuitem", { name: m.live_rename() }),
  ).toBeVisible();
  await expect(
    teacher.getByRole("menuitem", { name: m.time_add_five() }),
  ).toBeHidden();
});

test("+5 хв reaches the student", async ({ klats }) => {
  const { code } = await klats.start(TEST, {
    settings: { timeLimit: { mode: "student", minutes: 1 } },
  });
  const student = await klats.computer();
  const name = CLASS[0];
  await joinAs(student, klats, code, name);
  expect(await secondsLeft(student)).toBeLessThanOrEqual(60);

  const teacher = await klats.teacher();
  await openMenu(teacher, name);
  await teacher.getByRole("menuitem", { name: m.time_add_five() }).click();

  await expect
    .poll(() => secondsLeft(student), { timeout: 7000 })
    .toBeGreaterThan(300);
  await expect(
    teacher.getByText(m.ev_extra_time({ name, minutes: 5 })),
  ).toBeVisible();
});

test("a student who was out of time gets the test back with the extra time", async ({
  klats,
}) => {
  test.setTimeout(120_000);
  const { code } = await klats.start(TEST, {
    settings: { timeLimit: { mode: "student", minutes: 1 } },
  });
  const student = await klats.computer();
  const name = CLASS[0];
  await joinAs(student, klats, code, name);
  const teacher = await klats.teacher();

  // The answer stays on the device, so the finish at zero waits for the drain.
  await student.context().setOffline(true);
  await pick(student, TEST[0], "8");
  await expect(
    student.getByRole("heading", { name: m.finish_time_up() }),
  ).toBeVisible({ timeout: 75_000 });
  await expect(answers(student, TEST[0])).toBeHidden();

  await openMenu(teacher, name);
  await teacher.getByRole("menuitem", { name: m.time_add_five() }).click();
  await expect(
    teacher.getByText(m.ev_extra_time({ name, minutes: 5 })),
  ).toBeVisible();

  await student.context().setOffline(false);
  await expect(
    student.getByRole("button", { name: m.test_skip() }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    student.getByRole("heading", { name: m.finish_time_up() }),
  ).toBeHidden();
  // The minute is spent, so the five added minutes are what is left.
  const left = await secondsLeft(student);
  expect(left).toBeGreaterThan(4 * 60);
  expect(left).toBeLessThanOrEqual(5 * 60);

  // The answer was sent with the extra time already given, so it is on time.
  await until(klats, (live) => live.rows[0]?.cells[0] === "correct");
  await expect(
    teacher.getByText(m.ev_overtime({ name, count: 1 })),
  ).toBeHidden();
});
