const { build } = require("esbuild");

/**
 * YAZ-3944 D3, YAZ-3943 1G: a worker file and everything it imports (packages too) as one script,
 * with no import left: the `?worker-source` plugin of `buildPackage.js` uses it, and so does the test
 * that runs the built script alone (`tests/subsetWorker.test.ts`).
 */
const bundleWorker = async (entry, minify = false) => {
  const result = await build({
    entryPoints: [entry],
    resolveExtensions: [".ts", ".js"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    minify,
  });
  return result.outputFiles[0].text;
};

module.exports = { bundleWorker };
