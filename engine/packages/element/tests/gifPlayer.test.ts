import { MIME_TYPES } from "@excalidraw/common";

import {
  FakeImageDecoder,
  stubGifDecoding,
} from "@excalidraw/excalidraw/tests/helpers/gif";

import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";

import {
  GIF_IDLE_MS,
  GifPlayer,
  gifFrameDelay,
  nextGifFrame,
  nextGifTickAt,
} from "../src/gifPlayer";

import type { ExcalidrawImageElement, FileId } from "../src/types";

const file = (id: string, mimeType: string, frames = 1): BinaryFileData => ({
  id: id as FileId,
  mimeType: mimeType as BinaryFileData["mimeType"],
  dataURL: `data:${mimeType},${frames}` as DataURL,
  created: 0,
});

const image = (fileId: string, customData?: Record<string, unknown>) =>
  ({ type: "image", fileId, customData } as unknown as ExcalidrawImageElement);

describe("YAZ-3944 D2: the frame clock", () => {
  const clock = {
    index: 0,
    frameCount: 3,
    shownAt: 1000,
    delayMs: 100,
    loop: 0,
    repetitionCount: Infinity,
  };

  it("keeps a frame until its delay has passed, then shows the next one", () => {
    expect(nextGifFrame(clock, 1099)).toBe(null);
    expect(nextGifFrame(clock, 1100)).toEqual({
      index: 1,
      loop: 0,
      shownAt: 1100,
    });
    // a late tick keeps the frame's own time, so the GIF does not drift
    expect(nextGifFrame(clock, 1130)).toEqual({
      index: 1,
      loop: 0,
      shownAt: 1100,
    });
  });

  it("wraps to the first frame, and stops when the GIF has played its loops", () => {
    const last = { ...clock, index: 2 };
    expect(nextGifFrame(last, 1100)).toEqual({
      index: 0,
      loop: 1,
      shownAt: 1100,
    });
    expect(nextGifFrame({ ...last, repetitionCount: 0 }, 5000)).toBe(null);
    expect(nextGifFrame({ ...last, loop: 1, repetitionCount: 1 }, 5000)).toBe(
      null,
    );
  });

  it("starts the clock again when it falls more than a frame behind", () => {
    expect(nextGifFrame(clock, 1500)).toEqual({
      index: 1,
      loop: 0,
      shownAt: 1500,
    });
  });

  it("shows a delay of 10 ms or less for 100 ms, as browsers do", () => {
    expect([0, 10, 20, 70].map(gifFrameDelay)).toEqual([100, 100, 20, 70]);
  });

  it("repaints at most 25 times a second", () => {
    expect(nextGifTickAt([1010, 1100], 1000)).toBe(1040);
    expect(nextGifTickAt([1100, 1060], 1000)).toBe(1060);
  });
});

