import type { Image } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { ApiError, postMedia } from "../../api/client";

/*
 * Getting a teacher's picture or recording into the media store. Pictures are
 * shrunk first, so a phone photo costs the lab network a few hundred KB, not
 * several MB. An SVG is stored as it came, since redrawing would lose its
 * sharpness at any size.
 */

/** The longest side, in pixels, a stored image may have. */
const MAX_SIDE = 1600;
/** The largest file, in bytes, that is stored as it came. */
const KEEP_BYTES = 1 << 20;
const KEEP_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const QUALITY = 0.85;

/** Why a file could not be added: its format, its size, or anything else. */
export class MediaError extends Error {
  readonly code: "unsupported" | "too_large" | "failed";

  constructor(code: MediaError["code"]) {
    super(code);
    this.code = code;
  }
}

/** Returns `w`×`h` with its long side scaled down to `max`; it never scales up. */
export function fitSize(
  w: number,
  h: number,
  max = MAX_SIDE,
): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * Reports whether an image can be stored as it came: a JPEG, PNG, WebP or
 * GIF of at most 1 MiB and 1600 px a side. Keeping small files untouched keeps
 * small GIFs animated.
 */
export function keepOriginal(
  type: string,
  bytes: number,
  w: number,
  h: number,
): boolean {
  return (
    KEEP_TYPES.includes(type) &&
    bytes <= KEEP_BYTES &&
    Math.max(w, h) <= MAX_SIDE
  );
}

/**
 * Returns the size to store for an SVG, fitted by {@link fitSize}: its
 * `natural` size when both sides are above 0, else the width and height of
 * its root's `viewBox` attribute, else 300×150, the browser default.
 */
export function svgSize(
  natural: { w: number; h: number },
  viewBox: string | null,
): { w: number; h: number } {
  if (natural.w > 0 && natural.h > 0) return fitSize(natural.w, natural.h);
  const box = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) {
    return fitSize(box[2], box[3]);
  }
  return { w: 300, h: 150 };
}

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((done) => canvas.toBlob(done, type, QUALITY));

/**
 * Decodes `file` and returns the image to upload with its size in pixels: an
 * SVG as it came, sized by {@link svgSize}; `file` itself when
 * {@link keepOriginal} allows; else the picture redrawn at {@link fitSize} as
 * WebP, or as JPEG over white where the browser cannot encode WebP. Rejects
 * with `MediaError("unsupported")` when the browser cannot decode the file,
 * as with HEIC.
 */
export async function prepareImage(
  file: Blob,
): Promise<{ blob: Blob; w: number; h: number }> {
  if (file.type === "image/svg+xml") {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new MediaError("unsupported");
    } finally {
      URL.revokeObjectURL(url);
    }
    const natural = { w: img.naturalWidth, h: img.naturalHeight };
    const viewBox =
      natural.w > 0 && natural.h > 0
        ? null
        : new DOMParser()
            .parseFromString(await file.text(), "image/svg+xml")
            .documentElement.getAttribute("viewBox");
    return { blob: file, ...svgSize(natural, viewBox) };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new MediaError("unsupported");
  }
  try {
    if (keepOriginal(file.type, file.size, bitmap.width, bitmap.height)) {
      return { blob: file, w: bitmap.width, h: bitmap.height };
    }
    const { w, h } = fitSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new MediaError("failed");
    ctx.drawImage(bitmap, 0, 0, w, h);
    let blob = await encode(canvas, "image/webp");
    if (blob?.type !== "image/webp") {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      blob = await encode(canvas, "image/jpeg");
    }
    if (!blob) throw new MediaError("failed");
    return { blob, w, h };
  } finally {
    bitmap.close();
  }
}

/**
 * Uploads `blob` and resolves to its media name. Rejects with a
 * {@link MediaError}: "unsupported" for a type the server does not store,
 * "too_large" for a file over its cap, and "failed" for anything else.
 */
export async function uploadMedia(blob: Blob): Promise<string> {
  try {
    return await postMedia(blob);
  } catch (err) {
    if (err instanceof ApiError && err.status === 415) {
      throw new MediaError("unsupported");
    }
    if (err instanceof ApiError && err.status === 413) {
      throw new MediaError("too_large");
    }
    throw new MediaError("failed");
  }
}

/** Shrinks (unless it is an SVG) and uploads the image `file`, and returns it as an option or question image. */
export async function addImage(file: Blob): Promise<Image> {
  const { blob, w, h } = await prepareImage(file);
  return { src: await uploadMedia(blob), w, h };
}

/** Returns the message telling the teacher why adding a file failed. */
export function mediaMessage(err: unknown): string {
  const code = err instanceof MediaError ? err.code : "failed";
  if (code === "unsupported") return m.media_unsupported();
  if (code === "too_large") return m.media_too_large();
  return m.media_failed();
}
