import type { Question } from "@klats/shared/generated/testfmt.ts";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Page } from "@playwright/test";
import { expect, joinAs, type Klats, m, test, until } from "./fixtures";

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

/** The text of the nodes of a highlight question's body that carry the target mark. */
function marked(q: Question): string[] {
  const out: string[] = [];
  const walk = (n: {
    text?: string;
    marks?: { type: string }[];
    content?: unknown[];
  }) => {
    if (n.marks?.some((x) => x.type === "target")) out.push(n.text ?? "");
    for (const c of n.content ?? []) walk(c as typeof n);
  };
  walk(q.body as never);
  return out;
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

  // Dragging an area moves it and leaves its size.
  await drag(page, [0.3, 0.3], [0.5, 0.4]);
  await expect(areaX).toHaveValue("40");
  await expect
    .poll(async () => (await question(page)).areas?.[0].x)
    .toBeGreaterThan(0.35);
  q = await question(page);
  near(q.areas?.[0].x, 0.4);
  near(q.areas?.[0].y, 0.3);
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
  // Focus goes to the neighbouring area's first field.
  await expect(areaX).toBeFocused();
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

/**
 * A 4:3 drawing that sets only its viewBox: a blue square around (25%, 40%),
 * and a script that marks the page it runs in.
 */
const DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<rect width="400" height="300" fill="#f4f1ea"/>
<rect x="40" y="60" width="120" height="120" fill="#2f6fd6"/>
<script>document.documentElement.setAttribute("data-ran", "")</script>
</svg>`;

test("an SVG with only a viewBox keeps its shape on the student's sheet, takes clicks where they land, and runs no script opened directly", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_hotspot_desc);
  await field(page, m.builder_question_text()).fill("Де квадрат?");
  const chooser = page.waitForEvent("filechooser");
  await editor(page)
    .getByRole("button", { name: m.builder_picture_add() })
    .click();
  await (await chooser).setFiles({
    name: "drawing.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(DRAWING),
  });
  await expect(picture(page).locator("img")).toBeVisible();
  await drag(page, [0.1, 0.2], [0.4, 0.6]);
  await expect.poll(async () => (await question(page)).areas?.length).toBe(1);

  await page.reload();
  await expect(picture(page).locator("img")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: m.builder_area_x({ number: 1 }) }),
  ).toHaveValue("10");
  const q = (await saved(page)).test.questions[0];
  const src = q.image?.src ?? "";
  expect(src).toMatch(/\.svg$/);
  expect((q.image?.w ?? 0) / (q.image?.h ?? 1)).toBeCloseTo(4 / 3, 2);

  const { code, assignmentId } = await klats.start([
    { ...q, title: "Де квадрат?" },
  ]);
  const student = await klats.computer();
  await joinAs(student, klats, code, "Коваль Максим");
  const img = student
    .getByRole("group", { name: "Де квадрат?" })
    .locator("img");
  // Layout sizes, which the sheet's entry animation does not transform.
  const [w, h] = await img.evaluate((el: HTMLImageElement) => [
    el.offsetWidth,
    el.offsetHeight,
  ]);
  expect(w / h).toBeCloseTo(4 / 3, 1);
  await img.click({ position: { x: w * 0.25, y: h * 0.4 } });
  await expect(student.locator(".k-marker")).toBeVisible();
  await student.getByRole("button", { name: m.test_finish() }).click();
  await student.getByRole("button", { name: m.review_finish() }).click();
  await until(klats, (live) => live.rows[0]?.status === "finished");
  expect((await klats.results(assignmentId)).rows[0].points).toEqual([1]);

  const studentURL = `${klats.student}/api/media/${src}`;
  for (const [p, url] of [
    [student, studentURL],
    [page, `${new URL(page.url()).origin}/api/media/${src}`],
  ] as const) {
    await p.goto(url);
    expect(
      await p.evaluate(() => document.documentElement.hasAttribute("data-ran")),
    ).toBe(false);
  }
  const res = await fetch(studentURL);
  expect(res.headers.get("content-type")).toBe("image/svg+xml");
  expect(res.headers.get("content-security-policy")).toBe("sandbox");
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

test("a picture pasted after a click on the empty picture field is added", async ({
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
  const zone = editor(page).locator("[data-drop]");
  await zone.click({ position: { x: 4, y: 4 } });
  await expect(zone).toBeFocused();
  await page.evaluate((bytes) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array(bytes)], "shot.png", { type: "image/png" }),
    );
    document.activeElement?.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, bytes);
  await expect(picture(page).locator("img")).toBeVisible();
  expect((await question(page)).image?.w).toBe(320);
});

test("a file that is not a picture, dropped on the empty picture field, is not opened by the browser", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_hotspot_desc);
  const prevented = await editor(page)
    .locator("[data-drop]")
    .evaluate((el) => {
      const data = new DataTransfer();
      data.items.add(new File(["x"], "notes.txt", { type: "text/plain" }));
      const drop = new DragEvent("drop", {
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(drop);
      return drop.defaultPrevented;
    });
  expect(prevented).toBe(true);
  await expect(picture(page).locator("img")).toHaveCount(0);
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
  await expect(label(2)).toBeFocused();
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
  expect(marked(q)).toEqual(["яскраво"]);
});

test("Mod-K leaves the space of a selected word unmarked, and marks a partly marked word all through before it clears it", async ({
  klats,
}) => {
  const page = await newTest(klats);
  await add(page, m.type_highlight_desc);
  const body = field(page, m.builder_highlight_body());
  await body.click();
  await page.keyboard.type("Небо тихо ");
  const press = async (key: string, n: number) => {
    for (let i = 0; i < n; i++) await page.keyboard.press(key);
  };
  const markedNow = async () => marked(await question(page));

  // «тихо » as a double click may select it, trailing space and all.
  await press("Shift+ArrowLeft", 5);
  await page.keyboard.press("ControlOrMeta+k");
  await expect.poll(markedNow).toEqual(["тихо"]);

  // The selection is the word without its space: two steps pass the space.
  await press("ArrowRight", 2);
  await page.keyboard.type("світить");
  await press("ArrowLeft", 3);
  await press("Shift+ArrowLeft", 4);
  await page.keyboard.press("ControlOrMeta+k");
  await expect.poll(markedNow).toEqual(["тихо", "світ"]);

  // The whole of «світить»: the first press marks all of it, the second clears it.
  await page.keyboard.press("ArrowRight");
  await press("ArrowRight", 3);
  await press("Shift+ArrowLeft", 7);
  await page.keyboard.press("ControlOrMeta+k");
  await expect.poll(markedNow).toEqual(["тихо", "світить"]);
  await page.keyboard.press("ControlOrMeta+k");
  await expect.poll(markedNow).toEqual(["тихо"]);
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
