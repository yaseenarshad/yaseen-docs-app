import { Inflate } from "pako";

const MALFORMED_MESSAGE = "Board scene could not be decompressed";
const TOO_LARGE_MESSAGE = "Board scene is too large";

/** Stops inflation when emitted raw bytes exceed the per-payload cap. */
export const inflateBoardScene = (
  bytes: Uint8Array,
  maxRawBytes: number,
): Uint8Array => {
  if (!Number.isSafeInteger(maxRawBytes) || maxRawBytes < 1) {
    throw new Error("Board scene raw limit is invalid");
  }
  const chunks: Uint8Array[] = [];
  let rawSize = 0;
  let tooLarge = false;
  const inflator = new Inflate({ windowBits: 15 });
  inflator.onData = (chunk) => {
    const rawChunk =
      chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    rawSize += rawChunk.byteLength;
    if (rawSize > maxRawBytes) {
      tooLarge = true;
      throw new Error(TOO_LARGE_MESSAGE);
    }
    // Pako may reuse its output buffer on a later callback.
    chunks.push(rawChunk.slice());
  };

  try {
    const succeeded = inflator.push(bytes, true);
    const completed = "ended" in inflator && inflator.ended === true;
    // Pako can ignore zero-prefixed trailers or reset its input count for a
    // concatenated stream. deflate-v1 accepts exactly one complete zlib stream.
    const stream = "strm" in inflator ? inflator.strm : null;
    const consumed =
      stream && typeof stream === "object" && "total_in" in stream
        ? stream.total_in
        : null;
    if (
      !succeeded ||
      inflator.err ||
      !completed ||
      consumed !== bytes.byteLength
    ) {
      throw new Error(MALFORMED_MESSAGE);
    }
  } catch {
    throw new Error(tooLarge ? TOO_LARGE_MESSAGE : MALFORMED_MESSAGE);
  }

  const raw = new Uint8Array(rawSize);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
};
