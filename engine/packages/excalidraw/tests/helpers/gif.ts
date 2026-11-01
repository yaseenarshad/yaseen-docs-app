import { vi } from "vitest";

/**
 * A stand-in for `ImageDecoder`: the data URL `data:image/gif,<frames>` gives a GIF with that many
 * frames of 50 ms. It counts what the player asks of it.
 */
export class FakeImageDecoder {
  static made: FakeImageDecoder[] = [];
  static openFrames = 0;
  decoded: number[] = [];
  closed = false;
  completed = Promise.resolve();
  tracks: { selectedTrack: { frameCount: number; repetitionCount: number } };

  constructor(init: { data: ArrayBuffer }) {
    const frameCount = new Uint8Array(init.data)[0];
    this.tracks = { selectedTrack: { frameCount, repetitionCount: Infinity } };
    FakeImageDecoder.made.push(this);
  }

  async decode({ frameIndex }: { frameIndex: number }) {
    if (this.closed) {
      throw new Error("closed");
    }
    this.decoded.push(frameIndex);
    FakeImageDecoder.openFrames++;
    const image = Object.assign(document.createElement("canvas"), {
      displayWidth: 4,
      displayHeight: 3,
      duration: 50_000,
      close: () => FakeImageDecoder.openFrames--,
    });
    return { image };
  }

  close() {
    this.closed = true;
  }
}

export const stubGifDecoding = () => {
  FakeImageDecoder.made = [];
  FakeImageDecoder.openFrames = 0;
  vi.stubGlobal("ImageDecoder", FakeImageDecoder);
  vi.stubGlobal("fetch", async (url: string) => ({
    arrayBuffer: async () =>
      new Uint8Array([Number(url.slice(url.indexOf(",") + 1))]).buffer,
  }));
};
