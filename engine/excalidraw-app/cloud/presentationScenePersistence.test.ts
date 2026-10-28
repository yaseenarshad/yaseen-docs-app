import { describe, expect, it } from "vitest";

import {
  MAX_HOSTED_PRESENTATION_SCENE_BYTES,
  getPresentationSceneByteSize,
  isPresentationSceneWithinCloudLimit,
  sanitizeCloudPresentationScene,
} from "./presentationScenePersistence";

describe("hosted presentation scene persistence", () => {
  it("persists stable asset/version references without HTML or capability URLs", () => {
    const scene = JSON.stringify({
      type: "excalidraw",
      elements: [
        {
          id: "hosted",
          customData: {
            animationAsset: { assetId: "lesson", version: 2 },
            animationUrl: `/api/presentation-animations/${"a".repeat(64)}`,
            generationData: {
              status: "done",
              html: "<!doctype html><script>large bundle</script>",
            },
          },
        },
      ],
    });

    const persisted = JSON.parse(sanitizeCloudPresentationScene(scene));
    expect(persisted.elements[0].customData).toEqual({
      animationAsset: { assetId: "lesson", version: 2 },
    });
  });

  it("keeps embedded HTML for local-compatible animations with no hosted reference", () => {
    const scene = JSON.stringify({
      elements: [
        {
          id: "embedded",
          customData: {
            generationData: { status: "done", html: "<html>portable</html>" },
          },
        },
      ],
    });
    expect(sanitizeCloudPresentationScene(scene)).toBe(scene);
  });

  it("measures the UTF-8 payload against the Convex safety margin", () => {
    const proof = JSON.stringify({
      elements: Array.from({ length: 50 }, (_, index) => ({
        id: `animation-${index}`,
        customData: {
          animationAsset: { assetId: `asset-${index}`, version: 1 },
        },
      })),
    });
    expect(getPresentationSceneByteSize(proof)).toBeLessThan(10_000);
    expect(isPresentationSceneWithinCloudLimit(proof)).toBe(true);
    expect(
      isPresentationSceneWithinCloudLimit(
        "x".repeat(MAX_HOSTED_PRESENTATION_SCENE_BYTES),
      ),
    ).toBe(false);
  });
});