describe("YAZ-3944 D2: the GIF player", () => {
  let files: Record<string, BinaryFileData>;
  let player: GifPlayer;
  let repaints: number;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });
    stubGifDecoding();
    files = {};
    player = new GifPlayer((id) => files[id]);
    repaints = 0;
    // a repaint draws every GIF on screen, as the board's paint does
    player.repaint = () => {
      repaints++;
      for (const id of Object.keys(files)) {
        player.frameToken(image(id));
      }
    };
  });

  afterEach(() => {
    player.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("never starts a timer for a still picture", async () => {
    files.png = file("png", MIME_TYPES.png);
    files.still = file("still", MIME_TYPES.gif, 1);

    expect(player.frameToken(image("png"))).toBe(undefined);
    player.frameToken(image("still"));
    await vi.advanceTimersByTimeAsync(0);

    expect(player.frameToken(image("still"))).toBe(undefined);
    expect(player.frameFor(image("still"))).toBe(null);
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeImageDecoder.made[0].closed).toBe(true);
  });

  it("decodes one frame at a time, closes each one, and moves on its delay", async () => {
    files.a = file("a", MIME_TYPES.gif, 5);
    expect(player.frameToken(image("a"))).toBe(0);
    await vi.advanceTimersByTimeAsync(0);

    const decoder = FakeImageDecoder.made[0];
    expect(decoder.decoded).toEqual([0]);
    expect(player.frameFor(image("a"))).toBeInstanceOf(HTMLCanvasElement);
    expect(player.frameToken(image("a"))).toBe(1);

    await vi.advanceTimersByTimeAsync(49);
    expect(decoder.decoded).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(decoder.decoded).toEqual([0, 1]);
    expect(player.frameToken(image("a"))).toBe(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(decoder.decoded).toEqual([0, 1, 2, 3, 4, 0]);
    expect(FakeImageDecoder.openFrames).toBe(0);
  });

  it("repaints once for all GIFs whose frame is due", async () => {
    files.a = file("a", MIME_TYPES.gif, 3);
    files.b = file("b", MIME_TYPES.gif, 3);
    player.frameToken(image("a"));
    player.frameToken(image("b"));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(500);

    expect(FakeImageDecoder.made.map((d) => d.decoded.length)).toEqual([
      11, 11,
    ]);
    expect(repaints).toBe(10);
  });

  it("stops a GIF that the last repaint did not draw, until a paint draws it again", async () => {
    files.a = file("a", MIME_TYPES.gif, 3);
    player.frameToken(image("a"));
    await vi.advanceTimersByTimeAsync(0);
    // off screen: the board's paint no longer draws it
    player.repaint = () => repaints++;

    await vi.advanceTimersByTimeAsync(1000);
    expect(repaints).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    player.frameToken(image("a"));
    await vi.advanceTimersByTimeAsync(50);
    expect(repaints).toBe(2);
  });

  it("closes its decoders and stops on dispose", async () => {
    files.a = file("a", MIME_TYPES.gif, 3);
    files.b = file("b", MIME_TYPES.gif, 3);
    player.frameToken(image("a"));
    player.frameToken(image("b"));
    await vi.advanceTimersByTimeAsync(0);

    player.dispose();

    expect(FakeImageDecoder.made.map((d) => d.closed)).toEqual([true, true]);
    expect(vi.getTimerCount()).toBe(0);
    expect(player.frameFor(image("a"))).toBe(null);
  });

  it("YAZ-3944 D4: a paused GIF opens no decoder and shows its still image", async () => {
    files.a = file("a", MIME_TYPES.gif, 3);
    const paused = image("a", { gifPaused: true });

    expect(player.frameToken(paused)).toBe(undefined);
    await vi.advanceTimersByTimeAsync(1000);

    expect(FakeImageDecoder.made).toEqual([]);
    expect(player.frameFor(paused)).toBe(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("YAZ-3944 D4: a hidden board stops the timer, and showing it starts it again", async () => {
    files.a = file("a", MIME_TYPES.gif, 3);
    player.frameToken(image("a"));
    await vi.advanceTimersByTimeAsync(0);

    player.setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(repaints).toBe(0);

    player.setHidden(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(repaints).toBe(1);
  });

  it("YAZ-3944 D4: 5 min with no use stops the timer, and a mouse move starts it again", async () => {
    files.a = file("a", MIME_TYPES.gif, 3);
    player.frameToken(image("a"));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(GIF_IDLE_MS);
    const played = repaints;
    expect(player.idle).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(repaints).toBe(played);

    player.activity();
    expect(player.idle).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(repaints).toBe(played + 1);
  });

  it("YAZ-3944 D4: closes the decoder of a GIF that left the board", async () => {
    files.a = file("a", MIME_TYPES.gif, 3);
    files.b = file("b", MIME_TYPES.gif, 3);
    player.frameToken(image("a"));
    player.frameToken(image("b"));
    await vi.advanceTimersByTimeAsync(0);

    player.retain(new Set(["b" as FileId]));

    expect(FakeImageDecoder.made.map((d) => d.closed)).toEqual([true, false]);
    expect(player.size).toBe(1);
  });
});
