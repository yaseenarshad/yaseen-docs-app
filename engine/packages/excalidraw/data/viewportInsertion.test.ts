import { describe, expect, it } from "vitest";

import {
  IMAGE_STUDIO_INSERTION,
  resolveViewportInsertion,
} from "./viewportInsertion";

describe("resolveViewportInsertion", () => {
  it.each([
    [0.25, 1280],
    [1, 320],
    [2, 160],
  ])("targets 320 screen pixels at zoom %s", (zoom, expectedWidth) => {
    expect(
      resolveViewportInsertion({
        naturalWidth: 1600,
        naturalHeight: 800,
        zoom,
        viewport: { width: 1600, height: 1000 },
        offsets: {},
        request: IMAGE_STUDIO_INSERTION,
      }),
    ).toMatchObject({ width: expectedWidth, height: expectedWidth / 2 });
  });

  it("caps the visual to 55 percent of the usable viewport", () => {
    const result = resolveViewportInsertion({
      naturalWidth: 2000,
      naturalHeight: 1000,
      zoom: 1,
      viewport: { width: 500, height: 400 },
      offsets: { left: 100, right: 50, top: 60, bottom: 20 },
      request: IMAGE_STUDIO_INSERTION,
    });

    expect(result.width).toBeCloseTo(192.5);
    expect(result.centerViewportX).toBe(275);
    expect(result.centerViewportY).toBe(220);
  });

  it("rejects invalid natural dimensions", () => {
    expect(() =>
      resolveViewportInsertion({
        naturalWidth: 0,
        naturalHeight: 100,
        zoom: 1,
        viewport: { width: 500, height: 400 },
        offsets: {},
        request: IMAGE_STUDIO_INSERTION,
      }),
    ).toThrow("positive");
  });
});
