/**
 * YAZ-3944 D3: the GIF shrink worker. The build bundles this file and all it imports into one string
 * (the `?worker-source` import in `gifFile.ts`, `scripts/buildPackage.js`), so the worker never loads
 * a chunk of the app.
 */

import { shrinkGifBytes } from "./gifShrink";

export type GifWorkerResult =
  | { bytes: Uint8Array<ArrayBuffer> }
  | { error: string };

self.onmessage = async (e: {
  data: { buffer: ArrayBuffer; maxSide: number };
}) => {
  try {
    const bytes = await shrinkGifBytes(e.data.buffer, e.data.maxSide);
    const result: GifWorkerResult = { bytes };
    self.postMessage(result, { transfer: [bytes.buffer] });
  } catch (error: any) {
    // a GIF the decoder cannot read: an answer, not a broken worker
    const result: GifWorkerResult = {
      error: String(error?.message ?? error),
    };
    self.postMessage(result);
  }
};
