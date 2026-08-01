import { FONT_FAMILY } from "@excalidraw/common";
import { describe, expect, it } from "vitest";

import canonicalStoryboard from "./fixtures/canonical-storyboard.json";
import { ANIMATION_BRIDGE_MARKER } from "./animationBridge";
import { ANIMATION_PROTOCOL_VERSION } from "./animationProtocol";
import {
  applyPresentationTemplate,
  getPresentationMetadata,
} from "./templateApplication";
import { presentationTemplateRegistry } from "./templateRegistry";

import type { StoryboardPresentation } from "./sceneContract";

const presentation = canonicalStoryboard as StoryboardPresentation;
const template = presentationTemplateRegistry.resolve({
  id: "foundations-editorial",
  version: "1.0.0",
});

const elementByRole = (
  result: ReturnType<typeof applyPresentationTemplate>,
  role: string,
) =>
  result.elements.find((element) => {
    const metadata = getPresentationMetadata(element);
    return metadata?.kind === "slide-child" && metadata.role === role;
  });

describe("applyPresentationTemplate", () => {
  it("creates a frame, one locked SVG plate, and editable native text", () => {
    const result = applyPresentationTemplate({
      presentation,
      slide: presentation.slides[0],
      template,
      origin: { x: 240, y: 120 },
    });

    const frame = result.elements.find((element) => element.type === "frame");
    const plate = elementByRole(result, "template-background");
    const eyebrow = elementByRole(result, "eyebrow");
    const headline = elementByRole(result, "headline");

    expect(frame).toMatchObject({
      x: 240,
      y: 120,
      width: 1280,
      height: 720,
    });
    expect(getPresentationMetadata(frame!)).toMatchObject({
      kind: "slide-frame",
      slideId: "slide-image",
      templateVersion: "1.0.0",
    });
    expect(plate).toMatchObject({
      type: "image",
      x: 240,
      y: 120,
      width: 1280,
      height: 720,
      locked: true,
      fileId: "template-foundations-editorial-v1",
    });
    expect(result.files["template-foundations-editorial-v1"]).toMatchObject({
      mimeType: "image/svg+xml",
    });
    expect(eyebrow).toMatchObject({
      type: "text",
      fontFamily: FONT_FAMILY["IBM Plex Mono"],
      fontWeight: "bold",
      locked: false,
      autoResize: false,
    });
    expect(headline).toMatchObject({
      type: "text",
      fontFamily: FONT_FAMILY.Inter,
      fontWeight: "bold",
      width: 515,
      height: 142,
      locked: false,
      autoResize: false,
    });
  });

  it("uses the same visual bounds for an image and an embedded animation", () => {
    const image = applyPresentationTemplate({
      presentation,
      slide: presentation.slides[0],
      template,
    });
    const animationSlide = {
      ...structuredClone(presentation.slides[0]),
      renderMode: "animation" as const,
      visual: {
        kind: "animation" as const,
        source: {
          kind: "embedded-html" as const,
          html: "<!doctype html><title>Token animation</title>",
        },
      },
    };
    const animation = applyPresentationTemplate({
      presentation,
      slide: animationSlide,
      template,
    });

    const imageVisual = elementByRole(image, "static-visual");
    const animationPreview = elementByRole(animation, "animation-preview");
    const animationVisual = elementByRole(animation, "animated-visual");

    expect(imageVisual).toMatchObject({
      type: "image",
      x: 630,
      y: 59,
      width: 590,
      height: 332,
      fileId: "asset-prediction-diagram",
    });
    expect(animationVisual).toMatchObject({
      type: "iframe",
      x: 630,
      y: 59,
      width: 590,
      height: 332,
      customData: {
        animationProtocolVersion: ANIMATION_PROTOCOL_VERSION,
        generationData: {
          status: "done",
        },
      },
    });
    expect(animationPreview).toMatchObject({
      type: "image",
      x: 630,
      y: 59,
      width: 590,
      height: 332,
    });
    expect(
      animationPreview?.type === "image" && animationPreview.fileId
        ? animation.files[animationPreview.fileId]
        : null,
    ).toMatchObject({ mimeType: "image/svg+xml" });
    expect(animation.elements.indexOf(animationPreview!)).toBeLessThan(
      animation.elements.indexOf(animationVisual!),
    );
    expect(
      animationVisual?.customData?.generationData &&
        typeof animationVisual.customData.generationData === "object" &&
        "html" in animationVisual.customData.generationData
        ? animationVisual.customData.generationData.html
        : "",
    ).toContain(ANIMATION_BRIDGE_MARKER);
    expect({
      x: imageVisual?.x,
      y: imageVisual?.y,
      width: imageVisual?.width,
      height: imageVisual?.height,
    }).toEqual({
      x: animationVisual?.x,
      y: animationVisual?.y,
      width: animationVisual?.width,
      height: animationVisual?.height,
    });
  });

  it("stores only an immutable reference for a hosted animation", () => {
    const hostedSlide = {
      ...structuredClone(presentation.slides[0]),
      renderMode: "animation" as const,
      visual: {
        kind: "animation" as const,
        source: {
          kind: "asset" as const,
          assetId: "lesson-animation",
          version: 3,
        },
      },
    };
    const hosted = applyPresentationTemplate({
      presentation,
      slide: hostedSlide,
      template,
    });
    const animation = elementByRole(hosted, "animated-visual");

    expect(animation?.customData).toMatchObject({
      animationProtocolVersion: ANIMATION_PROTOCOL_VERSION,
      animationAsset: { assetId: "lesson-animation", version: 3 },
    });
    expect(animation?.customData).not.toHaveProperty("generationData.html");
    expect(hosted.warnings).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("trusted asset resolver"),
      }),
    );
  });

  it("wraps copy explicitly and returns clear slot overflow warnings", () => {
    const slide = structuredClone(presentation.slides[0]);
    slide.body = Array.from(
      { length: 40 },
      () => "A deliberately long teaching sentence",
    ).join(" ");

    const result = applyPresentationTemplate({
      presentation,
      slide,
      template,
    });
    const body = elementByRole(result, "body");

    expect(body?.type).toBe("text");
    expect(body && "text" in body ? body.text : "").toContain("\n");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        slideId: "slide-image",
        slotId: "body",
        severity: "warning",
        message: expect.stringContaining("maximum of 4 lines"),
      }),
    );
  });

  it("regenerates stable IDs and semantic roles for compatible templates", () => {
    const first = applyPresentationTemplate({
      presentation,
      slide: presentation.slides[0],
      template,
    });
    const compatibleTemplate = structuredClone(template);
    compatibleTemplate.version = "1.0.1";
    const compatibleSlide = structuredClone(presentation.slides[0]);
    compatibleSlide.templateVersion = "1.0.1";
    const second = applyPresentationTemplate({
      presentation,
      slide: compatibleSlide,
      template: compatibleTemplate,
    });

    expect(second.elements.map((element) => element.id)).toEqual(
      first.elements.map((element) => element.id),
    );
    expect(getPresentationMetadata(second.elements[0])).toMatchObject({
      kind: "slide-frame",
      slideId: "slide-image",
      presentationOrder: 1,
      templateVersion: "1.0.1",
    });
    expect(
      second.elements
        .slice(1)
        .map((element) => getPresentationMetadata(element)),
    ).toEqual(
      first.elements
        .slice(1)
        .map((element) => getPresentationMetadata(element)),
    );
  });
});
