const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const { build } = require("esbuild");
const { sassPlugin } = require("esbuild-sass-plugin");

const { parseEnvVariables } = require("../packages/excalidraw/env.cjs");

const ENV_VARS = {
  development: {
    ...parseEnvVariables(`${__dirname}/../.env.development`),
    DEV: true,
  },
  production: {
    ...parseEnvVariables(`${__dirname}/../.env.production`),
    PROD: true,
  },
};

// Resolve a relative path from the source file's directory
const resolveRelativePath = (importPath, sourceFile) => {
  const sourceDir = path.dirname(sourceFile);
  const extensions = [".scss", ".css", ""];

  for (const ext of extensions) {
    const fullPath = path.resolve(sourceDir, importPath + ext);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
    // Try with underscore prefix for partials
    const partialPath = path.join(
      path.dirname(fullPath),
      `_${path.basename(fullPath)}`,
    );
    if (fs.existsSync(partialPath)) {
      return partialPath;
    }
  }
  return null;
};

// Precompile function to convert relative paths to absolute paths
const precompile = (source, sourcePath) => {
  // Match @use and @forward statements with relative paths
  const importRegex = /(@use|@forward)\s+["'](\.[^"']+)["']/g;

  return source.replace(importRegex, (match, directive, importPath) => {
    const resolvedPath = resolveRelativePath(importPath, sourcePath);
    if (resolvedPath) {
      // Convert to file:// URL format for sass
      const fileUrl = pathToFileURL(resolvedPath).href;
      return `${directive} "${fileUrl}"`;
    }
    return match;
  });
};

/**
 * YAZ-3944 D3: `import source from "./file?worker-source"` gives the file and everything it imports
 * (packages too) as one script, a string to start a worker from a blob. A worker started from an
 * engine chunk would import the app's main chunk once the app bundles the engine.
 */
const workerSourcePlugin = {
  name: "worker-source",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\?worker-source$/ }, (args) => ({
      path: path.resolve(
        args.resolveDir,
        args.path.replace(/\?worker-source$/, ""),
      ),
      namespace: "worker-source",
    }));
    pluginBuild.onLoad(
      { filter: /.*/, namespace: "worker-source" },
      async (args) => {
        const result = await build({
          entryPoints: [args.path],
          resolveExtensions: [".ts", ".js"],
          bundle: true,
          write: false,
          format: "iife",
          target: "es2020",
          minify: !!pluginBuild.initialOptions.minify,
        });
        return { contents: result.outputFiles[0].text, loader: "text" };
      },
    );
  },
};

// excludes all external dependencies and bundles only the source code
const getConfig = (outdir) => ({
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  packages: "external",
  plugins: [
    sassPlugin({
      precompile,
    }),
    workerSourcePlugin,
  ],
  target: "es2020",
  assetNames: "[dir]/[name]",
  chunkNames: "[dir]/[name]-[hash]",
  alias: {
    "@excalidraw/utils": path.resolve(__dirname, "../packages/utils/src"),
  },
  external: [
    "@excalidraw/common",
    "@excalidraw/element",
    "@excalidraw/math",
    "@excalidraw/fractional-indexing",
  ],
  loader: {
    ".woff2": "file",
  },
});

function buildDev(config) {
  return build({
    ...config,
    sourcemap: true,
    define: {
      "import.meta.env": JSON.stringify(ENV_VARS.development),
    },
  });
}

function buildProd(config) {
  return build({
    ...config,
    minify: true,
    define: {
      "import.meta.env": JSON.stringify(ENV_VARS.production),
    },
  });
}

const createESMRawBuild = async () => {
  const chunksConfig = {
    entryPoints: ["index.tsx", "**/*.chunk.ts"],
    entryNames: "[name]",
  };

  // development unminified build with source maps
  await buildDev({
    ...getConfig("dist/dev"),
    ...chunksConfig,
  });

  // production minified buld without sourcemaps
  await buildProd({
    ...getConfig("dist/prod"),
    ...chunksConfig,
  });
};

(async () => {
  await createESMRawBuild();
})();
