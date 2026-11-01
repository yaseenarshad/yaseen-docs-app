import { GIFEncoder, applyPalette, quantize } from "gifenc/dist/gifenc.esm.js";

import {
  GIF_MAX_FILE_SIZE_BYTES,
  MIME_TYPES,
  randomId,
  reseed,
} from "@excalidraw/common";

import type { FileId } from "@excalidraw/element/types";

import { actionPasteAtFullSize } from "../actions/actionClipboard";
import * as clipboardModule from "../clipboard";
import * as blobModule from "../data/blob";
import * as gifModule from "../gif/gifFile";
import { encodeShrunkGif, shrunkGifSize } from "../gif/gifShrink";

import { Excalidraw } from "../index";

import { mockMultipleHTMLImageElements } from "./helpers/mocks";
import { act, GlobalTestState, render, waitFor } from "./test-utils";

import type { GifSource } from "../gif/gifShrink";

const { h } = window;

const setupImageTest = async (sizes: { width: number; height: number }[]) => {
  await render(<Excalidraw autoFocus={true} handleKeyboardGlobally={true} />);
  h.state.height = 1000;
  mockMultipleHTMLImageElements(sizes.map((size) => [size.width, size.height]));
};

/** A test GIF: `frames` frames of `width` × `height` noise, each with `delayMs`. */
export const makeGif = (
  width: number,
  height: number,
  frames: number,
  delayMs = 50,
) => {
  const gif = GIFEncoder();
  for (let f = 0; f < frames; f++) {
    const rgba = noiseFrame(width, height, f);
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), width, height, {
      palette,
      delay: delayMs,
    });
  }
  gif.finish();
  return gif.bytes();
};

const noiseFrame = (width: number, height: number, seed: number) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  let n = seed * 7919 + 1;
  for (let i = 0; i < rgba.length; i += 4) {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    rgba[i] = n & 0xff;
    rgba[i + 1] = (n >> 8) & 0xff;
    rgba[i + 2] = (i / 4 + seed * 9) & 0xff;
    rgba[i + 3] = 255;
  }
  return rgba;
};

/** The logical screen size, and each frame's delay in ms, read from GIF bytes. */
export const readGif = (bytes: Uint8Array) => {
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  let at = 13;
  if (bytes[10] & 0x80) {
    at += 3 * (1 << ((bytes[10] & 7) + 1));
  }
  const skipSubBlocks = () => {
    while (bytes[at] !== 0) {
      at += bytes[at] + 1;
    }
    at++;
  };
  const delays: number[] = [];
  let delay = 0;
  while (at < bytes.length && bytes[at] !== 0x3b) {
    if (bytes[at] === 0x21) {
      if (bytes[at + 1] === 0xf9) {
        delay = (bytes[at + 4] | (bytes[at + 5] << 8)) * 10;
      }
      at += 2;
      skipSubBlocks();
    } else if (bytes[at] === 0x2c) {
      const packed = bytes[at + 9];
      at += 10;
      if (packed & 0x80) {
        at += 3 * (1 << ((packed & 7) + 1));
      }
      at++; // LZW minimum code size
      skipSubBlocks();
      delays.push(delay);
    } else {
      throw new Error(`bad block ${bytes[at]} at ${at}`);
    }
  }
  return { width, height, delays };
};

/** A decoder stand-in: `frames` frames of noise, scaled by nearest neighbour. */
export const fakeGifSource = (
  width: number,
  height: number,
  delays: number[],
): GifSource => ({
  width,
  height,
  frameCount: delays.length,
  repetitionCount: Infinity,
  frame: async (index, w, h) => {
    const full = noiseFrame(width, height, index);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const sy = Math.floor((y * height) / h);
      for (let x = 0; x < w; x++) {
        const s = (sy * width + Math.floor((x * width) / w)) * 4;
        rgba.set(full.subarray(s, s + 4), (y * w + x) * 4);
      }
    }
    return { rgba, delayMs: delays[index] };
  },
  close: () => {},
});

const gifFile = (bytes: Uint8Array<ArrayBuffer>, name = "a.gif") =>
  new File([bytes], name, { type: MIME_TYPES.gif });

