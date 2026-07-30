import { describe, expect, it } from "vitest";

import { getShape, SHAPE_CATALOG } from "./shapes";

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

  it("includes the initial Smart Shape catalog", () => {
    expect(getShape("smart:arrow-right")?.title).toBe("Arrow right");
    expect(getShape("smart:brace-left")?.title).toBe("Curly brace left");
    expect(getShape("smart:callout-rounded")?.title).toBe("Rounded callout");
  });

  it("creates a native metadata-bearing polygon", () => {
    const shape = getShape("smart:arrow-right")!;
    const [element] = shape.create(400, 300);
    expect(element.type).toBe("line");
    expect(element.customData?.yasinSmartShape).toMatchObject({
      version: 1,
      id: "arrow-right",
    });
  });
});
