/**
 * YAZ-3944 D3: shrink a GIF to a long side, every frame and its delay kept. It runs in the worker
 * (`gifShrinkWorker.ts`), which the build bundles into one string with gifenc.
 *
 * DON'T import anything but gifenc here (`@excalidraw/common` included): the worker has no other code.
 */

// the ES module build: the package's `main` and `browser` files are CommonJS
import { GIFEncoder, applyPalette, quantize } from "gifenc/dist/gifenc.esm.js";

export type GifFrame = { rgba: Uint8ClampedArray; delayMs: number };

/** The frames of one GIF, decoded one at a time. */
export type GifSource = {
  width: number;
  height: number;
  frameCount: number;
  /** As `ImageDecoder` gives it: Infinity loops forever, 0 plays once. */
  repetitionCount: number;
  /** Frame `index`, drawn at `width` × `height`. */
  frame: (index: number, width: number, height: number) => Promise<GifFrame>;
  close: () => void;
};

/** The size after the shrink: `maxSide` on the long side, never bigger than the original. */
export const shrunkGifSize = (
  width: number,
  height: number,
  maxSide: number,
) => {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/**
 * The palette comes from at most this many pixels of the frame, spread over all of it: the
 * quantizer's time grows with the pixels, and a sample gives the same colors (about 8x faster at 800 px).
 */
const PALETTE_SAMPLE_PIXELS = 65536;

const paletteSample = (rgba: Uint8ClampedArray) => {
  const step = Math.ceil(rgba.length / 4 / PALETTE_SAMPLE_PIXELS);
  if (step <= 1) {
    return rgba;
  }
  const sample = new Uint8ClampedArray(Math.ceil(rgba.length / 4 / step) * 4);
  for (let from = 0, to = 0; from < rgba.length; from += step * 4, to += 4) {
    sample.set(rgba.subarray(from, from + 4), to);
  }
  return sample;
};

const hasTransparency = (rgba: Uint8ClampedArray) => {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 128) {
      return true;
    }
  }
  return false;
};

/** Writes each frame of `source` again at the shrunk size, with its own 256-color palette and delay. */
export const encodeShrunkGif = async (
  source: GifSource,
  maxSide: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  const { width, height } = shrunkGifSize(source.width, source.height, maxSide);
  // gifenc: 0 loops forever, -1 plays once, n repeats n times
  const repeat =
    source.repetitionCount === Infinity
      ? 0
      : source.repetitionCount === 0
      ? -1
      : source.repetitionCount;
  const gif = GIFEncoder();
  for (let index = 0; index < source.frameCount; index++) {
    const { rgba, delayMs } = await source.frame(index, width, height);
    // an opaque frame keeps more color precision than one with see-through pixels
    const transparent = hasTransparency(rgba);
    const format = transparent ? "rgba4444" : "rgb565";
    const palette = quantize(paletteSample(rgba), 256, {
      format,
      oneBitAlpha: transparent,
    });
    const transparentIndex = transparent
      ? palette.findIndex((color) => color[3] === 0)
      : -1;
    gif.writeFrame(applyPalette(rgba, palette, format), width, height, {
      palette,
      delay: delayMs,
      repeat,
      transparent: transparentIndex >= 0,
      transparentIndex,
    });
  }
  gif.finish();
  return gif.bytes();
};

/** A `GifSource` over the browser's `ImageDecoder`; each frame is scaled in an `OffscreenCanvas`. */
export const decodeGif = async (data: ArrayBuffer): Promise<GifSource> => {
  const decoder = new ImageDecoder({ data, type: "image/gif" });
  try {
    // `selectedTrack` is null until the tracks are ready, and Chromium can
    // resolve `completed` first
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack!;
    const first = (await decoder.decode({ frameIndex: 0 })).image;
    const { displayWidth: width, displayHeight: height } = first;
    first.close();
    let canvas: OffscreenCanvas | null = null;
    return {
      width,
      height,
      frameCount: track.frameCount,
      repetitionCount: track.repetitionCount,
      frame: async (frameIndex, frameWidth, frameHeight) => {
        const { image } = await decoder.decode({ frameIndex });
        try {
          canvas ??= new OffscreenCanvas(frameWidth, frameHeight);
          const context = canvas.getContext("2d", {
            willReadFrequently: true,
          })!;
          context.clearRect(0, 0, frameWidth, frameHeight);
          context.imageSmoothingQuality = "high";
          context.drawImage(image, 0, 0, frameWidth, frameHeight);
          return {
            rgba: context.getImageData(0, 0, frameWidth, frameHeight).data,
            delayMs: Math.round((image.duration ?? 0) / 1000),
          };
        } finally {
          image.close();
        }
      },
      close: () => decoder.close(),
    };
  } catch (error) {
    decoder.close();
    throw error;
  }
};

/** Decode, shrink and encode: the work of one GIF in the worker. */
export const shrinkGifBytes = async (
  data: ArrayBuffer,
  maxSide: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  const source = await decodeGif(data);
  try {
    return await encodeShrunkGif(source, maxSide);
  } finally {
    source.close();
  }
};
