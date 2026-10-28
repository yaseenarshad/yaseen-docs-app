/* eslint-disable import/order -- runtime globals must initialize before app imports */
import "./runtimeEnvironment";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { setCustomTextMetricsProvider } from "@excalidraw/element";

import { generatePresentationDeck } from "../../packages/excalidraw/presentation/deckGenerator";
import {
  FOUNDATIONS_OF_AI_ASSETS,
  FOUNDATIONS_OF_AI_LAYOUT,
  FOUNDATIONS_OF_AI_MIXED_STORYBOARD,
} from "../../packages/excalidraw/presentation/fixtures/foundationsOfAi";

import type { BinaryFiles } from "../../packages/excalidraw/types";

const argument = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const outputPath = argument("--out");
if (!outputPath?.endsWith(".excalidraw")) {
  throw new Error(
    "Usage: yarn presentation:proof --out <deck.excalidraw> [--assets-from <existing-deck.excalidraw>]",
  );
}

setCustomTextMetricsProvider({
  getLineWidth: (text, fontString) => {
    const fontSize = Number(fontString.match(/([\d.]+)px/)?.[1] ?? 20);
    return [...text].reduce(
      (width, character) =>
        width +
        (character === " "
          ? fontSize * 0.3
          : fontSize * (/[A-Z0-9]/.test(character) ? 0.62 : 0.54)),
      0,
    );
  },
});

const assetsPath = argument("--assets-from");
let assets: BinaryFiles = FOUNDATIONS_OF_AI_ASSETS;
if (assetsPath) {
  const source = JSON.parse(await readFile(resolve(assetsPath), "utf8")) as {
    files?: BinaryFiles;
  };
  assets = { ...FOUNDATIONS_OF_AI_ASSETS, ...source.files };
}

const generated = generatePresentationDeck({
  storyboard: FOUNDATIONS_OF_AI_MIXED_STORYBOARD,
  assets,
  layout: FOUNDATIONS_OF_AI_LAYOUT,
});
const absoluteOutputPath = resolve(outputPath);
const reportPath = `${absoluteOutputPath}.report.json`;
const temporaryOutputPath = `${absoluteOutputPath}.${process.pid}.tmp`;
const temporaryReportPath = `${reportPath}.${process.pid}.tmp`;

await mkdir(dirname(absoluteOutputPath), { recursive: true });
await Promise.all([
  writeFile(temporaryOutputPath, `${generated.portableJson}\n`, "utf8"),
  writeFile(
    temporaryReportPath,
    `${JSON.stringify(generated.report, null, 2)}\n`,
    "utf8",
  ),
]);
await rename(temporaryOutputPath, absoluteOutputPath);
await rename(temporaryReportPath, reportPath);
process.stdout.write(
  `Generated mixed animation proof deck at ${absoluteOutputPath}\nReport: ${reportPath}\n`,
);
