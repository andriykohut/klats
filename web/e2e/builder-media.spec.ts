import type { Test } from "@klats/shared/generated/testfmt.ts";
import type { TestDoc } from "@klats/shared/generated/wire.ts";
import type { Page } from "@playwright/test";
import { expect, type Klats, m, test } from "./fixtures";

/** An image of `w`×`h` pixels, drawn in the page and encoded as `type`. */
async function photo(
  page: Page,
  w: number,
  h: number,
  type: "image/jpeg" | "image/png",
): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ w, h, type }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      const fill = ctx.createLinearGradient(0, 0, w, h);
      fill.addColorStop(0, "#2a9d8f");
      fill.addColorStop(1, "#e9c46a");
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
      const blob = await new Promise<Blob | null>((done) =>
        canvas.toBlob(done, type),
      );
      if (!blob) throw new Error("the canvas produced no image");
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { w, h, type },
  );
  return Buffer.from(bytes);
}

/** `seconds` of 16-bit mono silence at 8 kHz. */
function wav(seconds = 1): Buffer {
  const samples = Buffer.alloc(16_000 * seconds);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(36 + samples.length, 4);
  head.write("WAVEfmt ", 8, "latin1");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(8000, 24);
  head.writeUInt32LE(16_000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "latin1");
  head.writeUInt32LE(samples.length, 40);
  return Buffer.concat([head, samples]);
}

/** The start of an HEIC file, which no browser here can decode. */
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
  Buffer.alloc(2000),
]);

/** Presses the button named `name` and answers the file chooser it opens with `file`. */
async function attach(
  page: Page,
  name: string,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name, exact: true }).click();
  await (await chooser).setFiles(file);
}

/** Opens a new test with one single-choice question in the builder. */
async function newQuestion(klats: Klats) {
  const page = await klats.teacher("/");
  await page.getByRole("button", { name: m.tests_new() }).click();
  await page.getByRole("button", { name: m.builder_add_question() }).click();
  await page
    .getByRole("button", { name: m.type_single_desc(), exact: false })
    .click();
  return page;
}

/** The test as last saved, read through the page's own session. */
async function saved(page: Page): Promise<Test> {
  const id = new URL(page.url()).pathname.split("/").pop();
  const doc: TestDoc = await page.evaluate(
    async (id) => (await fetch(`/api/tests/${id}`)).json(),
    id,
  );
  return doc.test;
}

/** A rich-text node as the server stores it. */
interface RichNode {
  type: string;
  attrs?: { src?: string; w?: number; h?: number };
  content?: RichNode[];
}

const nodes = (doc: unknown, type: string): RichNode[] => {
  const found: RichNode[] = [];
  const walk = (n: RichNode) => {
    if (n.type === type) found.push(n);
    n.content?.forEach(walk);
  };
  if (doc) walk(doc as RichNode);
  return found;
};

test("a big photo is stored at most 1600 px wide, and a HEIC file is refused", async ({
  klats,
}) => {
  const page = await newQuestion(klats);
  const text = page.getByRole("textbox", { name: m.builder_question_text() });
  await text.click();
  await page.keyboard.type("Що на фото?");

  await attach(page, m.rich_image(), {
    name: "IMG_0001.jpg",
    mimeType: "image/jpeg",
    buffer: await photo(page, 4000, 3000, "image/jpeg"),
  });
  await expect(text.locator("img")).toBeVisible();

  await expect
    .poll(async () => nodes((await saved(page)).questions[0]?.text, "image"))
    .toHaveLength(1);
  const [image] = nodes((await saved(page)).questions[0].text, "image");
  expect(image.attrs?.w).toBeLessThanOrEqual(1600);
  expect(image.attrs?.h).toBeLessThanOrEqual(1200);
  expect(image.attrs?.src).toMatch(/\.(webp|jpg)$/);

  await attach(page, m.rich_image(), {
    name: "IMG_0002.heic",
    mimeType: "image/heic",
    buffer: HEIC,
  });
  await expect(page.getByText(m.media_unsupported())).toBeVisible();
  await expect(text.locator("img")).toHaveCount(1);
  await page.keyboard.type("!");
  await expect(page.getByText(m.builder_saved())).toBeVisible();
  expect(nodes((await saved(page)).questions[0].text, "image")).toHaveLength(1);
});

