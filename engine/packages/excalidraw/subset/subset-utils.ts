/**
 * YAZ-4074 6A item 30: the parts of the subset that the UI thread needs on every export. They live
 * apart from `subset-shared.chunk.ts`, which holds the harfbuzz and woff2 wasm (about 1.8 MB), so a
 * subset on the worker never loads that chunk on the UI thread; only the main-thread fallback does.
 *
 * DON'T depend on anything from the outside like `promiseTry`: the worker's string and the lazy chunk carry this file.
 */

/**
 * Shared commands between the main thread and worker threads.
 */
export const Commands = {
  Subset: "SUBSET",
} as const;

/**
 * Util for isomoprhic browser (main thread), node and jsdom usage.
 *
 * Isn't used inside the worker to avoid copying large binary strings (as dataurl) between worker threads and the main thread.
 */
export const toBase64 = async (arrayBuffer: ArrayBuffer) => {
  let base64: string;

  if (typeof Buffer !== "undefined") {
    // node, jsdom
    base64 = Buffer.from(arrayBuffer).toString("base64");
  } else {
    // browser (main thread)
    // it's perfectly fine to treat each byte independently,
    // as we care only about turning individual bytes into codepoints,
    // not about multi-byte unicode characters
    const byteString = String.fromCharCode(...new Uint8Array(arrayBuffer));
    base64 = btoa(byteString);
  }

  return `data:font/woff2;base64,${base64}`;
};