describe("YAZ-3944 D3: the GIF shrink", () => {
  it("reads the size in a GIF's header", () => {
    expect(gifModule.readGifSize(makeGif(321, 123, 1))).toEqual({
      width: 321,
      height: 123,
    });
    expect(gifModule.readGifSize(new Uint8Array(20))).toBe(null);
  });

  it("shrinks a GIF over 2 MB or 800 px, and only those", () => {
    const small = { width: 800, height: 600 };
    expect(gifModule.shouldShrinkGif(2 * 1024 * 1024, small)).toBe(false);
    expect(gifModule.shouldShrinkGif(2 * 1024 * 1024 + 1, small)).toBe(true);
    expect(gifModule.shouldShrinkGif(1000, { width: 600, height: 801 })).toBe(
      true,
    );
  });

  it("keeps a small GIF's own bytes", async () => {
    const file = gifFile(makeGif(200, 150, 3));
    await expect(gifModule.shrinkGifFile(file)).resolves.toBe(file);
  });

  it("writes a big GIF at 800 px on its long side, with every frame and delay", async () => {
    const delays = [30, 40, 50, 60, 70];
    const bytes = await encodeShrunkGif(fakeGifSource(1000, 750, delays), 800);
    expect(readGif(bytes)).toEqual({ width: 800, height: 600, delays });
    // about 2 s of encoding: room for a loaded machine
  }, 30_000);

  it("never makes a GIF bigger than it was", () => {
    expect(shrunkGifSize(400, 300, 800)).toEqual({ width: 400, height: 300 });
    expect(shrunkGifSize(900, 2000, 800)).toEqual({ width: 360, height: 800 });
  });
});

