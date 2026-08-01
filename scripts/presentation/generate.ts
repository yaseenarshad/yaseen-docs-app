import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { extname, dirname, isAbsolute, resolve } from "node:path";

import { setCustomTextMetricsProvider } from "@excalidraw/element";

import type { FileId } from "@excalidraw/element/types";

import {
  generatePresentationDeck,
  type PresentationDeckLayout,
} from "../../packages/excalidraw/presentation/deckGenerator";

import type {
  BinaryFileData,
  BinaryFiles,
  DataURL,
} from "../../packages/excalidraw/types";

export type PresentationCliArguments = {
  storyboardPath: string;
  assetsManifestPath?: string;
  layoutPath?: string;
  outputPath: string;
};

const usage = `Usage: vite-node scripts/presentation/run.ts \\
  --storyboard <storyboard.json> [--assets <assets.json>] \\
  [--layout <layout.json>] --out <deck.excalidraw>`;

export const parsePresentationCliArguments = (
  arguments_: readonly string[],
): PresentationCliArguments => {
  const values: Record<string, string> = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Invalid presentation generator arguments.\n${usage}`);
    }
    values[flag] = value;
  }

  const storyboardPath = values["--storyboard"];
  const outputPath = values["--out"];
  if (!storyboardPath || !outputPath) {
    throw new Error(`--storyboard and --out are required.\n${usage}`);
  }
  if (extname(outputPath) !== ".excalidraw") {
    throw new Error(`--out must end in .excalidraw.\n${usage}`);
  }

  return {
    storyboardPath,
    assetsManifestPath: values["--assets"],
    layoutPath: values["--layout"],
    outputPath,
  };
};

const parseJson = <T>(contents: string, sourcePath: string): T => {
  try {
    return JSON.parse(contents) as T;
  } catch (error) {
    throw new Error(
      `Could not parse JSON at ${sourcePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const mimeTypesByExtension: Record<string, BinaryFileData["mimeType"]> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jfif": "image/jfif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const resolveManifestAssetPath = (manifestPath: string, assetPath: string) =>
  isAbsolute(assetPath) ? assetPath : resolve(dirname(manifestPath), assetPath);

const loadAssets = async (manifestPath?: string): Promise<BinaryFiles> => {
  if (!manifestPath) {
    return {};
  }
  const manifest = parseJson<Record<string, unknown>>(
    await readFile(manifestPath, "utf8"),
    manifestPath,
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  ) {
    throw new Error(`Asset manifest at ${manifestPath} must be an object.`);
  }

  const loaded = await Promise.all(
    Object.entries(manifest).map(async ([assetId, value]) => {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(
          `Asset manifest entry "${assetId}" must be a file path string.`,
        );
      }
      const assetPath = resolveManifestAssetPath(manifestPath, value);
      const mimeType = mimeTypesByExtension[extname(assetPath).toLowerCase()];
      if (!mimeType) {
        throw new Error(
          `Asset "${assetId}" uses unsupported file type at ${assetPath}.`,
        );
      }
      let contents: Buffer;
      try {
        contents = await readFile(assetPath);
      } catch (error) {
        throw new Error(
          `Could not load asset "${assetId}" from ${assetPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      const fileId = assetId as FileId;
      const data: BinaryFileData = {
        id: fileId,
        mimeType,
        dataURL: `data:${mimeType};base64,${contents.toString(
          "base64",
        )}` as DataURL,
        created: 0,
      };
      return [fileId, data] as const;
    }),
  );
  return Object.fromEntries(loaded);
};

const configureHeadlessTextMeasurement = () => {
  setCustomTextMetricsProvider({
    getLineWidth: (text, fontString) => {
      const fontSize = Number(fontString.match(/([\d.]+)px/)?.[1] ?? 20);
      return [...text].reduce((width, character) => {
        if (character === " ") {
          return width + fontSize * 0.3;
        }
        return width + fontSize * (/[A-Z0-9]/.test(character) ? 0.62 : 0.54);
      }, 0);
    },
  });
};

export const generatePresentationFiles = async ({
  storyboardPath,
  assetsManifestPath,
  layoutPath,
  outputPath,
}: PresentationCliArguments) => {
  const [storyboardContents, layoutContents, assets] = await Promise.all([
    readFile(storyboardPath, "utf8"),
    layoutPath ? readFile(layoutPath, "utf8") : Promise.resolve(undefined),
    loadAssets(assetsManifestPath),
  ]);
  const storyboard = parseJson<unknown>(storyboardContents, storyboardPath);
  const layout = layoutContents
    ? parseJson<PresentationDeckLayout>(layoutContents, layoutPath!)
    : undefined;

  configureHeadlessTextMeasurement();
  const generated = generatePresentationDeck({ storyboard, assets, layout });
  const reportPath = `${outputPath}.report.json`;
  const temporaryOutputPath = `${outputPath}.${process.pid}.tmp`;
  const temporaryReportPath = `${reportPath}.${process.pid}.tmp`;

  await mkdir(dirname(outputPath), { recursive: true });
  await Promise.all([
    writeFile(temporaryOutputPath, `${generated.portableJson}\n`, "utf8"),
    writeFile(
      temporaryReportPath,
      `${JSON.stringify(generated.report, null, 2)}\n`,
      "utf8",
    ),
  ]);
  await rename(temporaryReportPath, reportPath);
  await rename(temporaryOutputPath, outputPath);

  return { outputPath, reportPath, report: generated.report };
};
