import { describe, expect, it } from "vitest";

import { SHAPE_CATALOG } from "./shapes";

describe("shape catalog", () => {
  it("contains unique, native Excalidraw shape templates", () => {
    expect(new Set(SHAPE_CATALOG.map(({ id }) => id)).size).toBe(
      SHAPE_CATALOG.length,
    );
    for (const shape of SHAPE_CATALOG) {
      expect(shape.create(200, 200).length).toBeGreaterThan(0);
      expect(shape.create(200, 200)[0].type).not.toBe("image");
    }
  });
});
