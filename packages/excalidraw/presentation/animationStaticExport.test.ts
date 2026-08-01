import { describe, expect, it } from "vitest";

import { exportToSvg } from "../scene/export";

import canonicalStoryboard from "./fixtures/canonical-storyboard.json";

import { getPresentationMetadata } from "./templateApplication";
import { renderPresentationSlide } from "./slideRenderer";

import type { StoryboardPresentation, StoryboardSlide } from "./sceneContract";

describe("animation static export", () => {
  it("exports the deterministic poster without an iframe placeholder", async () => {
    const presentation = canonicalStoryboard as StoryboardPresentation;
    const animationSlide: StoryboardSlide = {
      ...structuredClone(presentation.slides[0]),
      renderMode: "animation",
      visual: {
        kind: "animation",
        source: {
          kind: "embedded-html",
          html: "<!doctype html><title>Animated visual</title>",
        },
      },
    };
    const result = renderPresentationSlide({
      presentation,
      slide: animationSlide,
    });
    const preview = result.elements.find((element) => {
      const metadata = getPresentationMetadata(element);
      return (
        metadata?.kind === "slide-child" &&
        metadata.role === "animation-preview"
      );
    });
    const iframe = result.elements.find((element) => element.type === "iframe");

    expect(preview).toBeDefined();
    expect(iframe).toBeDefined();

    const svg = await exportToSvg(
      result.elements,
      {
        exportBackground: false,
        viewBackgroundColor: "#ffffff",
      },
      result.files,
    );

    expect(svg.querySelector(`[data-id="${preview!.id}"]`)).not.toBeNull();
    expect(svg.querySelector(`[data-id="${iframe!.id}"]`)).toBeNull();
  });
});
