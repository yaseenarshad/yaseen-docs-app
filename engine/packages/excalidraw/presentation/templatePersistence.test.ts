import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import { describe, expect, it } from "vitest";

import canonicalStoryboard from "./fixtures/canonical-storyboard.json";
import { applyPresentationTemplate } from "./templateApplication";
import { presentationTemplateRegistry } from "./templateRegistry";

import type { StoryboardPresentation } from "./sceneContract";

const presentation = canonicalStoryboard as StoryboardPresentation;
const template = presentationTemplateRegistry.resolve({
  id: "foundations-editorial",
  version: "1.0.0",
});

describe("presentation template persistence", () => {
  it("stores one SVG binary while many slide elements reference its FileId", () => {
    const first = applyPresentationTemplate({
      presentation,
      slide: presentation.slides[0],
      template,
    });
    const second = applyPresentationTemplate({
      presentation,
      slide: presentation.slides[1],
      template,
      origin: { x: 1440, y: 0 },
    });
    const elements = [...first.elements, ...second.elements];
    const files = { ...first.files, ...second.files };
    const plateElements = elements.filter(
      (element) =>
        element.type === "image" &&
        element.fileId === "template-foundations-editorial-v1",
    );

    expect(plateElements).toHaveLength(2);
    expect(
      Object.keys(files).filter(
        (fileId) => fileId === "template-foundations-editorial-v1",
      ),
    ).toEqual(["template-foundations-editorial-v1"]);
  });

  it("embeds the shared SVG once for local export and strips binaries for cloud scene JSON", () => {
    const first = applyPresentationTemplate({
      presentation,
      slide: presentation.slides[0],
      template,
    });
    const second = applyPresentationTemplate({
      presentation,
      slide: presentation.slides[1],
      template,
      origin: { x: 1440, y: 0 },
    });
    const elements = [...first.elements, ...second.elements];
    const files = { ...first.files, ...second.files };

    const local = JSON.parse(serializeAsJSON(elements, {}, files, "local"));
    const database = JSON.parse(
      serializeAsJSON(elements, {}, files, "database"),
    );

    expect(local.files).toHaveProperty("template-foundations-editorial-v1");
    expect(local.files["template-foundations-editorial-v1"].dataURL).toMatch(
      /^data:image\/svg\+xml/,
    );
    expect(database).not.toHaveProperty("files");
    expect(database.elements).toHaveLength(elements.length);
    expect(
      database.elements.filter(
        (element: { fileId?: string }) =>
          element.fileId === "template-foundations-editorial-v1",
      ),
    ).toHaveLength(2);
  });
});