describe("YAZ-3944 D3, D16: adding a GIF, and Paste at full size", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    reseed(7);
    vi.spyOn(blobModule, "generateIdFromFile").mockImplementation(() =>
      Promise.resolve(randomId() as FileId),
    );
    Object.assign(document, {
      elementFromPoint: () => GlobalTestState.canvas,
    });
  });

  it("shrinks an added GIF in place of the PNG resize", async () => {
    await setupImageTest([{ width: 800, height: 600 }]);
    const original = gifFile(makeGif(40, 30, 2));
    const shrunk = gifFile(makeGif(20, 15, 2));
    vi.spyOn(gifModule, "gifNeedsShrink").mockResolvedValue(true);
    const shrink = vi
      .spyOn(gifModule, "shrinkGifFile")
      .mockResolvedValue(shrunk);
    const resize = vi.spyOn(blobModule, "resizeImageFile");

    await act(() => h.app.insertImages([original]));

    expect(shrink).toHaveBeenCalledWith(original);
    expect(resize).not.toHaveBeenCalled();
    await waitFor(() => expect(h.elements).toHaveLength(1));
    const file = h.app.files[(h.elements[0] as any).fileId];
    expect(file.mimeType).toBe(MIME_TYPES.gif);
    expect(file.dataURL).toBe(await blobModule.getDataURL(shrunk));
  });

  it("refuses a GIF over 20 MB after the shrink", async () => {
    await setupImageTest([{ width: 800, height: 600 }]);
    vi.spyOn(gifModule, "gifNeedsShrink").mockResolvedValue(true);
    vi.spyOn(gifModule, "shrinkGifFile").mockResolvedValue(
      gifFile(new Uint8Array(GIF_MAX_FILE_SIZE_BYTES + 1)),
    );

    await act(() => h.app.insertImages([gifFile(makeGif(40, 30, 2))]));

    expect(h.elements.filter((element) => !element.isDeleted)).toEqual([]);
    expect(h.state.errorMessage).toMatch("20MB");
  });

  it("Paste at full size skips the shrink of a GIF and the resize of a picture", async () => {
    await setupImageTest([
      { width: 1600, height: 1200 },
      { width: 3000, height: 2000 },
    ]);
    const shrink = vi.spyOn(gifModule, "shrinkGifFile");
    const resize = vi.spyOn(blobModule, "resizeImageFile");
    const gif = gifFile(makeGif(40, 30, 2));
    vi.spyOn(clipboardModule, "readSystemClipboard").mockResolvedValue({
      [MIME_TYPES.gif]: gif,
    });

    await act(() =>
      h.app.actionManager.executeAction(actionPasteAtFullSize, "contextMenu"),
    );
    await waitFor(() => expect(h.elements).toHaveLength(1));
    await act(() =>
      h.app.insertImages(
        [new File([new Uint8Array(100)], "big.png", { type: MIME_TYPES.png })],
        0,
        0,
        { fullSize: true },
      ),
    );
    await waitFor(() => expect(h.elements).toHaveLength(2));

    expect(shrink).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(h.app.files[(h.elements[0] as any).fileId].dataURL).toBe(
      await blobModule.getDataURL(gif),
    );
  });

  it("Paste at full size keeps the 4 MB limit for a picture", async () => {
    await setupImageTest([{ width: 800, height: 600 }]);

    await act(() =>
      h.app.insertImages(
        [
          new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.png", {
            type: MIME_TYPES.png,
          }),
        ],
        0,
        0,
        { fullSize: true },
      ),
    );

    expect(h.elements.filter((element) => !element.isDeleted)).toEqual([]);
    expect(h.state.errorMessage).toMatch("4MB");
  });

  it("YAZ-4062 2A1: a full-size paste of a GIF on the board adds the original, and keeps the shrunk copy", async () => {
    // real file ids: the SHA-1 of the bytes
    vi.mocked(blobModule.generateIdFromFile).mockRestore();
    await setupImageTest([
      { width: 800, height: 9 },
      { width: 900, height: 10 },
    ]);
    const original = gifFile(makeGif(900, 10, 2));
    const shrunk = gifFile(makeGif(800, 9, 2));
    const shrink = vi
      .spyOn(gifModule, "shrinkGifFile")
      .mockResolvedValue(shrunk);

    await act(() => h.app.insertImages([original]));
    await act(() => h.app.insertImages([original], 0, 0, { fullSize: true }));
    await act(() => h.app.insertImages([original]));
    await waitFor(() => expect(h.elements).toHaveLength(3));

    const [first, full, again] = h.elements as any[];
    const originalId = await blobModule.generateIdFromFile(original);
    expect(full.fileId).toBe(originalId);
    expect(first.fileId).toBe(await blobModule.getShrunkFileId(originalId));
    expect(again.fileId).toBe(first.fileId);
    expect(Object.keys(h.app.files).sort()).toEqual(
      [first.fileId, full.fileId].sort(),
    );
    expect(h.app.files[first.fileId].dataURL).toBe(
      await blobModule.getDataURL(shrunk),
    );
    expect(h.app.files[full.fileId].dataURL).toBe(
      await blobModule.getDataURL(original),
    );
    expect([first.width, full.width]).toEqual([800, 900]);
    // the second shrunk paste found the stored copy: no second shrink
    expect(shrink).toHaveBeenCalledTimes(1);
  });

  it("YAZ-4062 2A1: a resized picture and its full-size paste are two files", async () => {
    vi.mocked(blobModule.generateIdFromFile).mockRestore();
    await setupImageTest([
      { width: 1440, height: 10 },
      { width: 3000, height: 20 },
    ]);
    const picture = new File([new Uint8Array([1, 2, 3])], "big.png", {
      type: MIME_TYPES.png,
    });
    const resized = new File([new Uint8Array([4, 5])], "big.png", {
      type: MIME_TYPES.png,
    });
    vi.spyOn(blobModule, "resizeImageFile").mockResolvedValue(resized);

    await act(() => h.app.insertImages([picture]));
    await act(() => h.app.insertImages([picture], 0, 0, { fullSize: true }));
    await waitFor(() => expect(h.elements).toHaveLength(2));

    const [first, full] = h.elements as any[];
    expect(full.fileId).toBe(await blobModule.generateIdFromFile(picture));
    expect(first.fileId).not.toBe(full.fileId);
    expect([first.width, full.width]).toEqual([1440, 3000]);
  });
});
