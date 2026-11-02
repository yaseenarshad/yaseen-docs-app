/**
 * YAZ-4074 6A item 18: the GIF shrink runs one GIF at a time. `WorkerPool` has
 * no worker limit, so a drop of several big GIFs started one worker each, each
 * with full-size frames.
 */
const pool = vi.hoisted(() => ({
  running: 0,
  most: 0,
  postMessage: vi.fn(),
}));

vi.mock("../workers", () => ({
  WorkerPool: { create: vi.fn(() => pool) },
}));
vi.mock("../gif/gifShrinkWorker?worker-source", () => ({ default: "" }));

import { shrinkGifFile } from "../gif/gifFile";

/** A GIF header 900 px wide: over the limit, so it shrinks. */
const bigGif = () => {
  const bytes = new Uint8Array(16);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x84, 0x03, 0x10, 0x00]);
  return new File([bytes], "big.gif", { type: "image/gif" });
};

describe("YAZ-4074 6A item 18: the GIF shrink queue", () => {
  beforeEach(() => {
    URL.createObjectURL = () => "blob:gif";
    pool.postMessage.mockImplementation(async () => {
      pool.running++;
      pool.most = Math.max(pool.most, pool.running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      pool.running--;
      return { bytes: new Uint8Array([1]).buffer };
    });
  });

  it("three GIFs dropped at once shrink one after another", async () => {
    const shrunk = await Promise.all(
      [bigGif(), bigGif(), bigGif()].map(shrinkGifFile),
    );
    expect(pool.postMessage).toHaveBeenCalledTimes(3);
    expect(pool.most).toBe(1);
    expect(shrunk.every((file) => file.size === 1)).toBe(true);
  });

  it("a shrink that fails does not stop the next one", async () => {
    pool.postMessage.mockRejectedValueOnce(new Error("bad GIF"));
    const [first, second] = await Promise.allSettled([
      shrinkGifFile(bigGif()),
      shrinkGifFile(bigGif()),
    ]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
  });
});
