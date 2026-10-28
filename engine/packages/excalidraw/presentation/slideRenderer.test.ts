import { FONT_FAMILY } from "@excalidraw/common";
import { describe, expect, it } from "vitest";

import type { FileId } from "@excalidraw/element/types";

import canonicalStoryboard from "./fixtures/canonical-storyboard.json";
import { getPresentationMetadata } from "./templateApplication";
import { renderPresentationSlide } from "./slideRenderer";

import type { BinaryFiles, DataURL } from "../types";
import type { StoryboardPresentation, StoryboardSlide } from "./sceneContract";

const presentation = canonicalStoryboard as StoryboardPresentation;
const imageAssetId = "asset-prediction-diagram" as FileId;
const imageAssets: BinaryFiles = {
  [imageAssetId]: {
    id: imageAssetId,
    mimeType: "image/png",
    dataURL: "data:image/png;base64,cHJlc2VudGF0aW9u" as DataURL,
    created: 0,
  },
};

const childRoles = (result: ReturnType<typeof renderPresentationSlide>) =>
  result.elements.flatMap((element) => {
    const metadata = getPresentationMetadata(element);
    return metadata?.kind === "slide-child" ? [metadata.role] : [];
  });

describe("renderPresentationSlide", () => {
  it("renders the image fixture with a shared plate, native copy, and supplied asset", () => {
    const result = renderPresentationSlide({
      presentation,
      slide: presentation.slides[0],
      assets: imageAssets,
    });

    expect(result.mode).toBe("image");
    expect(result.issues).toEqual([]);
    expect(childRoles(result)).toEqual([
      "template-background",
      "eyebrow",
      "headline",
      "body",
      "card",
      "static-visual",
    ]);
    expect(Object.keys(result.files).sort()).toEqual([
      "asset-prediction-diagram",
      "template-foundations-editorial-v1",
    ]);
  });

  it("keeps image and animation anatomy identical outside the visual element", () => {
    const base = structuredClone(presentation.slides[0]);
    const animationSlide: StoryboardSlide = {
      ...base,
      renderMode: "animation",
      visual: {
        kind: "animation",
        source: {
          kind: "embedded-html",
          html: "<!doctype html><title>Animated visual</title>",
        },
      },
    };
    const image = renderPresentationSlide({
      presentation,
      slide: base,
      assets: imageAssets,
    });
    const animation = renderPresentationSlide({
      presentation,
      slide: animationSlide,
    });
    const withoutVisual = (roles: string[]) =>
      roles.filter(
        (role) =>
          role !== "static-visual" &&
          role !== "animation-preview" &&
          role !== "animated-visual",
      );

    expect(withoutVisual(childRoles(animation))).toEqual(
      withoutVisual(childRoles(image)),
    );
    expect(animation.elements.at(-1)?.type).toBe("iframe");
    expect(childRoles(animation).at(-1)).toBe("animated-visual");
  });

  it("uses an authored animation preview when available and keeps the fallback when missing", () => {
    const base = structuredClone(presentation.slides[0]);
    const previewAssetId = "animation-preview" as FileId;
    const animationSlide: StoryboardSlide = {
      ...base,
      renderMode: "animation",
      visual: {
        kind: "animation",
        source: {
          kind: "embedded-html",
          html: "<!doctype html><title>Animated visual</title>",
        },
        previewAssetId,
      },
    };
    const preview = {
      id: previewAssetId,
      mimeType: "image/png" as const,
      dataURL: "data:image/png;base64,cHJldmlldw==" as DataURL,
      created: 0,
    };
    const authored = renderPresentationSlide({
      presentation,
      slide: animationSlide,
      assets: { [previewAssetId]: preview },
    });
    const authoredElement = authored.elements.find((element) => {
      const metadata = getPresentationMetadata(element);
      return (
        metadata?.kind === "slide-child" &&
        metadata.role === "animation-preview"
      );
    });
    const missing = renderPresentationSlide({
      presentation,
      slide: animationSlide,
    });
    const missingElement = missing.elements.find((element) => {
      const metadata = getPresentationMetadata(element);
      return (
        metadata?.kind === "slide-child" &&
        metadata.role === "animation-preview"
      );
    });

    expect(authoredElement).toMatchObject({
      type: "image",
      fileId: previewAssetId,
    });
    expect(authored.files[previewAssetId]).toEqual(preview);
    expect(missingElement).not.toMatchObject({ fileId: previewAssetId });
    expect(missing.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_ASSET",
        severity: "warning",
        target: previewAssetId,
      }),
    );
  });

  it("renders full-native as editable Excalidraw elements without a plate binary or iframe", () => {
    const result = renderPresentationSlide({
      presentation,
      slide: presentation.slides[2],
    });
    const frame = result.elements[0];

    expect(result.mode).toBe("full-native");
    expect(result.issues).toEqual([]);
    expect(result.files).toEqual({});
    expect(result.elements.some((element) => element.type === "iframe")).toBe(
      false,
    );
    expect(result.elements.some((element) => element.type === "image")).toBe(
      false,
    );
    expect(
      result.elements.some((element) => element.type === "rectangle"),
    ).toBe(true);
    expect(
      result.elements
        .filter((element) => element.id !== frame.id)
        .every((element) => element.frameId === frame.id && !element.locked),
    ).toBe(true);
    expect(
      result.elements.find((element) => {
        const metadata = getPresentationMetadata(element);
        return (
          element.type === "text" &&
          metadata?.kind === "slide-child" &&
          metadata.role === "headline"
        );
      }),
    ).toMatchObject({
      fontFamily: FONT_FAMILY.Inter,
      fontWeight: "bold",
      autoResize: false,
    });
    expect(childRoles(result)).toContain("native-visual");
  });

  it("returns a slide-scoped error when a static visual asset is missing", () => {
    const result = renderPresentationSlide({
      presentation,
      slide: presentation.slides[0],
    });

    expect(result.issues).toContainEqual({
      code: "MISSING_ASSET",
      severity: "error",
      slideId: "slide-image",
      target: "asset-prediction-diagram",
      message: 'image asset "asset-prediction-diagram" is unavailable',
    });
  });

  it("regenerates equivalent mode/role/type schemas with stable IDs", () => {
    const render = () =>
      renderPresentationSlide({
        presentation,
        slide: presentation.slides[0],
        assets: imageAssets,
      });
    const summarize = (result: ReturnType<typeof renderPresentationSlide>) =>
      result.elements.map((element) => ({
        id: element.id,
        type: element.type,
        metadata: getPresentationMetadata(element),
      }));

    expect(summarize(render())).toEqual(summarize(render()));
    expect(summarize(render())).toMatchInlineSnapshot(`
      [
        {
          "id": "yp_16omn06",
          "metadata": {
            "generatorVersion": "canvas-skill@1.0.0",
            "kind": "slide-frame",
            "presentationId": "foundations-of-ai",
            "presentationOrder": 1,
            "renderMode": "image",
            "schemaVersion": 1,
            "slideId": "slide-image",
            "templateId": "foundations-editorial",
            "templateVersion": "1.0.0",
          },
          "type": "frame",
        },
        {
          "id": "yp_1g6r042",
          "metadata": {
            "kind": "slide-child",
            "role": "template-background",
            "schemaVersion": 1,
            "slideId": "slide-image",
          },
          "type": "image",
        },
        {
          "id": "yp_12s2oo8",
          "metadata": {
            "kind": "slide-child",
            "role": "eyebrow",
            "schemaVersion": 1,
            "slideId": "slide-image",
          },
          "type": "text",
        },
        {
          "id": "yp_12yiajb",
          "metadata": {
            "kind": "slide-child",
            "role": "headline",
            "schemaVersion": 1,
            "slideId": "slide-image",
          },
          "type": "text",
        },
        {
          "id": "yp_1f2kq8j",
          "metadata": {
            "kind": "slide-child",
            "role": "body",
            "schemaVersion": 1,
            "slideId": "slide-image",
          },
          "type": "text",
        },
        {
          "id": "yp_1fho93s",
          "metadata": {
            "kind": "slide-child",
            "role": "card",
            "schemaVersion": 1,
            "slideId": "slide-image",
            "slotId": "probability",
          },
          "type": "text",
        },
        {
          "id": "yp_p9la5q",
          "metadata": {
            "kind": "slide-child",
            "role": "static-visual",
            "schemaVersion": 1,
            "slideId": "slide-image",
          },
          "type": "image",
        },
      ]
    `);
  });
});
