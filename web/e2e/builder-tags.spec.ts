import type { Test } from "@klats/shared/generated/testfmt.ts";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Page } from "@playwright/test";
import { expect, m, question, test } from "./fixtures";

const THREE = Array.from({ length: 3 }, (_, i) =>
  question(`q${i + 1}`, `Питання ${i + 1}`, ["*так", "ні"]),
);

/** The first of {@link THREE} tagged «Мережі». */
const TAGGED = [{ ...THREE[0], tags: ["Мережі"] }, ...THREE.slice(1)];

/** The test as last saved, read through the page's own session. */
async function saved(page: Page, id: string): Promise<Test> {
  const doc: TestDoc = await page.evaluate(
    async (id) => (await fetch(`/api/tests/${id}`)).json(),
    id,
  );
  return doc.test;
}

/** Each saved question's tags, an empty list for a question without any. */
async function savedTags(page: Page, id: string): Promise<string[][]> {
  return (await saved(page, id)).questions.map((q) => q.tags ?? []);
}

/** The builder's question list, its «Показати» select and the editor's tags button. */
function parts(page: Page) {
  const column = page.getByRole("region", { name: m.builder_questions() });
  return {
    list: page.getByRole("listbox", { name: m.builder_questions() }),
    show: column.getByRole("button", { name: m.tags_show() }),
    tags: page.getByRole("main").getByRole("button", { name: m.tags_button() }),
  };
}

/** Sets the list's «Показати» to the tag `tag`. */
async function showTag(page: Page, tag: string) {
  await parts(page).show.click();
  await page.getByRole("option", { name: m.tags_show_tag({ tag }) }).click();
}

test("a teacher tags a question, filters the list, and new questions get the tag", async ({
  klats,
}) => {
  const id = await klats.create(THREE);
  const page = await klats.teacher(`/tests/${id}`);
  const { list, show, tags } = parts(page);
  await expect(list.getByRole("option")).toHaveCount(3);
  await expect(show).toHaveCount(0);

  await tags.click();
  const field = page.getByRole("combobox", { name: m.tags_field() });
  await field.fill("Мережі");
  await field.press("Enter");
  await page.keyboard.press("Escape");
  await expect(tags).toContainText("Мережі");
  await expect(list.getByRole("option").first()).toContainText("Мережі");
  await expect(show).toBeVisible();

  await showTag(page, "Мережі");
  await expect(list.locator(".b-qi-n")).toHaveText(["1"]);
  await expect(
    page.getByText(m.tags_new_hint({ tag: "Мережі" }), { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: m.builder_add_question() }).click();
  await page
    .getByRole("button", { name: m.type_single_desc(), exact: false })
    .click();
  await expect(list.locator(".b-qi-n")).toHaveText(["1", "2"]);
  await expect
    .poll(() => savedTags(page, id))
    .toEqual([["Мережі"], ["Мережі"], [], []]);

  // The new question is the last «Мережі» row, and an untagged one follows it in the test.
  await page.getByRole("button", { name: m.builder_delete_question() }).click();
  await expect(list.locator(".b-qi-n")).toHaveText(["1"]);
  await expect(tags).toContainText("Мережі");
});

test("a pasted question gets the filtered tag", async ({ klats }) => {
  const id = await klats.create(TAGGED);
  const page = await klats.teacher(`/tests/${id}`);
  await showTag(page, "Мережі");

  await page.getByRole("button", { name: m.builder_paste() }).click();
  await page
    .getByRole("textbox", { name: m.paste_label() })
    .fill("1. Що таке IP-адреса?\n*а) Адреса пристрою\nб) Пароль\n");
  await page.getByRole("button", { name: m.paste_add({ count: 1 }) }).click();
  await expect
    .poll(() => savedTags(page, id))
    .toEqual([["Мережі"], ["Мережі"], [], []]);
});

test("a question's tags show as a short label", async ({ klats }) => {
  const long = "Урок_10 Безпечне використання Інтернету";
  const id = await klats.create([
    { ...THREE[0], tags: [long, "Мережі"] },
    ...THREE.slice(1),
  ]);
  const page = await klats.teacher(`/tests/${id}`);
  const { tags } = parts(page);
  await expect(tags).toContainText(long);
  await expect(tags).toContainText("+1");
  await expect(tags).not.toContainText("Мережі");
});

test("a tag the test already has is suggested with its count", async ({
  klats,
}) => {
  const id = await klats.create(TAGGED);
  const page = await klats.teacher(`/tests/${id}?q=q2`);
  const { tags } = parts(page);

  await tags.click();
  await page.getByRole("combobox", { name: m.tags_field() }).fill("мер");
  await page.getByRole("option", { name: "Мережі (1)" }).click();
  await page.keyboard.press("Escape");
  await expect(tags).toContainText("Мережі");
  await expect
    .poll(() => savedTags(page, id))
    .toEqual([["Мережі"], ["Мережі"], []]);
});
