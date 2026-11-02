/**
 * YAZ-3943 1G: the font subset worker. The build bundles this file and all it imports (the harfbuzz
 * and woff2 wasm included) into one string (the `?worker-source` import in `subset-main.ts`,
 * `scripts/buildPackage.js`), as the GIF shrink worker is. So the worker never loads a chunk of the
 * app: an engine chunk imports the esbuild runtime chunk, which the app's build puts in its main
 * chunk, and the main chunk needs a window (`document is not defined` in a worker). Before, every
 * export's font subset fell back to the main thread for that reason.
 *
 * DON'T depend on anything from the outside like `promiseTry`: the string would carry it too.
 */

import { Commands, subsetToBinary } from "./subset-shared.chunk";

self.onmessage = async (e: {
  data: {
    command: typeof Commands.Subset;
    arrayBuffer: ArrayBuffer;
    codePoints: Array<number>;
  };
}) => {
  switch (e.data.command) {
    case Commands.Subset:
      try {
        const buffer = await subsetToBinary(
          e.data.arrayBuffer,
          e.data.codePoints,
        );

        self.postMessage(buffer, { transfer: [buffer] });
      } catch (error) {
        // YAZ-4074 6A item 8: answer the error; the main thread falls back for this subset only
        self.postMessage({ error: String(error) });
      }
      break;
  }
};