test("an image and a sound stay in the question when it is edited", async ({
  klats,
}) => {
  const page = await newQuestion(klats);
  const text = page.getByRole("textbox", { name: m.builder_question_text() });
  await text.click();
  await page.keyboard.type("Послухайте");
  await attach(page, m.rich_image(), {
    name: "small.png",
    mimeType: "image/png",
    buffer: await photo(page, 64, 40, "image/png"),
  });
  await attach(page, m.rich_audio(), {
    name: "tone.wav",
    mimeType: "audio/wav",
    buffer: wav(),
  });
  await expect(text.locator("img")).toBeVisible();
  await expect(text.locator("audio")).toBeAttached();
  await expect
    .poll(async () => nodes((await saved(page)).questions[0]?.text, "audio"))
    .toHaveLength(1);

  await page.reload();
  const again = page.getByRole("textbox", { name: m.builder_question_text() });
  await expect(again.locator("img")).toBeVisible();
  await expect(again.locator("audio")).toBeAttached();
  await again.getByText("Послухайте").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" уважно");
  await expect(page.getByText(m.builder_saved())).toBeVisible();
  const doc = (await saved(page)).questions[0].text;
  expect(nodes(doc, "image")).toHaveLength(1);
  expect(nodes(doc, "audio")).toHaveLength(1);

  await again
    .getByRole("button", { name: m.rich_media_remove() })
    .first()
    .click();
  await expect(again.locator("img")).toHaveCount(0);
});

test("an option picture shows in the preview tile", async ({ klats }) => {
  const page = await newQuestion(klats);
  await page.getByRole("button", { name: m.builder_preview_show() }).click();
  const option = page.getByRole("textbox", {
    name: m.builder_answer_placeholder({ letter: "А" }),
  });
  await option.fill("Коло");
  // Reached by keyboard: Tab from the answer's field, then Enter.
  await option.press("Tab");
  await expect(
    page.getByRole("button", {
      name: m.builder_answer_image({ letter: "А" }),
    }),
  ).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({
    name: "circle.png",
    mimeType: "image/png",
    buffer: await photo(page, 64, 64, "image/png"),
  });

  const row = page.getByRole("listitem").filter({ has: option });
  await expect(row.locator("img")).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: m.builder_preview() })
      .locator("img"),
  ).toBeVisible();
  await expect(page.getByText(m.builder_saved())).toBeVisible();
  const saved1 = (await saved(page)).questions[0].options[0];
  expect(saved1.image?.src).toMatch(/\.png$/);

  await page
    .getByRole("button", {
      name: m.builder_answer_image_remove({ letter: "А" }),
    })
    .click();
  await expect(row.locator("img")).toHaveCount(0);
});

test("a picture pasted into the text splits the paragraph at the caret", async ({
  klats,
  browserName,
}) => {
  test.skip(
    browserName === "firefox",
    "Firefox leaves the files of a script-made DataTransfer empty",
  );
  const page = await newQuestion(klats);
  const text = page.getByRole("textbox", { name: m.builder_question_text() });
  await text.click();
  await page.keyboard.type("AB");
  await page.keyboard.press("ArrowLeft");

  const bytes = [...(await photo(page, 64, 40, "image/png"))];
  await text.evaluate((el, bytes) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array(bytes)], "shot.png", { type: "image/png" }),
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, bytes);

  await expect(text.locator("img")).toBeVisible();
  await expect
    .poll(async () => {
      const doc = (await saved(page)).questions[0]?.text as
        | { content: RichNode[] }
        | undefined;
      return doc?.content.map((n) => n.type);
    })
    .toEqual(["paragraph", "image", "paragraph"]);
});
