import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  generatePresentationFiles,
  parsePresentationCliArguments,
} from "./generate";

const oneSlideStoryboard = {
  presentationId: "cli-example",
  generatorVersion: "canvas-skill@1.0.0",
  slides: [
    {
      id: "slide-01",
      order: 1,
      eyebrow: "The map",
      headline: "The first three words live in the brain",
      body: "The model, token, and context window describe the brain.",
      cards: [],
      templateId: "foundations-editorial",
      templateVersion: "1.0.0",
      renderMode: "image",
      visual: { kind: "image", assetId: "slide-01-visual" },
    },
  ],
};

describe("presentation generator CLI", () => {
  it("parses the documented generator invocation", () => {
    expect(
      parsePresentationCliArguments([
        "--storyboard",
        "storyboard.json",
        "--assets",
        "assets.json",
        "--layout",
        "layout.json",
        "--out",
        "course.excalidraw",
      ]),
    ).toEqual({
      storyboardPath: "storyboard.json",
      assetsManifestPath: "assets.json",
      layoutPath: "layout.json",
      outputPath: "course.excalidraw",
    });
  });

  it("writes a portable Excalidraw deck and adjacent report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yaseendraw-generator-"));
    const storyboardPath = join(directory, "storyboard.json");
    const assetsManifestPath = join(directory, "assets.json");
    const visualPath = join(directory, "visual.svg");
    const outputPath = join(directory, "course.excalidraw");

    await Promise.all([
      writeFile(storyboardPath, JSON.stringify(oneSlideStoryboard)),
      writeFile(
        assetsManifestPath,
        JSON.stringify({ "slide-01-visual": "visual.svg" }),
      ),
      writeFile(
        visualPath,
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      ),
    ]);

    const result = await generatePresentationFiles({
      storyboardPath,
      assetsManifestPath,
      outputPath,
    });
    const scene = JSON.parse(await readFile(outputPath, "utf8"));
    const report = JSON.parse(await readFile(result.reportPath, "utf8"));

    expect(scene.type).toBe("excalidraw");
    expect(
      scene.elements.some(
        (element: { type: string }) => element.type === "frame",
      ),
    ).toBe(true);
    expect(scene.files["slide-01-visual"].mimeType).toBe("image/svg+xml");
    expect(report).toMatchObject({
      presentationId: "cli-example",
      slideCount: 1,
      frameCount: 1,
    });
    expect(result).toMatchObject({
      outputPath,
      reportPath: `${outputPath}.report.json`,
    });
  });

  it("does not create an output when a manifest asset is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yaseendraw-generator-"));
    const storyboardPath = join(directory, "storyboard.json");
    const assetsManifestPath = join(directory, "assets.json");
    const outputPath = join(directory, "course.excalidraw");

    await Promise.all([
      writeFile(storyboardPath, JSON.stringify(oneSlideStoryboard)),
      writeFile(
        assetsManifestPath,
        JSON.stringify({ "slide-01-visual": "missing.svg" }),
      ),
    ]);

    await expect(
      generatePresentationFiles({
        storyboardPath,
        assetsManifestPath,
        outputPath,
      }),
    ).rejects.toThrow(/slide-01-visual.*missing\.svg/s);
    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
  });
});
