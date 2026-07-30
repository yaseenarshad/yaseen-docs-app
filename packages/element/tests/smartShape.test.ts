import { describe, expect, it } from "vitest";

import {
  SMART_SHAPE_DEFINITIONS,
  createSmartShapeMetadata,
  generateSmartShapePoints,
  getSmartShapeMetadata,
  updateSmartShapeParameter,
} from "../src/smartShape";
import type { ExcalidrawLinearElement } from "../src/types";

describe("Smart Shapes", () => {
  it("registers the complete initial catalog", () => {
    expect(SMART_SHAPE_DEFINITIONS.map(({ id }) => id)).toEqual([
      "arrow-right",
      "arrow-left",
      "arrow-up",
      "arrow-down",
      "chevron-right",
      "chevron-left",
      "chevron-up",
      "chevron-down",
      "brace-left",
      "brace-right",
      "bracket-left",
      "bracket-right",
      "parenthesis-left",
      "parenthesis-right",
      "callout-rectangle",
      "callout-rounded",
    ]);
  });

  it("generates finite geometry for every definition", () => {
    for (const definition of SMART_SHAPE_DEFINITIONS) {
      const points = generateSmartShapePoints(
        definition.id,
        definition.width,
        definition.height,
        definition.defaults,
      );
      expect(points.length).toBeGreaterThan(2);
      expect(points.flat().every(Number.isFinite)).toBe(true);
      if (definition.closed) {
        expect(points.at(-1)).toEqual(points[0]);
      }
    }
  });

  it("changes arrow shaft thickness without moving the tip", () => {
    const thin = generateSmartShapePoints("arrow-right", 200, 100, {
      shaftRatio: 0.2,
      headLengthRatio: 0.4,
    });
    const thick = generateSmartShapePoints("arrow-right", 200, 100, {
      shaftRatio: 0.8,
      headLengthRatio: 0.4,
    });
    expect(thin[0][1]).toBeGreaterThan(thick[0][1]);
    expect(thin[3]).toEqual(thick[3]);
  });

  it("guards metadata and regenerates points on parameter updates", () => {
    const metadata = createSmartShapeMetadata("arrow-right");
    const element = {
      type: "line",
      width: 200,
      height: 100,
      customData: { yasinSmartShape: metadata },
      points: generateSmartShapePoints(
        "arrow-right",
        200,
        100,
        metadata.parameters,
      ),
    } as unknown as ExcalidrawLinearElement;

    expect(getSmartShapeMetadata(element)?.id).toBe("arrow-right");
    const updated = updateSmartShapeParameter(element, "shaftRatio", 0.25);
    expect(getSmartShapeMetadata(updated)?.parameters.shaftRatio).toBe(0.25);
    expect(updated.points).not.toEqual(element.points);
    expect(getSmartShapeMetadata({ customData: {} } as never)).toBeNull();
  });
});
