import { expect, m, test } from "./fixtures";

test("a table and a code block written in the builder reach the student's sheet", async ({
  klats,
}) => {
  const teacher = await klats.teacher("/");
  await teacher.getByRole("button", { name: m.tests_new() }).click();
  await teacher.getByRole("button", { name: m.builder_add_question() }).click();

  await teacher
    .getByRole("button", { name: m.type_single_desc(), exact: false })
    .click();

  const text = teacher.getByRole("textbox", {
    name: m.builder_question_text(),
  });
  await text.click();
  await teacher.getByRole("button", { name: m.rich_table() }).click();
  await text.locator("th").first().click();
  await teacher.keyboard.type("Рік");
  await text.locator("p").last().click();
  await teacher.getByRole("button", { name: m.rich_code_block() }).click();
  await teacher.keyboard.type("print(1)");
  await expect(text.locator("pre code")).toHaveText("print(1)");

  for (const letter of ["А", "Б"]) {
    await teacher
      .getByRole("textbox", { name: m.builder_answer_placeholder({ letter }) })
      .fill(letter);
  }
  await teacher
    .getByRole("button", { name: m.builder_answer_correct({ letter: "А" }) })
    .click();

  await teacher.getByRole("button", { name: m.builder_start() }).click();
  const dialog = teacher.getByRole("dialog");
  await dialog.getByText(m.start_no_list(), { exact: true }).click();
  await dialog.getByRole("button", { name: m.start_go(), exact: true }).click();
  const code = await teacher
    .locator(".l-code strong")
    .textContent({ timeout: 10_000 });

  const student = await klats.computer();
  await student.goto(`${klats.student}/?code=${code}`);
  await student.getByLabel(m.typed_surname()).fill("Коваль");
  await student.getByLabel(m.typed_first_name()).fill("Олена");
  await student.getByLabel(m.typed_class()).fill("7-Б");
  await student.getByRole("button", { name: m.pick_start() }).click();

  await expect(student.locator("table th").first()).toHaveText("Рік");
  await expect(student.locator("pre code")).toHaveText("print(1)");
  expect(
    await student.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1024);
});
