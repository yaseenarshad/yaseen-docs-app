import { describe, expect, it } from "vitest";

import { SHAPE_CATALOG } from "./shapes";

describe("Image Studio authored roughness", () => {
  it("keeps every explicit Smart Shape at its authored Artist value", () => {
    const skeletons = SHAPE_CATALOG.flatMap((shape) => shape.create(100, 100));
    expect(skeletons.length).toBeGreaterThan(0);
    expect(skeletons.every((skeleton) => skeleton.roughness === 1)).toBe(true);
  });
});
