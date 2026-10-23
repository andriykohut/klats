import { crc32, deflateSync } from "node:zlib";
import { expect, joinAs, m, question, test } from "./fixtures";

const WIDTH = 64;
const HEIGHT = 40;

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/** A WIDTH×HEIGHT grey PNG. */
function png(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  // Each scanline is a filter byte (0) and WIDTH grey samples.
  const rows = Buffer.alloc((WIDTH + 1) * HEIGHT, 0x80);
  for (let y = 0; y < HEIGHT; y++) rows[y * (WIDTH + 1)] = 0;
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** One second of 16-bit mono silence at 8 kHz. */
function wav(): Buffer {
  const samples = Buffer.alloc(16_000);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(36 + samples.length, 4);
  head.write("WAVEfmt ", 8, "latin1");
  head.writeUInt32LE(16, 16); // fmt chunk size
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(8000, 24); // sample rate
  head.writeUInt32LE(16_000, 28); // byte rate
  head.writeUInt16LE(2, 32); // block align
  head.writeUInt16LE(16, 34); // bits per sample
  head.write("data", 36, "latin1");
  head.writeUInt32LE(samples.length, 40);
  return Buffer.concat([head, samples]);
}

const text = (...content: unknown[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});
const words = (s: string) => ({ type: "text", text: s });

test("images and audio are shown after the network drops", async ({
  klats,
}) => {
  const picture = await klats.upload(png());
  const sound = await klats.upload(wav());

  const q1 = question("q1", "Що на малюнку?", ["Сіре", "*Прямокутник"]);
  q1.text = text(words("Що на малюнку? "), {
    type: "image",
    attrs: { src: picture, w: WIDTH, h: HEIGHT },
  });
  const q2 = question("q2", "Що ви чуєте?", ["Тишу", "*Нічого"]);
  q2.text = text(words("Що ви чуєте? "), {
    type: "audio",
    attrs: { src: sound },
  });
  q2.options[1].image = { src: picture, w: WIDTH, h: HEIGHT };

  const { code } = await klats.start([q1, q2]);
  const page = await klats.computer();
  const pictureLoaded = page.waitForResponse((r) => r.url().endsWith(picture));
  const soundLoaded = page.waitForResponse((r) => r.url().endsWith(sound));
  await joinAs(page, klats, code, "Коваль Максим");
  await Promise.all([
    pictureLoaded.then((r) => r.finished()),
    soundLoaded.then((r) => r.finished()),
  ]);

  const shown = page.locator(".k-qtext img");
  await expect(shown).toHaveAttribute("src", /^blob:/);
  await page.context().setOffline(true);

  expect(await shown.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(
    WIDTH,
  );

  await page.getByRole("button", { name: m.test_skip() }).click();
  await expect(page.getByText("0:00 / 0:01", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: m.audio_play() }).click();
  await expect(
    page.getByRole("button", { name: m.audio_pause() }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan(0);

  const option = page.locator("[data-option] img");
  await expect(option).toHaveCount(1);
  await expect
    .poll(() => option.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBe(WIDTH);
});
