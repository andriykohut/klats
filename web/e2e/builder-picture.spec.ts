import type { Question } from "@klats/shared/generated/testfmt.ts";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Page } from "@playwright/test";
import { expect, type Klats, m, test } from "./fixtures";

/** A `w`×`h` PNG drawn in the page: three shapes on a cream ground. */
async function scene(page: Page, w = 800, h = 600): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ w, h }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = "#f4f1ea";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#e04848";
      ctx.fillRect(w * 0.1, h * 0.2, w * 0.25, h * 0.33);
      ctx.fillStyle = "#2f6fd6";
      ctx.fillRect(w * 0.42, h * 0.13, w * 0.3, h * 0.3);
      ctx.fillStyle = "#2aa16a";
      ctx.beginPath();
      ctx.arc(w * 0.78, h * 0.72, h * 0.2, 0, 2 * Math.PI);
      ctx.fill();
      const blob = await new Promise<Blob | null>((done) =>
        canvas.toBlob(done, "image/png"),
      );
      if (!blob) throw new Error("the canvas produced no image");
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { w, h },
  );
  return Buffer.from(bytes);
}

/** Opens a new test in the builder with the preview showing. */
async function newTest(klats: Klats) {
  const page = await klats.teacher("/");
  await page.getByRole("button", { name: m.tests_new() }).click();
  await expect(page).toHaveURL(/\/tests\/.+/);
  await page.getByRole("button", { name: m.builder_preview_show() }).click();
  return page;
}

/** Adds a question of the type whose picker description is `desc`. */
async function add(page: Page, desc: () => string) {
  await page.getByRole("button", { name: m.builder_add_question() }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: desc(), exact: false })
    .click();
}

/** The test document as last saved, read through the page's own session. */
async function saved(page: Page): Promise<TestDoc> {
  const id = new URL(page.url()).pathname.split("/").pop();
  return page.evaluate(
    async (id) => (await fetch(`/api/tests/${id}`)).json(),
    id,
  );
}

/** The first question as last saved, once the page says it is. */
async function question(page: Page): Promise<Question> {
  await expect(page.getByText(m.builder_saved())).toBeVisible();
  return (await saved(page)).test.questions[0];
}

const editor = (page: Page) => page.getByRole("main");
const preview = (page: Page) =>
  page.getByRole("complementary", { name: m.builder_preview() });
const field = (page: Page, name: string) =>
  editor(page).getByRole("textbox", { name, exact: true });
const picture = (page: Page) =>
  editor(page).getByRole("group", { name: m.builder_picture(), exact: true });

/** Picks a drawn scene in the image dialog and waits for it to show. */
async function addPicture(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await editor(page)
    .getByRole("button", { name: m.builder_picture_add() })
    .click();
  await (await chooser).setFiles({
    name: "scene.png",
    mimeType: "image/png",
    buffer: await scene(page),
  });
  await expect(picture(page).locator("img")).toBeVisible();
}

/** Drags across the picture from (`x0`, `y0`) to (`x1`, `y1`), as fractions of it. */
async function drag(
  page: Page,
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
) {
  const box = await picture(page).boundingBox();
  if (!box) throw new Error("no picture");
  const at = (x: number, y: number) =>
    [box.x + x * box.width, box.y + y * box.height] as const;
  await page.mouse.move(...at(x0, y0));
  await page.mouse.down();
  await page.mouse.move(...at((x0 + x1) / 2, (y0 + y1) / 2), { steps: 4 });
  await page.mouse.move(...at(x1, y1), { steps: 4 });
  await page.mouse.up();
}

const near = (v: number | undefined, want: number) =>
  expect(Math.abs((v ?? 99) - want)).toBeLessThan(0.01);

