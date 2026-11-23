import { describe, expect, it } from "vitest";

import {
  SMART_SHAPE_DEFINITIONS,
  SMART_SHAPE_HANDLE_PARAMETERS,
  createSmartShapeMetadata,
  getSmartShapeDefinition,
  generateSmartShapePoints,
  getSmartShapeHandles,
  getSmartShapeMetadata,
  hitTestSmartShapeHandle,
  updateSmartShapeFromHandle,
  updateSmartShapeParameter,
} from "../src/smartShape";

import type { SmartShapeId } from "../src/smartShape";
import type { ExcalidrawLinearElement } from "../src/types";

describe("Smart Shapes", () => {
  it("registers the complete initial catalog", () => {
    expect(SMART_SHAPE_DEFINITIONS.map(({ id }) => id)).toEqual([
      "arrow-right",
      "arrow-left",
      "arrow-up",
      "arrow-down",
      "curved-arrow",
      "u-turn-arrow",
      "double-arrow",
      "circle-arrow",
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

// YAZ-4356: the four arrows drawn along a centre line.
describe("the arrows along a centre line", () => {
  const ARROWS: SmartShapeId[] = [
    "curved-arrow",
    "u-turn-arrow",
    "double-arrow",
    "circle-arrow",
  ];
  const SIZES: Array<[number, number]> = [
    [200, 120],
    [40, 30],
    [600, 200],
    [90, 420],
  ];

  const definitionOf = (id: SmartShapeId) => getSmartShapeDefinition(id)!;

  /** Every value a parameter can take that matters: both limits, the default, and past each limit. */
  const parameterCases = (id: SmartShapeId) => {
    const definition = definitionOf(id);
    return Object.entries(definition.limits).flatMap(([name, limits]) => {
      const [min, max] = limits!;
      return [min, max, (min + max) / 2, min - 1, max + 1].map((value) => ({
        ...definition.defaults,
        [name]: value,
      }));
    });
  };

  const box = (points: readonly (readonly [number, number])[]) => {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  };

  /** True when two segments that share no end cross each other. */
  const crosses = (
    [a, b]: readonly [readonly number[], readonly number[]],
    [c, d]: readonly [readonly number[], readonly number[]],
  ) => {
    const side = (
      p: readonly number[],
      q: readonly number[],
      r: readonly number[],
    ) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return (
      side(a, b, c) * side(a, b, d) < -1e-9 &&
      side(c, d, a) * side(c, d, b) < -1e-9
    );
  };

  const simple = (points: readonly (readonly [number, number])[]) => {
    const segments = points
      .slice(1)
      .map((point, index) => [points[index], point] as const);
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 2; j < segments.length; j++) {
        if (i === 0 && j === segments.length - 1) {
          continue;
        }
        if (crosses(segments[i], segments[j])) {
          return false;
        }
      }
    }
    return true;
  };

  const elementOf = (
    id: SmartShapeId,
    width: number,
    height: number,
    parameters: Record<string, number>,
    angle = 0,
  ) =>
    ({
      type: "line",
      x: 300,
      y: 150,
      width,
      height,
      angle,
      locked: false,
      customData: {
        yasinSmartShape: { ...createSmartShapeMetadata(id), parameters },
      },
      points: generateSmartShapePoints(id, width, height, parameters),
    } as unknown as ExcalidrawLinearElement);

  it("are closed, simple outlines that fill their box at every size and parameter value", () => {
    for (const id of ARROWS) {
      for (const [width, height] of SIZES) {
        for (const parameters of parameterCases(id)) {
          const points = generateSmartShapePoints(
            id,
            width,
            height,
            parameters,
          );
          const label = `${id} ${width}x${height} ${JSON.stringify(
            parameters,
          )}`;
          expect(points.flat().every(Number.isFinite), label).toBe(true);
          expect(points.length, label).toBeGreaterThan(
            id === "double-arrow" ? 10 : 30,
          );
          expect(points[0], label).toEqual([0, 0]);
          expect(points.at(-1), label).toEqual(points[0]);
          const { width: boxWidth, height: boxHeight } = box(points);
          expect(boxWidth, label).toBeCloseTo(width, 6);
          expect(boxHeight, label).toBeCloseTo(height, 6);
          expect(simple(points), label).toBe(true);
        }
      }
    }
  });

  it("are closed filled shapes with a handle for each of their parameters", () => {
    for (const id of ARROWS) {
      const definition = definitionOf(id);
      expect(definition.closed).toBe(true);
      expect(
        definition.handles
          .map((handle) => SMART_SHAPE_HANDLE_PARAMETERS[handle])
          .sort(),
      ).toEqual(Object.keys(definition.limits).sort());
      expect(Object.keys(definition.defaults).sort()).toEqual(
        Object.keys(definition.limits).sort(),
      );
    }
    expect(definitionOf("curved-arrow").handles).toEqual([
      "bend",
      "thickness",
      "head",
    ]);
    expect(definitionOf("u-turn-arrow").handles).toEqual(["gap", "thickness"]);
    expect(definitionOf("double-arrow").handles).toEqual(["thickness", "head"]);
    expect(definitionOf("circle-arrow").handles).toEqual([
      "opening",
      "thickness",
    ]);
  });

  it("change shape with each parameter, and hold a value past a limit at that limit", () => {
    for (const id of ARROWS) {
      const { defaults, limits, width, height } = definitionOf(id);
      for (const [name, range] of Object.entries(limits)) {
        const [min, max] = range!;
        const at = (value: number) =>
          generateSmartShapePoints(id, width, height, {
            ...defaults,
            [name]: value,
          });
        expect(at(min), `${id} ${name}`).not.toEqual(at(max));
        expect(at(max + 5), `${id} ${name}`).toEqual(at(max));
        expect(at(min - 5), `${id} ${name}`).toEqual(at(min));
      }
    }
  });

  it("move a handle's parameter to where the handle is dragged, within its limits", () => {
    for (const id of ARROWS) {
      const { defaults, limits, handles, width, height } = definitionOf(id);
      for (const angle of [0, Math.PI / 3]) {
        const element = elementOf(id, width, height, defaults, angle);
        expect(getSmartShapeHandles(element).map(({ name }) => name)).toEqual(
          handles,
        );
        for (const handle of handles) {
          const parameter = SMART_SHAPE_HANDLE_PARAMETERS[handle];
          const [min, max] = limits[parameter]!;
          const target = min + (max - min) * 0.3;
          // Where the handle sits at the target value, with the shape's first point kept in
          // place, as a drag on the board keeps it.
          const moved = elementOf(
            id,
            width,
            height,
            { ...defaults, [parameter]: target },
            angle,
          );
          const [originX, originY] = moved.points[0];
          const scene = getSmartShapeHandles({
            ...moved,
            x: element.x + originX,
            y: element.y + originY,
          } as ExcalidrawLinearElement).find(
            ({ name }) => name === handle,
          )!.scenePoint;
          const dragged = updateSmartShapeFromHandle(element, handle, scene);
          const label = `${id} ${handle} angle ${angle}`;
          // A rotated shape turns about its box centre, which moves a little as the shape changes.
          expect(
            getSmartShapeMetadata(dragged)!.parameters[parameter],
            label,
          ).toBeCloseTo(target, angle ? 1 : 2);
          expect(box(dragged.points).width, label).toBeCloseTo(width, 6);
          expect(box(dragged.points).height, label).toBeCloseTo(height, 6);

          for (const far of [-10_000, 10_000]) {
            const value = getSmartShapeMetadata(
              updateSmartShapeFromHandle(element, handle, [far, far] as never),
            )!.parameters[parameter];
            expect(value, `${label} far ${far}`).toBeGreaterThanOrEqual(min);
            expect(value, `${label} far ${far}`).toBeLessThanOrEqual(max);
          }
        }
      }
    }
  });

  it("drag the double arrow's heads together and keep its shaft centred", () => {
    const element = elementOf("double-arrow", 240, 100, {
      thicknessRatio: 0.45,
      headLengthRatio: 0.25,
    });
    const handle = getSmartShapeHandles(element).find(
      ({ name }) => name === "head",
    )!;
    const dragged = updateSmartShapeFromHandle(element, "head", [
      handle.scenePoint[0] - 24,
      handle.scenePoint[1],
    ] as never);
    expect(
      getSmartShapeMetadata(dragged)!.parameters.headLengthRatio,
    ).toBeCloseTo(0.35, 2);
    const xs = dragged.points.map(([x]) => x);
    const tipX = Math.max(...xs);
    const tailX = Math.min(...xs);
    expect(tipX - tailX).toBeCloseTo(240, 6);
  });
});
