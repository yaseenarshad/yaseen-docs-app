import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import vm from "vm";

/** The worker as the build bundles it (`scripts/workerSource.js`), in its own node: esbuild does not run under jsdom. */
const builtWorker = (entry: string): string =>
  execFileSync(
    process.execPath,
    [
      "-e",
      `require(${JSON.stringify(
        path.resolve(__dirname, "../../../scripts/workerSource.js"),
      )}).bundleWorker(${JSON.stringify(
        entry,
      )}, true).then((s) => process.stdout.write(s))`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

/**
 * YAZ-3943 1G: the font subset worker starts from one bundled string. The
 * string must run with only what a worker has: no `window`, no `document`, no
 * import of an app chunk (the trap that sent every subset to the main thread).
 */
describe("YAZ-3943 1G: the built font subset worker", () => {
  it("runs alone, with only a worker's globals, and subsets a font", async () => {
    const source = builtWorker(
      path.resolve(__dirname, "../subset/subset-worker.ts"),
    );
    // one script: no static import or export, no dynamic import, no `import.meta`
    expect(source).not.toMatch(
      /\bimport\s*[{"'*(]|\bimport\.meta|\bimport\s+\w+\s+from\b|\bexport\s*[{*]/,
    );

    const font = readFileSync(
      path.resolve(__dirname, "../fonts/Assistant/Assistant-Regular.woff2"),
    );
    const posted: unknown[] = [];
    const self: { onmessage?: (event: { data: unknown }) => Promise<void> } & {
      postMessage: (data: unknown) => void;
    } = { postMessage: (data) => posted.push(data) };
    vm.runInNewContext(source, {
      self,
      atob,
      TextDecoder,
      TextEncoder,
      console,
    });

    const arrayBuffer = font.buffer.slice(
      font.byteOffset,
      font.byteOffset + font.byteLength,
    );
    await self.onmessage!({
      data: { command: "SUBSET", arrayBuffer, codePoints: [65, 66, 67] },
    });

    expect(posted).toHaveLength(1);
    const subset = new Uint8Array(posted[0] as ArrayBuffer);
    // a woff2 font ("wOF2"), with only three letters: much smaller
    expect(String.fromCharCode(...subset.slice(0, 4))).toBe("wOF2");
    expect(subset.byteLength).toBeGreaterThan(0);
    expect(subset.byteLength).toBeLessThan(font.byteLength / 2);
  });
});
