import { CLASS, expect, joinAs, m, question, test, until } from "./fixtures";

test("results show scores per tag", async ({ klats }) => {
  // «Мережі» holds 3 + 1 points and «Урок 9» 1 + 1; the student answers only
  // the first question, rightly.
  const { code, assignmentId } = await klats.start([
    {
      ...question("q1", "Що таке мережа?", ["*так", "ні"], 3),
      tags: ["Мережі"],
    },
    {
      ...question("q2", "Що таке IP-адреса?", ["*так", "ні"]),
      tags: ["Мережі", "Урок 9"],
    },
    { ...question("q3", "Що таке DNS?", ["*так", "ні"]), tags: ["Урок 9"] },
  ]);
  const page = await klats.computer();
  await joinAs(page, klats, code, CLASS[0]);
  await page.getByText("так", { exact: true }).click();
  await until(klats, (live) => live.rows[0]?.cells[0] === "correct");

  const results = await klats.teacher(`/assignments/${assignmentId}`);
  await expect(
    results.getByRole("heading", { name: m.results_tags() }),
  ).toBeVisible();
  const rows = results.locator(".r-tags li");
  await expect(rows.locator(".r-tags-name")).toHaveText([
    "# Мережі",
    "# Урок 9",
  ]);
  await expect(rows.locator("b")).toHaveText(["75%", "0%"]);
});

test("results of a test without tags show no scores per tag", async ({
  klats,
}) => {
  const { assignmentId } = await klats.start();
  const results = await klats.teacher(`/assignments/${assignmentId}`);
  await expect(
    results.getByRole("heading", { name: "Інформатика" }),
  ).toBeVisible();
  await expect(
    results.getByRole("heading", { name: m.results_tags() }),
  ).toHaveCount(0);
});
