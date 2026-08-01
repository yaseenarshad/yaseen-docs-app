import { describe, expect, it } from "vitest";

import type { FileId } from "@excalidraw/element/types";

import canonicalStoryboard from "./fixtures/canonical-storyboard.json";
import {
  FOUNDATIONS_OF_AI_ASSETS,
  FOUNDATIONS_OF_AI_LAYOUT,
  FOUNDATIONS_OF_AI_MIXED_STORYBOARD,
  FOUNDATIONS_OF_AI_STORYBOARD,
} from "./fixtures/foundationsOfAi";
import {
  PresentationDeckGenerationError,
  generatePresentationDeck,
} from "./deckGenerator";
import { getPresentationMetadata } from "./templateApplication";

import type { BinaryFiles, DataURL } from "../types";
import type { StoryboardPresentation } from "./sceneContract";

describe("generatePresentationDeck", () => {
  it("generates the 17-slide Foundations scene with ordered frames and deduplicated assets", () => {
    const result = generatePresentationDeck({
      storyboard: FOUNDATIONS_OF_AI_STORYBOARD,
      assets: FOUNDATIONS_OF_AI_ASSETS,
      layout: FOUNDATIONS_OF_AI_LAYOUT,
    });
    const frames = result.scene.elements.filter(
      (element) => element.type === "frame",
    );
    const elementIds = result.scene.elements.map((element) => element.id);
    const plateElements = result.scene.elements.filter(
      (element) =>
        element.type === "image" &&
        element.fileId === "template-foundations-editorial-v1",
    );

    expect(frames).toHaveLength(17);
    expect(
      frames.map((frame) => {
        const metadata = getPresentationMetadata(frame);
        return metadata?.kind === "slide-frame"
          ? metadata.presentationOrder
          : null;
      }),
    ).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
    expect(new Set(elementIds).size).toBe(elementIds.length);
    expect(Object.keys(result.scene.files)).toHaveLength(18);
    expect(plateElements).toHaveLength(17);
    expect(
      result.scene.files["template-foundations-editorial-v1"],
    ).toBeDefined();
    expect(frames[0]).toMatchObject({
      ...FOUNDATIONS_OF_AI_LAYOUT.origins["slide-01"],
      customData: { presentationOrder: 1 },
    });
    expect(result.report).toMatchObject({
      slideCount: 17,
      frameCount: 17,
      modeCounts: { image: 17, animation: 0, "full-native": 0 },
      fileCount: 18,
      sourceCanvas: { width: 5240, height: 4045 },
    });
    expect(result.report.cloudBytes).toBeLessThan(900 * 1024);
  });

  it("produces an equivalent deterministic scene and report for identical input", () => {
    const generate = () =>
      generatePresentationDeck({
        storyboard: FOUNDATIONS_OF_AI_STORYBOARD,
        assets: FOUNDATIONS_OF_AI_ASSETS,
        layout: FOUNDATIONS_OF_AI_LAYOUT,
      });

    expect(generate()).toEqual(generate());
  });

  it("generates the reproducible 17-slide mixed animation stress deck", () => {
    const result = generatePresentationDeck({
      storyboard: FOUNDATIONS_OF_AI_MIXED_STORYBOARD,
      assets: FOUNDATIONS_OF_AI_ASSETS,
      layout: FOUNDATIONS_OF_AI_LAYOUT,
    });

    expect(result.report).toMatchObject({
      slideCount: 17,
      frameCount: 17,
      modeCounts: { image: 11, animation: 6, "full-native": 0 },
    });
    expect(
      result.scene.elements.filter((element) => element.type === "iframe"),
    ).toHaveLength(6);
    expect(
      result.scene.elements.filter((element) => {
        const metadata = getPresentationMetadata(element);
        return (
          metadata?.kind === "slide-child" &&
          metadata.role === "animation-preview"
        );
      }),
    ).toHaveLength(6);
  });

  it("preserves mixed image, animation, and full-native mode metadata", () => {
    const storyboard = canonicalStoryboard as StoryboardPresentation;
    const imageFileId = "asset-prediction-diagram" as FileId;
    const assets: BinaryFiles = {
      [imageFileId]: {
        id: imageFileId,
        mimeType: "image/png",
        dataURL: "data:image/png;base64,bWl4ZWQtZGVjaw==" as DataURL,
        created: 0,
      },
    };
    const result = generatePresentationDeck({ storyboard, assets });
    const frameModes = result.scene.elements.flatMap((element) => {
      const metadata = getPresentationMetadata(element);
      return metadata?.kind === "slide-frame" ? [metadata.renderMode] : [];
    });

    expect(frameModes).toEqual(["image", "animation", "full-native"]);
    expect(result.report.modeCounts).toEqual({
      image: 1,
      animation: 1,
      "full-native": 1,
    });
  });

  it("fails before output with the exact slide when a required asset is missing", () => {
    const assets = { ...FOUNDATIONS_OF_AI_ASSETS };
    delete assets["slide-17-visual"];

    try {
      generatePresentationDeck({
        storyboard: FOUNDATIONS_OF_AI_STORYBOARD,
        assets,
        layout: FOUNDATIONS_OF_AI_LAYOUT,
      });
      expect.unreachable("expected generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationDeckGenerationError);
      expect((error as PresentationDeckGenerationError).issues).toContainEqual(
        expect.objectContaining({
          code: "MISSING_ASSET",
          severity: "error",
          slideId: "slide-17",
          target: "slide-17-visual",
        }),
      );
    }
  });

  it("serializes portable Excalidraw JSON and binary-free cloud JSON", () => {
    const result = generatePresentationDeck({
      storyboard: FOUNDATIONS_OF_AI_STORYBOARD,
      assets: FOUNDATIONS_OF_AI_ASSETS,
      layout: FOUNDATIONS_OF_AI_LAYOUT,
    });
    const portable = JSON.parse(result.portableJson);
    const cloud = JSON.parse(result.cloudJson);

    expect(portable.type).toBe("excalidraw");
    expect(Object.keys(portable.files)).toHaveLength(18);
    expect(cloud).not.toHaveProperty("files");
    expect(
      cloud.elements.filter(
        (element: { type: string }) => element.type === "frame",
      ),
    ).toHaveLength(17);
    expect(result.report.portableBytes).toBe(
      new TextEncoder().encode(result.portableJson).byteLength,
    );
  });
});
