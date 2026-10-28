import { describe, expect, it } from "vitest";

import canonicalStoryboard from "./fixtures/canonical-storyboard.json";

import {
  PRESENTATION_SCENE_SCHEMA_VERSION,
  StoryboardContractError,
  createPresentationElementId,
  mapSlideToSceneMetadata,
  validateStoryboardPresentation,
  type PresentationTemplateContract,
  type StoryboardPresentation,
} from "./sceneContract";

const templates: readonly PresentationTemplateContract[] = [
  {
    id: "foundations-editorial",
    textLimits: {
      eyebrow: 32,
      headline: 90,
      body: 240,
      cardHeadline: 60,
      cardBody: 160,
    },
  },
];

const presentation = canonicalStoryboard as StoryboardPresentation;

describe("validateStoryboardPresentation", () => {
  it("accepts one canonical presentation containing all supported render modes", () => {
    expect(validateStoryboardPresentation(presentation, templates)).toEqual(
      presentation,
    );
  });

  it.each([
    ["image", undefined, "visual is required"],
    ["animation", { kind: "image", assetId: "wrong" }, "must be animation"],
    [
      "full-native",
      { kind: "animation", source: { kind: "embedded-html", html: "ok" } },
      "must be native",
    ],
  ])(
    "rejects an invalid %s visual with a slide-specific error",
    (renderMode, visual, expectedMessage) => {
      const invalid = structuredClone(presentation) as Record<string, any>;
      invalid.slides[0].renderMode = renderMode;
      invalid.slides[0].visual = visual;

      expect(() =>
        validateStoryboardPresentation(invalid, templates),
      ).toThrowError(
        expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              slideId: "slide-image",
              message: expect.stringContaining(expectedMessage),
            }),
          ]),
        }),
      );
    },
  );

  it("rejects full-slide HTML as an unsupported render mode", () => {
    const invalid = structuredClone(presentation) as Record<string, any>;
    invalid.slides[0].renderMode = "html";

    expect(() => validateStoryboardPresentation(invalid, templates)).toThrow(
      'renderMode "html" is unsupported',
    );
  });

  it("requires an exact template version for deterministic resolution", () => {
    const invalid = structuredClone(presentation) as Record<string, any>;
    delete invalid.slides[0].templateVersion;

    expect(() => validateStoryboardPresentation(invalid, templates)).toThrow(
      "templateVersion is required",
    );
  });

  it("requires hosted animations to pin an immutable asset version", () => {
    const invalid = structuredClone(presentation) as Record<string, any>;
    invalid.slides[1].visual.source = {
      kind: "asset",
      assetId: "lesson-animation",
    };

    expect(() => validateStoryboardPresentation(invalid, templates)).toThrow(
      "animation asset version must be a positive integer",
    );
  });

  it("reports missing copy, unknown templates, and text overflow together", () => {
    const invalid = structuredClone(presentation) as Record<string, any>;
    invalid.slides[0].headline = "";
    invalid.slides[0].templateId = "missing-template";
    invalid.slides[1].body = "x".repeat(241);

    try {
      validateStoryboardPresentation(invalid, templates);
      expect.unreachable("expected contract validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(StoryboardContractError);
      expect((error as StoryboardContractError).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            slideId: "slide-image",
            path: "headline",
            message: "headline is required",
          }),
          expect.objectContaining({
            slideId: "slide-image",
            path: "templateId",
            message: 'template "missing-template" is not registered',
          }),
          expect.objectContaining({
            slideId: "slide-animation",
            path: "body",
            message: "body exceeds the template limit of 240 characters",
          }),
        ]),
      );
    }
  });

  it("rejects duplicate slide IDs and presentation orders", () => {
    const invalid = structuredClone(presentation);
    invalid.slides[1].id = invalid.slides[0].id;
    invalid.slides[2].order = invalid.slides[0].order;

    expect(() => validateStoryboardPresentation(invalid, templates)).toThrow(
      "duplicate slide ID",
    );
    expect(() => validateStoryboardPresentation(invalid, templates)).toThrow(
      "duplicate presentation order",
    );
  });
});

describe("scene metadata mapping", () => {
  it("maps a slide to versioned frame and semantic child metadata", () => {
    const mapping = mapSlideToSceneMetadata(
      presentation,
      presentation.slides[0],
    );

    expect(mapping.frame).toEqual({
      kind: "slide-frame",
      schemaVersion: PRESENTATION_SCENE_SCHEMA_VERSION,
      generatorVersion: "canvas-skill@1.0.0",
      presentationId: "foundations-of-ai",
      slideId: "slide-image",
      presentationOrder: 1,
      templateId: "foundations-editorial",
      templateVersion: "1.0.0",
      renderMode: "image",
    });
    expect(mapping.children.staticVisual).toEqual({
      kind: "slide-child",
      schemaVersion: PRESENTATION_SCENE_SCHEMA_VERSION,
      slideId: "slide-image",
      role: "static-visual",
    });
    expect(mapping.children.cards("probability")).toEqual({
      kind: "slide-child",
      schemaVersion: PRESENTATION_SCENE_SCHEMA_VERSION,
      slideId: "slide-image",
      role: "card",
      slotId: "probability",
    });
  });

  it("creates stable, role-specific element IDs", () => {
    const input = {
      presentationId: "foundations-of-ai",
      slideId: "slide-image",
      role: "headline" as const,
    };

    expect(createPresentationElementId(input)).toBe(
      createPresentationElementId(input),
    );
    expect(createPresentationElementId(input)).not.toBe(
      createPresentationElementId({ ...input, role: "body" }),
    );
    expect(createPresentationElementId(input)).toMatch(/^yp_[a-z0-9]+$/);
  });
});
