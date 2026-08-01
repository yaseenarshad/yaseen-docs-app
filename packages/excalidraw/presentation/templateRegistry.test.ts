import { describe, expect, it } from "vitest";

import {
  FOUNDATIONS_OF_AI_TEMPLATE,
  PresentationTemplateRegistryError,
  createPresentationTemplateRegistry,
  presentationTemplateRegistry,
  type PresentationTemplateDefinition,
} from "./templateRegistry";

describe("presentationTemplateRegistry", () => {
  it("resolves the canonical SVG template without per-slide geometry", () => {
    const template = presentationTemplateRegistry.resolve({
      id: "foundations-editorial",
      version: "1.0.0",
    });

    expect(template.canvas).toEqual({ width: 1280, height: 720 });
    expect(template.supportedRenderModes).toEqual([
      "image",
      "animation",
      "full-native",
    ]);
    expect(template.plate).toMatchObject({
      kind: "svg",
      assetId: "template-foundations-editorial-v1",
      mimeType: "image/svg+xml",
    });
    expect(template.plate.svg).toContain('viewBox="0 0 1280 720"');
    expect(template.slots.headline.bounds).toEqual({
      x: 62,
      y: 108,
      width: 515,
      height: 142,
    });
    expect(template.slots["static-visual"].bounds).toEqual(
      template.slots["animated-visual"].bounds,
    );
  });

  it("returns one shared plate identity across repeated resolutions", () => {
    const reference = {
      id: "foundations-editorial",
      version: "1.0.0",
    };
    const first = presentationTemplateRegistry.resolve(reference);
    const second = presentationTemplateRegistry.resolve(reference);

    expect(first.plate).toBe(second.plate);
    expect(first.plate.assetId).toBe("template-foundations-editorial-v1");
  });

  it("supports dense four- and five-card slides without duplicating the SVG plate", () => {
    const standard = presentationTemplateRegistry.resolve({
      id: "foundations-editorial",
      version: "1.0.0",
    });
    const dense = presentationTemplateRegistry.resolve({
      id: "foundations-editorial-dense",
      version: "1.0.0",
    });

    expect(dense.slots["card-5"]).toBeDefined();
    expect(dense.plate).toBe(standard.plate);
  });

  it("rejects unknown semantic slots when creating a registry", () => {
    const invalid = structuredClone(
      FOUNDATIONS_OF_AI_TEMPLATE,
    ) as PresentationTemplateDefinition;
    invalid.slots["footer-logo"] = {
      id: "footer-logo",
      kind: "text",
      role: "footer-logo" as never,
      bounds: { x: 0, y: 0, width: 100, height: 20 },
      zIndex: 2,
      alignment: "left",
      verticalAlignment: "top",
      font: {
        family: "inter",
        size: 12,
        weight: "normal",
        lineHeight: 1,
      },
      maxLines: 1,
      overflow: "warn",
    };

    expect(() => createPresentationTemplateRegistry([invalid])).toThrow(
      'slot "footer-logo" has unknown role',
    );
  });

  it("rejects slots whose bounds escape the template canvas", () => {
    const invalid = structuredClone(
      FOUNDATIONS_OF_AI_TEMPLATE,
    ) as PresentationTemplateDefinition;
    invalid.slots.headline.bounds.width = 2000;

    expect(() => createPresentationTemplateRegistry([invalid])).toThrow(
      'slot "headline" bounds exceed the 1280×720 canvas',
    );
  });

  it("rejects duplicate template versions", () => {
    expect(() =>
      createPresentationTemplateRegistry([
        FOUNDATIONS_OF_AI_TEMPLATE,
        structuredClone(FOUNDATIONS_OF_AI_TEMPLATE),
      ]),
    ).toThrow("duplicate template foundations-editorial@1.0.0");
  });

  it("fails visibly for missing and incompatible template versions", () => {
    expect(() =>
      presentationTemplateRegistry.resolve({
        id: "missing-template",
        version: "1.0.0",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "TEMPLATE_NOT_FOUND",
      }),
    );

    try {
      presentationTemplateRegistry.resolve({
        id: "foundations-editorial",
        version: "2.0.0",
      });
      expect.unreachable("expected exact version resolution to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationTemplateRegistryError);
      expect(error).toMatchObject({
        code: "TEMPLATE_VERSION_UNAVAILABLE",
        availableVersions: ["1.0.0"],
      });
    }
  });
});
