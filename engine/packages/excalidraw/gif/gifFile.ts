import {
  GIF_SHRINK_ABOVE_BYTES,
  GIF_SHRINK_MAX_SIDE,
  MIME_TYPES,
  promiseTry,
} from "@excalidraw/common";

import { blobToArrayBuffer } from "../data/blob";
import { WorkerPool } from "../workers";

import type { GifWorkerResult } from "./gifShrinkWorker";

/** The width and height in a GIF's header (its logical screen), or null when the bytes are not a GIF. */
export const readGifSize = (bytes: Uint8Array) => {
  if (
    bytes.length < 10 ||
    bytes[0] !== 0x47 || // G
    bytes[1] !== 0x49 || // I
    bytes[2] !== 0x46 // F
  ) {
    return null;
  }
  return {
    width: bytes[6] | (bytes[7] << 8),
    height: bytes[8] | (bytes[9] << 8),
  };
};

/** YAZ-3944 D3: a GIF over 2 MB, or with a long side over 800 px, shrinks. */
export const shouldShrinkGif = (
  byteLength: number,
  size: { width: number; height: number },
) =>
  byteLength > GIF_SHRINK_ABOVE_BYTES ||
  Math.max(size.width, size.height) > GIF_SHRINK_MAX_SIDE;

/** YAZ-3944 D3: the GIF is over the limits, from its size and header alone. */
export const gifNeedsShrink = async (file: File) => {
  const size = readGifSize(
    new Uint8Array(await blobToArrayBuffer(file.slice(0, 10))),
  );
  return !!size && shouldShrinkGif(file.size, size);
};

/**
 * YAZ-3944 D3: an added GIF over the limits comes back at 800 px on its long side, every frame and
 * delay kept, written again in a worker so the board does not freeze. A GIF under both limits keeps
 * its own bytes. So does a GIF already at or under 800 px whose new copy is not smaller.
 *
 * @throws when the worker fails or cannot decode the GIF (the caller keeps the original)
 */
export const shrinkGifFile = async (file: File): Promise<File> => {
  const buffer = await blobToArrayBuffer(file);
  const size = readGifSize(
    new Uint8Array(buffer, 0, Math.min(10, buffer.byteLength)),
  );
  if (!size || !shouldShrinkGif(file.size, size)) {
    return file;
  }
  const bytes = await shrinkGifBuffer(buffer);
  if (
    bytes.byteLength >= file.size &&
    Math.max(size.width, size.height) <= GIF_SHRINK_MAX_SIDE
  ) {
    return file;
  }
  return new File([bytes], file.name, { type: MIME_TYPES.gif });
};

type GifWorkerJob = { buffer: ArrayBuffer; maxSide: number };

const shrinkGifBuffer = async (buffer: ArrayBuffer) => {
  const pool = await getOrCreateWorkerPool();
  const result = await pool.postMessage(
    { buffer, maxSide: GIF_SHRINK_MAX_SIDE },
    { transfer: [buffer] },
  );
  if ("error" in result) {
    throw new Error(result.error);
  }
  return result.bytes;
};

let workerPool: Promise<WorkerPool<GifWorkerJob, GifWorkerResult>> | null =
  null;

/**
 * The worker runs from a blob of its own bundled source: an engine chunk would import the app's
 * main chunk in the app's build (the subset worker's trap), and a worker cannot run that.
 */
const getOrCreateWorkerPool = () => {
  if (!workerPool) {
    workerPool = promiseTry(async () => {
      const { default: source } = await import(
        "./gifShrinkWorker?worker-source"
      );
      const url = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" }),
      );
      // a 10 MB GIF takes seconds: the pool rejects a job that runs past its ttl
      return WorkerPool.create<GifWorkerJob, GifWorkerResult>(new URL(url), {
        ttl: 60_000,
      });
    });
    workerPool.catch(() => {
      workerPool = null;
    });
  }
  return workerPool;
};
