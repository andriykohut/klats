import type { SettingsInfo } from "@klats/shared/generated/wire.ts";
import { expect, m, test } from "./fixtures";

test("the update switch survives a language change and a reload", async ({
  klats,
}) => {
  const page = await klats.teacher("/settings");
  await expect(page.getByText(m.about_version_dev())).toBeVisible();
  await expect(
    page.getByRole("switch", { name: m.about_check_updates() }),
  ).toBeChecked();

  // Every save sends the whole settings, so the language keeps the switch on.
  await page.getByText(m.settings_language_en(), { exact: true }).click();
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Check for updates" });
  await expect(toggle).toBeChecked();
  const saved: SettingsInfo = await page.evaluate(async () =>
    (await fetch("/api/settings")).json(),
  );
  expect(saved).toMatchObject({ language: "en", checkUpdates: true });

  await page.getByText("Check for updates", { exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(toggle).not.toBeChecked();
});
