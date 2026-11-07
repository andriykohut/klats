import type { Page } from "@playwright/test";
import { CLASS, expect, joinAs, question, test, until } from "./fixtures";

/** Five one-point questions whose right answer is «так». */
const FIVE = [1, 2, 3, 4, 5].map((n) =>
  question(`q${n}`, `Питання номер ${n}`, ["*так", "ні"]),
);

/**
 * Checks a journal of two students who each got 2 questions: the columns are
 * numbered 1 and 2, each row has 2 cells, there is no class row under them,
 * and the first student's first cell names its question in the test.
 */
async function expectOwnColumns(page: Page) {
  const table = page.locator(".j-table");
  await expect(table.locator("thead .j-q")).toHaveText(["1", "2"]);
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    await expect(row.locator(".j-cell")).toHaveCount(2);
  }
  await expect(table.locator("tfoot")).toHaveCount(0);
  await expect(rows.first().locator("td.j-q").first()).toHaveAttribute(
    "title",
    /у тесті/,
  );
}

test("a drawn sitting shows each student's own questions", async ({
  klats,
}) => {
  const { code, assignmentId } = await klats.start(FIVE, {
    settings: { draw: [{ tag: "", count: 2 }] },
  });

  for (const name of CLASS.slice(0, 2)) {
    const page = await klats.computer();
    await joinAs(page, klats, code, name);
    await page.getByText("так", { exact: true }).click();
    await expect(page.getByRole("radio", { name: "так" })).toBeChecked();
  }
  await until(
    klats,
    (live) =>
      live.rows.length === 2 &&
      live.rows.every((r) => r.cells[0] === "correct"),
  );

  await expectOwnColumns(await klats.teacher("/live"));
  await expectOwnColumns(await klats.teacher(`/assignments/${assignmentId}`));
});