test("a hotspot question saves the area drawn on its picture, and every number stays inside the picture", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_hotspot_desc);
  await field(page, m.builder_question_text()).fill("Де квадрат?");
  await addPicture(page);
  await expect(preview(page).locator("img")).toBeVisible();

  await drag(page, [0.2, 0.2], [0.4, 0.4]);
  const areaX = page.getByRole("textbox", {
    name: m.builder_area_x({ number: 1 }),
  });
  await expect(areaX).toHaveValue("20");
  let q = await question(page);
  expect(q.type).toBe("hotspot");
  expect(q.areas).toHaveLength(1);
  expect(q.areas?.[0].shape).toBe("rect");
  near(q.areas?.[0].x, 0.2);
  near(q.areas?.[0].y, 0.2);
  near(q.areas?.[0].w, 0.2);
  near(q.areas?.[0].h, 0.2);

  // The percentages are the keyboard's way: a value too big for the picture
  // is pulled back so the box stays inside it.
  await areaX.fill("150");
  await areaX.press("Enter");
  await expect(areaX).toHaveValue("80");
  await expect
    .poll(async () => (await question(page)).areas?.[0].x)
    .toBeCloseTo(0.8, 2);
  await areaX.press("ArrowDown");
  await expect(areaX).toHaveValue("79");

  // A second area, drawn as an ellipse.
  await editor(page)
    .getByRole("radio", { name: m.builder_shape_ellipse() })
    .click();
  await drag(page, [0.1, 0.5], [0.3, 0.9]);
  await expect
    .poll(async () => (await question(page)).areas?.map((a) => a.shape))
    .toEqual(["rect", "ellipse"]);

  // «Додати область» makes one at the centre, for the keyboard to place.
  await editor(page)
    .getByRole("button", { name: m.builder_add_area() })
    .click();
  await expect(
    page.getByRole("textbox", { name: m.builder_area_x({ number: 3 }) }),
  ).toBeFocused();
  await expect.poll(async () => (await question(page)).areas?.length).toBe(3);

  // Removing an area can be undone.
  await editor(page)
    .getByRole("button", {
      name: m.builder_item_delete({ item: m.builder_area({ number: 2 }) }),
    })
    .click();
  await expect.poll(async () => (await question(page)).areas?.length).toBe(2);
  await page.getByRole("button", { name: m.action_undo() }).click();
  await expect.poll(async () => (await question(page)).areas?.length).toBe(3);

  // So can removing the picture.
  await editor(page)
    .getByRole("button", { name: m.builder_picture_remove() })
    .click();
  await expect(picture(page).locator("img")).toHaveCount(0);
  await expect.poll(async () => (await question(page)).image).toBeUndefined();
  await page.getByRole("button", { name: m.action_undo() }).click();
  await expect(picture(page).locator("img")).toBeVisible();
  q = await question(page);
  expect(q.image?.src).toMatch(/\.png$/);
  expect(q.image?.w).toBe(800);
  expect(q.areas).toHaveLength(3);
});

test("a picture dropped on a hotspot question is added", async ({
  klats,
  browserName,
}) => {
  test.skip(
    browserName === "firefox",
    "Firefox leaves the files of a script-made DataTransfer empty",
  );
  const page = await newTest(klats);
  await add(page, m.type_hotspot_desc);
  const bytes = [...(await scene(page, 320, 200))];
  await editor(page)
    .getByRole("button", { name: m.builder_picture_add() })
    .evaluate((el, bytes) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], "drop.png", { type: "image/png" }),
      );
      el.closest("[data-drop]")?.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, bytes);
  await expect(picture(page).locator("img")).toBeVisible();
  expect((await question(page)).image?.w).toBe(320);
});

