import { expect, m, test } from "./fixtures";

test("teacher: a crashed page shows the crash screen and reports it", async ({
  klats,
}) => {
  const page = await klats.teacher("/");
  // A list that is not an array throws while the classes page renders.
  await page.route("**/api/classes", (r) => r.fulfill({ json: {} }));
  const report = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/crash",
  );
  await page.goto(new URL("/classes?from=test", page.url()).href);

  await expect(
    page.getByRole("heading", { name: m.crash_title() }),
  ).toBeVisible();
  await expect(page.getByText("Something went wrong!")).toHaveCount(0);
  const sent = (await report).postDataJSON();
  expect(sent.page).toBe("/classes");
  expect(sent.message).not.toBe("");

  await page.getByRole("button", { name: m.crash_to_tests() }).click();
  await expect(
    page.getByRole("heading", { name: m.tests_empty_title() }),
  ).toBeVisible();

  await page.unroute("**/api/classes");
  await page.goto(new URL("/classes", page.url()).href);
  await expect(
    page.getByRole("heading", { name: m.classes_empty_title() }),
  ).toBeVisible();
});
