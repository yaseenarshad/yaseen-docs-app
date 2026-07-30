import { describe, expect, it } from "vitest";

import {
  SMART_SHAPE_DEFINITIONS,
  createSmartShapeMetadata,
  generateSmartShapePoints,
  getSmartShapeHandles,
  getSmartShapeMetadata,
  hitTestSmartShapeHandle,
  updateSmartShapeFromHandle,
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
    expect(-Math.min(...thin.map(([, y]) => y))).toBeGreaterThan(
      -Math.min(...thick.map(([, y]) => y)),
    );
    expect(thin[3][0]).toBe(thick[3][0]);
    expect(thin[3][1] - Math.min(...thin.map(([, y]) => y))).toBe(
      thick[3][1] - Math.min(...thick.map(([, y]) => y)),
    );
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

  it("exposes zoom-aware handles and adjusts from rotated scene points", () => {
    const metadata = createSmartShapeMetadata("arrow-right");
    const arrow = {
      type: "line",
      x: 100,
      y: 200,
      width: 200,
      height: 100,
      angle: Math.PI / 2,
      locked: false,
      customData: { yasinSmartShape: metadata },
      points: generateSmartShapePoints(
        "arrow-right",
        200,
        100,
        metadata.parameters,
      ),
    } as unknown as ExcalidrawLinearElement;
    const handles = getSmartShapeHandles(arrow);

    expect(handles.map(({ name }) => name)).toEqual(["shaft", "head"]);
    expect(
      hitTestSmartShapeHandle(arrow, handles[0].scenePoint, { value: 2 }),
    ).toBe("shaft");

    const adjusted = updateSmartShapeFromHandle(
      arrow,
      "head",
      handles[1].scenePoint,
    );
    expect(getSmartShapeMetadata(adjusted)?.parameters.headLengthRatio).toBe(
      0.4,
    );
  });
});