test("a label question saves its points where they were put, each with the label of its own", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_label_desc);
  await field(page, m.builder_question_text()).fill("Підпишіть фігури");
  await addPicture(page);

  // A click on the picture puts a point there.
  const box = await picture(page).boundingBox();
  if (!box) throw new Error("no picture");
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.35);
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.3);
  const pin = (n: number) =>
    picture(page).getByRole("button", {
      name: m.point_label({ number: n }),
      exact: true,
    });
  await expect(pin(2)).toBeVisible();
  const label = (n: number) =>
    field(page, m.builder_point_label({ number: n }));
  await label(1).fill("Квадрат");
  await label(2).fill("Прямокутник");
  await editor(page)
    .getByRole("button", { name: m.builder_add_label_decoy() })
    .click();
  await field(page, m.builder_label_decoy({ number: 1 })).fill("Трикутник");

  // «Додати точку» puts one at the centre, and the arrows move the selected
  // point by 1% each.
  await editor(page)
    .getByRole("button", { name: m.builder_add_point() })
    .click();
  await expect(pin(3)).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await label(3).fill("Круг");

  // A point dragged to a new place stays there.
  await pin(2).hover();
  const from = await pin(2).boundingBox();
  if (!from) throw new Error("no point");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 40, from.y + 30, {
    steps: 5,
  });
  await page.mouse.up();

  await expect(preview(page).getByText("Трикутник")).toBeVisible();
  await expect
    .poll(async () => (await question(page)).targets?.[1]?.x)
    .toBeGreaterThan(0.55 + 0.04);
  const q = await question(page);
  expect(q.type).toBe("label");
  const [p1, p2, p3] = q.targets ?? [];
  expect(q.targets).toHaveLength(3);
  near(p1.x, 0.2);
  near(p1.y, 0.35);
  expect(p2.y).toBeGreaterThan(0.3 + 0.03);
  near(p3.x, 0.53);
  near(p3.y, 0.49);
  const text = (o: { content: unknown }) =>
    JSON.stringify(o.content).match(/"text":"([^"]*)"/)?.[1];
  expect(q.options).toHaveLength(4);
  expect(q.options.map((o) => [text(o), o.target])).toEqual(
    expect.arrayContaining([
      ["Квадрат", p1.id],
      ["Прямокутник", p2.id],
      ["Круг", p3.id],
      ["Трикутник", undefined],
    ]),
  );

  // Removing a point takes its label with it, and an undo gives both back.
  await editor(page)
    .getByRole("button", {
      name: m.builder_item_delete({ item: m.point_label({ number: 3 }) }),
    })
    .click();
  await expect(pin(3)).toHaveCount(0);
  await expect
    .poll(async () => {
      const x = await question(page);
      return [x.targets?.length, x.options.length];
    })
    .toEqual([2, 3]);
  await page.getByRole("button", { name: m.action_undo() }).click();
  await expect(label(3)).toHaveText("Круг");
  await expect(pin(3)).toBeVisible();
});

test("a highlight question saves the target mark on the marked words, and the preview shows words", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_highlight_desc);
  await field(page, m.builder_question_text()).fill("Знайдіть прислівник");
  const body = field(page, m.builder_highlight_body());
  await body.click();
  await page.keyboard.type("Небо яскраво світить");

  // Mod-K right after Shift+Arrow marks the whole selected word: ProseMirror
  // learns of the new selection only after the key.
  for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    editor(page).getByText(m.builder_highlight_count({ count: 1 })),
  ).toBeVisible();

  // A word marked in part counts as marked.
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    editor(page).getByText(m.builder_highlight_count({ count: 2 })),
  ).toBeVisible();
  // The same key unmarks it.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    editor(page).getByText(m.builder_highlight_count({ count: 1 })),
  ).toBeVisible();

  const words = preview(page).locator("button.k-word");
  await expect(words).toHaveText(["Небо", "яскраво", "світить"]);
  const q = await question(page);
  expect(q.type).toBe("highlight");
  const marked: string[] = [];
  const walk = (n: {
    text?: string;
    marks?: { type: string }[];
    content?: unknown[];
  }) => {
    if (n.marks?.some((x) => x.type === "target")) marked.push(n.text ?? "");
    for (const c of n.content ?? []) walk(c as typeof n);
  };
  walk(q.body as never);
  expect(marked).toEqual(["яскраво"]);
});

test("a written-answer question saves the marking notes, which students never get", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_open_desc);
  await field(page, m.builder_question_text()).fill("Поясніть, чому");
  const rubric = editor(page).getByRole("textbox", {
    name: m.builder_rubric(),
  });
  await expect(rubric).toHaveAttribute("maxlength", "2000");
  await rubric.fill("Згадати тертя й опір повітря");
  await expect(preview(page).getByText("Поясніть, чому")).toBeVisible();
  await expect(preview(page).getByText("тертя")).toHaveCount(0);
  const q = await question(page);
  expect(q.type).toBe("open");
  expect(q.rubric).toBe("Згадати тертя й опір повітря");
});
