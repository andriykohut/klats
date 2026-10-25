import { crc32, deflateSync } from "node:zlib";
import type { Locator } from "@playwright/test";
import { doc, expect, joinAs, m, questionOf, test, until } from "./fixtures";

const WIDTH = 1600;
const HEIGHT = 1200;

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/** A WIDTH×HEIGHT grey PNG, the size of a phone photo the builder keeps. */
function png(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const rows = Buffer.alloc((WIDTH + 1) * HEIGHT, 0xc0); // filter byte 0, then grey
  for (let y = 0; y < HEIGHT; y++) rows[y * (WIDTH + 1)] = 0;
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Clicks `fraction` of the way across and down the image, once the sheet has
 * stopped moving: its entry animation scales it, and a box measured during
 * that is not the one the click lands on.
 */
async function clickAt(img: Locator, fraction: number) {
  let box = await img.boundingBox();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const now = await img.boundingBox();
    if (JSON.stringify(now) === JSON.stringify(box)) break;
    box = now;
  }
  if (!box) throw new Error("the image has no box");
  await img.click({
    position: { x: box.width * fraction, y: box.height * fraction },
  });
}

const text = (t: string, ...marks: string[]) => ({
  type: "text",
  text: t,
  ...(marks.length && { marks: marks.map((type) => ({ type })) }),
});
const option = (id: string, label: string, target = "") => ({
  id,
  content: doc(label),
  correct: false,
  target,
});
const point = (id: string, x: number, y: number) => ({
  id,
  content: doc(""),
  x,
  y,
});

test("hotspot, labels, highlight and a written answer, with the pending finish", async ({
  klats,
}) => {
  const src = await klats.upload(png());
  const image = { src, w: WIDTH, h: HEIGHT };
  const hotspot = questionOf("hotspot", "q1", "Клацніть на сонце", {
    image,
    areas: [{ id: "a1", shape: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
  });
  const label = questionOf("label", "q2", "Підпишіть частини малюнка", {
    points: 3,
    image,
    targets: [
      point("p1", 0.2, 0.3),
      point("p2", 0.5, 0.6),
      point("p3", 0.8, 0.3),
    ],
    options: [
      option("l1", "Сонце", "p1"),
      option("l2", "Хмара", "p2"),
      option("l3", "Птах", "p3"),
      option("l4", "Місяць"),
    ],
  });
  const highlight = questionOf("highlight", "q3", "", {
    points: 2,
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            text("Сонце світить "),
            text("яскраво", "target"),
            text(", а вітер дме "),
            text("холодно", "target"),
            text("."),
          ],
        },
      ],
    },
  });
  const open = questionOf("open", "q4", "Опишіть погоду", {
    points: 2,
    rubric: "Два речення",
  });
  const { code, assignmentId } = await klats.start([
    hotspot,
    label,
    highlight,
    open,
  ]);

  const page = await klats.computer();
  await joinAs(page, klats, code, "Бондаренко Олена");
  const next = page.getByRole("button", { name: m.test_next() });

  // Hotspot: the arrow keys and Enter set a point without moving on, and a
  // click inside the area at 29% of the scaled image replaces it.
  const area = page.getByRole("group", { name: hotspot.title });
  const img = area.locator("img");
  await expect(next).toBeDisabled();
  await area.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(next).toBeEnabled();
  await expect(area).toBeVisible();
  await clickAt(img, 0.29);
  await expect(area.locator(".k-marker")).toBeVisible();
  await next.click();

  // Labels: two right and the decoy on the third point. A slot shows its
  // number until a label sits on it.
  const tray = page.getByRole("grid", { name: m.cards_tray() });
  const place = async (card: string, slot: string) => {
    await tray.getByRole("row", { name: card }).click();
    await page
      .getByRole("button", {
        name: m.card_place({ slot: m.point_label({ number: Number(slot) }) }),
      })
      .click();
  };
  await expect(next).toBeDisabled();
  await place("Сонце", "1");
  await place("Хмара", "2");
  await expect(next).toBeDisabled();
  await place("Місяць", "3");
  await expect(next).toBeEnabled();
  await expect(
    page
      .getByRole("grid", { name: m.point_label({ number: 3 }) })
      .getByRole("row", { name: "Місяць" }),
  ).toBeVisible();
  await next.click();

  // Highlight: one tab stop, so the arrows move between words and Space toggles.
  const word = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await expect(next).toBeDisabled();
  await word("яскраво").click();
  await expect(word("яскраво")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(word("вітер")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(word("вітер")).toHaveAttribute("aria-pressed", "true");
  await word("холодно").click();
  await expect(word("холодно")).toHaveAttribute("aria-pressed", "true");
  await expect(word("дме")).toHaveAttribute("aria-pressed", "false");
  await next.click();

  // Written answer: Enter is a new line, the counter counts characters, and
  // 5,000 of them are the most the field takes.
  const box4 = page.getByRole("textbox", { name: open.title });
  await box4.fill("а");
  await box4.press("Enter");
  await expect(box4).toHaveValue("а\n");
  await box4.fill("ж".repeat(5000));
  await expect(
    page.getByText(m.open_count({ count: 5000, max: 5000 })),
  ).toBeVisible();
  await box4.pressSequentially("з");
  await expect(box4).toHaveValue("ж".repeat(5000));
  await page.getByRole("button", { name: m.test_finish() }).click();
  await page.getByRole("button", { name: m.review_finish() }).click();

  // The written answer waits for the teacher, so no grade shows yet.
  await expect(page.locator(".k-finish-note")).toBeVisible();
  await until(klats, (live) => live.rows[0]?.status === "finished");
  const before = await klats.results(assignmentId);
  expect(before.rows[0].points).toEqual([1, 1, 1, 0]);
  expect(before.rows[0].pending).toBe(1);
  await expect(
    page.getByRole("img", {
      name: m.finish_grade({ grade: before.rows[0].grade }),
    }),
  ).toHaveCount(0);

  // The teacher's points reach the open finish screen without a reload.
  await klats.override(assignmentId, before.rows[0].participantId, "q4", 2);
  const after = await klats.results(assignmentId);
  expect(after.rows[0].points).toEqual([1, 1, 1, 2]);
  await expect(
    page.getByRole("img", {
      name: m.finish_grade({ grade: after.rows[0].grade }),
    }),
  ).toBeVisible();
  await expect(page.locator(".k-finish-note")).toHaveCount(0);

  // A click at 31% of the image is outside the area, which ends at 30%.
  const other = await klats.computer();
  await joinAs(other, klats, code, "Гнатюк Ігор");
  const otherImg = other
    .getByRole("group", { name: hotspot.title })
    .locator("img");
  await clickAt(otherImg, 0.31);
  await other.getByRole("button", { name: m.test_next() }).click();
  for (let i = 0; i < 2; i++) {
    await other.getByRole("button", { name: m.test_skip() }).click();
  }
  await other.getByRole("button", { name: m.test_skip() }).click();
  await other.getByRole("button", { name: m.review_finish() }).click();
  await until(
    klats,
    (live) =>
      live.rows.find((r) => r.name === "Гнатюк Ігор")?.status === "finished",
  );
  const { rows } = await klats.results(assignmentId);
  expect(rows.find((r) => r.name === "Гнатюк Ігор")?.points[0]).toBe(0);
});
