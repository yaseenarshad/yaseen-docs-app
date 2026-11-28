import { describe, expect, it } from "vitest";

import {
  SMART_SHAPE_DEFINITIONS,
  SMART_SHAPE_IDS,
  createSmartShapeMetadata,
  generateSmartShapePoints,
  getSmartShapeDefinition,
  getSmartShapeHandleParameter,
  getSmartShapeHandles,
  getSmartShapeMetadata,
  hitTestSmartShapeHandle,
  readSmartShapeParameter,
  resizeSmartShapePoints,
  shouldShowSmartShapeHandles,
  updateSmartShapeFromHandle,
  updateSmartShapeParameter,
} from "../src/smartShape";

import type { SmartShapeId } from "../src/smartShape";
import type { ExcalidrawLinearElement } from "../src/types";

const box = (points: readonly (readonly [number, number])[]) => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
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
  x = 300,
  y = 150,
) =>
  ({
    type: "line",
    x,
    y,
    width,
    height,
    angle,
    locked: false,
    customData: {
      yasinSmartShape: { ...createSmartShapeMetadata(id), parameters },
    },
    points: generateSmartShapePoints(id, width, height, parameters),
  } as unknown as ExcalidrawLinearElement);

describe("Smart Shapes catalog (YAZ-6674)", () => {
  it("registers all 47 Smart Shapes across the 5 categories with roundness: null", () => {
    expect(SMART_SHAPE_DEFINITIONS).toHaveLength(47);
    expect(SMART_SHAPE_DEFINITIONS.map(({ id }) => id)).toEqual([
      ...SMART_SHAPE_IDS,
    ]);
    const categories = new Set(SMART_SHAPE_DEFINITIONS.map((d) => d.category));
    expect([...categories].sort()).toEqual([
      "arrows",
      "banners",
      "basic",
      "brackets",
      "callouts",
    ]);
    for (const def of SMART_SHAPE_DEFINITIONS) {
      expect(def.roundness, def.id).toBeNull();
    }
  });

  it("generates finite, box-fitting, non-self-intersecting geometry for all 47 shapes at small, default, and extreme aspect ratios", () => {
    for (const def of SMART_SHAPE_DEFINITIONS) {
      const sizes: Array<[number, number]> = [
        [24, 24],
        [def.width, def.height],
        [600, 40],
        [40, 600],
      ];
      for (const [width, height] of sizes) {
        const pts = generateSmartShapePoints(
          def.id,
          width,
          height,
          def.defaults,
        );
        const label = `${def.id} ${width}x${height}`;
        expect(pts.length, label).toBeGreaterThan(2);
        expect(pts.flat().every(Number.isFinite), label).toBe(true);
        expect(pts[0], label).toEqual([0, 0]);
        const b = box(pts);
        expect(b.width, label).toBeCloseTo(width, 5);
        expect(b.height, label).toBeCloseTo(height, 5);
        if (def.closed) {
          expect(pts.at(-1), label).toEqual(pts[0]);
          // No duplicate consecutive closing point (e.g. cloud, square pill)
          const secondLast = pts[pts.length - 2];
          const last = pts[pts.length - 1];
          expect(
            Math.hypot(last[0] - secondLast[0], last[1] - secondLast[1]),
            `${label} duplicate closing point`,
          ).toBeGreaterThan(1e-4);
        } else {
          expect(pts.at(-1), label).not.toEqual(pts[0]);
        }
        expect(simple(pts), label).toBe(true);
      }
    }
  });

  it("keeps callout-oval tail centered, plus arms equal, bent-arrow balanced, and wide braces smooth (YAZ-6677)", () => {
    // callout-oval: tail base straddles tipX at extreme tailPositionRatio (0.2 and 0.8)
    for (const ratio of [0.2, 0.8]) {
      const pts = generateSmartShapePoints("callout-oval", 180, 135, {
        tailPositionRatio: ratio,
      });
      const b = box(pts);
      const inBox = pts.map(([x, y]) => [x - b.minX, y - b.minY] as const);
      const tipIdx = inBox.findIndex(([, y]) => Math.abs(y - 135) < 1e-4);
      const prevPt = inBox[tipIdx - 1];
      const nextPt = inBox[(tipIdx + 1) % inBox.length];
      const tipX = inBox[tipIdx][0];
      expect(tipX).toBeCloseTo(ratio * 180, 4);
      expect(tipX).toBeGreaterThan(Math.min(prevPt[0], nextPt[0]));
      expect(tipX).toBeLessThan(Math.max(prevPt[0], nextPt[0]));
    }

    // plus: equal horizontal and vertical arm thickness when stretched non-square (240x100)
    const plusPts = generateSmartShapePoints("plus", 240, 100, {
      thicknessRatio: 0.35,
    });
    const plusBox = box(plusPts);
    const plusInBox = plusPts.map(
      ([x, y]) => [x - plusBox.minX, y - plusBox.minY] as const,
    );
    const verticalArmWidth = plusInBox[1][0] - plusInBox[0][0];
    const horizontalArmHeight = plusInBox[4][1] - plusInBox[3][1];
    expect(verticalArmWidth).toBeCloseTo(35, 4);
    expect(horizontalArmHeight).toBeCloseTo(35, 4);

    // bent-arrow: non-self-intersecting at tiny width (1x200) and equal bar/leg thickness when tall (80x200)
    const tinyBent = generateSmartShapePoints("bent-arrow", 1, 200, {
      thicknessRatio: 0.3,
      headAspect: 0.8,
    });
    expect(simple(tinyBent)).toBe(true);
    const tallBent = generateSmartShapePoints("bent-arrow", 80, 200, {
      thicknessRatio: 0.3,
      headAspect: 0.8,
    });
    const tallBox = box(tallBent);
    const tallInBox = tallBent.map(
      ([x, y]) => [x - tallBox.minX, y - tallBox.minY] as const,
    );
    const barH = tallInBox[6][1] - tallInBox[1][1];
    const legW = tallInBox[7][0] - tallInBox[0][0];
    expect(barH).toBeCloseTo(legW, 4);

    // brace-left: wide stretch (120x200) raises ry proportionally instead of flattening to 18px
    const wideBrace = generateSmartShapePoints("brace-left", 120, 200, {
      cuspRatio: 0.5,
    });
    const wideSpine = wideBrace.filter(([x]) => Math.abs(x - -60) < 1e-4);
    const wideTopEnd = Math.min(...wideSpine.map(([, y]) => y));
    expect(wideTopEnd).toBeCloseTo(42, 4);
  });

  it("samples smooth curves for parentheses, curly braces, and rounded/oval callouts", () => {
    expect(
      generateSmartShapePoints("parenthesis-left", 40, 200, {}).length,
    ).toBeGreaterThanOrEqual(25);
    expect(
      generateSmartShapePoints("parenthesis-right", 40, 200, {}).length,
    ).toBeGreaterThanOrEqual(25);
    expect(
      generateSmartShapePoints("brace-left", 36, 200, { cuspRatio: 0.5 })
        .length,
    ).toBeGreaterThanOrEqual(25);
    expect(
      generateSmartShapePoints("callout-rounded", 180, 130, {
        tailPositionRatio: 0.7,
      }).length,
    ).toBeGreaterThanOrEqual(25);
    expect(
      generateSmartShapePoints("callout-oval", 180, 135, {
        tailPositionRatio: 0.7,
      }).length,
    ).toBeGreaterThanOrEqual(40);
  });

  it("keeps curly brace arcs constant-radius from tiny (16x24) to very tall (40x2000)", () => {
    const tiny = generateSmartShapePoints("brace-left", 16, 24, {
      cuspRatio: 0.5,
    });
    expect(box(tiny).width).toBeCloseTo(16, 5);
    expect(box(tiny).height).toBeCloseTo(24, 5);
    expect(simple(tiny)).toBe(true);

    const tall = generateSmartShapePoints("brace-left", 40, 2000, {
      cuspRatio: 0.5,
    });
    expect(box(tall).width).toBeCloseTo(40, 5);
    expect(box(tall).height).toBeCloseTo(2000, 5);
    // Top quarter arc finishes at y = 18px (not scaled to 250px+): the straight vertical spine
    // runs from y=18 down to y=982.
    const spinePoints = tall.filter(([x]) => Math.abs(x - -20) < 1e-4);
    expect(spinePoints.length).toBeGreaterThanOrEqual(4);
    const topSpineEnd = Math.min(...spinePoints.map(([, y]) => y));
    expect(topSpineEnd).toBeCloseTo(18, 4);
    // Cusp sits at y = 1000
    const cuspPoint = tall.find(([x]) => Math.abs(x - -40) < 1e-4)!;
    expect(cuspPoint[1]).toBeCloseTo(1000, 4);
  });

  it("changes arrow shaft thickness without moving the tip", () => {
    const thin = generateSmartShapePoints("arrow-right", 200, 100, {
      shaftRatio: 0.2,
      headAspect: 0.8,
    });
    const thick = generateSmartShapePoints("arrow-right", 200, 100, {
      shaftRatio: 0.8,
      headAspect: 0.8,
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
    const element = elementOf("arrow-right", 200, 100, metadata.parameters);

    expect(getSmartShapeMetadata(element)?.id).toBe("arrow-right");
    const updated = updateSmartShapeParameter(element, "shaftRatio", 0.25);
    expect(getSmartShapeMetadata(updated)?.parameters.shaftRatio).toBe(0.25);
    expect(updated.points).not.toEqual(element.points);
    expect(getSmartShapeMetadata({ customData: {} } as never)).toBeNull();
  });

  it("exposes zoom-aware handles and adjusts from rotated scene points", () => {
    const metadata = createSmartShapeMetadata("arrow-right");
    const arrow = elementOf(
      "arrow-right",
      200,
      100,
      metadata.parameters,
      Math.PI / 2,
      100,
      200,
    );
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
    expect(getSmartShapeMetadata(adjusted)?.parameters.headAspect).toBeCloseTo(
      0.8,
      2,
    );
  });
});

describe("handles and parameters across all interactive shapes", () => {
  const INTERACTIVE = SMART_SHAPE_DEFINITIONS.filter(
    (def) => def.handles.length > 0,
  );

  it("maps every handle to a parameter with matching defaults and limits", () => {
    for (const def of INTERACTIVE) {
      const handleParams = def.handles
        .map((handle) => getSmartShapeHandleParameter(def, handle))
        .sort();
      expect(handleParams, def.id).toEqual(Object.keys(def.limits).sort());
      expect(Object.keys(def.defaults).sort(), def.id).toEqual(
        Object.keys(def.limits).sort(),
      );
    }
  });

  it("changes shape with each parameter and clamps out-of-range values to limits", () => {
    for (const def of INTERACTIVE) {
      for (const [name, range] of Object.entries(def.limits)) {
        const [min, max] = range!;
        const at = (value: number) =>
          generateSmartShapePoints(def.id, def.width, def.height, {
            ...def.defaults,
            [name]: value,
          });
        expect(at(min), `${def.id} ${name}`).not.toEqual(at(max));
        expect(at(max + 5), `${def.id} ${name}`).toEqual(at(max));
        expect(at(min - 5), `${def.id} ${name}`).toEqual(at(min));
      }
    }
  });

  it("solves every handle accurately at angle 0 and Math.PI / 3 and clamps far drags", () => {
    for (const def of INTERACTIVE) {
      for (const angle of [0, Math.PI / 3]) {
        const element = elementOf(
          def.id,
          def.width,
          def.height,
          def.defaults,
          angle,
        );
        expect(getSmartShapeHandles(element).map(({ name }) => name)).toEqual(
          def.handles,
        );
        for (const handle of def.handles) {
          const parameter = getSmartShapeHandleParameter(def, handle);
          const [min, max] = def.limits[parameter]!;
          const target = min + (max - min) * 0.35;
          const moved = updateSmartShapeParameter(element, parameter, target);
          const scene = getSmartShapeHandles(moved).find(
            ({ name }) => name === handle,
          )!.scenePoint;
          const dragged = updateSmartShapeFromHandle(element, handle, scene);
          const label = `${def.id} ${handle} angle ${angle}`;
          expect(
            getSmartShapeMetadata(dragged)!.parameters[parameter],
            label,
          ).toBeCloseTo(target, 2);
          expect(box(dragged.points).width, label).toBeCloseTo(def.width, 5);
          expect(box(dragged.points).height, label).toBeCloseTo(def.height, 5);

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

  it("drags double-arrow heads together via headAspect and keeps the shaft centred", () => {
    const element = elementOf("double-arrow", 240, 100, {
      thicknessRatio: 0.45,
      headAspect: 0.6,
    });
    const handle = getSmartShapeHandles(element).find(
      ({ name }) => name === "head",
    )!;
    // Move head base 20px inward -> head grows from 60px to 80px -> headAspect = 0.8
    const dragged = updateSmartShapeFromHandle(element, "head", [
      handle.scenePoint[0] - 20,
      handle.scenePoint[1],
    ] as never);
    expect(
      getSmartShapeMetadata(dragged)!.parameters.headAspect,
    ).toBeCloseTo(0.8, 2);
    expect(box(dragged.points).width).toBeCloseTo(240, 5);
  });
});

describe("Parametric resize, headAspect, legacy migration, and flip swap (YAZ-6673)", () => {
  const arrowHeadPx = (
    points: readonly (readonly [number, number])[],
    axis: "x" | "y" = "x",
  ) => {
    // Tip is index 3, head shoulder is index 2
    const idx = axis === "x" ? 0 : 1;
    return Math.abs(points[3][idx] - points[2][idx]);
  };

  it("keeps arrowhead pixel length fixed when extending a filled-arrow shaft", () => {
    const arrow = elementOf("arrow-right", 200, 100, {
      shaftRatio: 0.5,
      headAspect: 0.8,
    });
    expect(arrowHeadPx(arrow.points)).toBeCloseTo(80, 5);

    const longer = resizeSmartShapePoints(arrow, 600, 100)!;
    expect(box(longer.points).width).toBeCloseTo(600, 5);
    expect(box(longer.points).height).toBeCloseTo(100, 5);
    expect(arrowHeadPx(longer.points)).toBeCloseTo(80, 5);

    // Tiny arrow clamps head length to 85% of total length
    const tiny = resizeSmartShapePoints(arrow, 40, 100)!;
    expect(arrowHeadPx(tiny.points)).toBeCloseTo(34, 5);
  });

  it("keeps arrowhead pixel length fixed for vertical arrows and double arrows", () => {
    const up = elementOf("arrow-up", 100, 200, {
      shaftRatio: 0.5,
      headAspect: 0.8,
    });
    expect(arrowHeadPx(up.points, "y")).toBeCloseTo(80, 5);
    const taller = resizeSmartShapePoints(up, 100, 500)!;
    expect(arrowHeadPx(taller.points, "y")).toBeCloseTo(80, 5);

    const dbl = elementOf("double-arrow", 240, 100, {
      thicknessRatio: 0.45,
      headAspect: 0.6,
    });
    const widerDbl = resizeSmartShapePoints(dbl, 600, 100)!;
    // Left head is points[1][0] - points[0][0]
    expect(widerDbl.points[1][0] - widerDbl.points[0][0]).toBeCloseTo(60, 5);
    // Tiny double arrow clamps each head to 42% of width
    const tinyDbl = resizeSmartShapePoints(dbl, 80, 100)!;
    expect(tinyDbl.points[1][0] - tinyDbl.points[0][0]).toBeCloseTo(33.6, 5);
  });

  it("converts legacy headLengthRatio lazily on read and migrates on resize without stretching the head", () => {
    // Legacy 200x100 arrow with headLengthRatio 0.4 had an 80px head (headAspect = 0.8)
    expect(
      readSmartShapeParameter(
        "arrow-right",
        200,
        100,
        { shaftRatio: 0.5, headLengthRatio: 0.4 },
        "headAspect",
      ),
    ).toBeCloseTo(0.8, 5);

    const legacyArrow = elementOf("arrow-right", 200, 100, {
      shaftRatio: 0.5,
      headLengthRatio: 0.4,
    });
    expect(arrowHeadPx(legacyArrow.points)).toBeCloseTo(80, 5);

    // Resizing from 200x100 to 500x100 converts using orig 200x100 -> head stays 80px!
    const resized = resizeSmartShapePoints(legacyArrow, 500, 100)!;
    expect(arrowHeadPx(resized.points)).toBeCloseTo(80, 5);
    const nextMeta = resized.customData?.yasinSmartShape;
    expect(nextMeta?.parameters.headAspect).toBeCloseTo(0.8, 5);
    expect(nextMeta?.parameters.headLengthRatio).toBeUndefined();
  });

  it("swaps paired directional IDs and mirrors asymmetric ratios on horizontal and vertical flips", () => {
    const hPairs: Array<[SmartShapeId, SmartShapeId]> = [
      ["arrow-right", "arrow-left"],
      ["chevron-right", "chevron-left"],
      ["brace-left", "brace-right"],
      ["bracket-left", "bracket-right"],
      ["parenthesis-left", "parenthesis-right"],
    ];
    for (const [a, b] of hPairs) {
      const def = getSmartShapeDefinition(a)!;
      const el = elementOf(a, def.width, def.height, def.defaults);
      const flipped = resizeSmartShapePoints(el, -def.width, def.height)!;
      expect(flipped.customData?.yasinSmartShape?.id).toBe(b);
      const flippedBack = resizeSmartShapePoints(
        { ...el, customData: flipped.customData },
        def.width,
        def.height,
        { flipByX: true },
      )!;
      expect(flippedBack.customData?.yasinSmartShape?.id).toBe(a);
    }

    const vPairs: Array<[SmartShapeId, SmartShapeId]> = [
      ["arrow-up", "arrow-down"],
      ["chevron-up", "chevron-down"],
      ["brace-up", "brace-down"],
      ["bracket-up", "bracket-down"],
    ];
    for (const [a, b] of vPairs) {
      const def = getSmartShapeDefinition(a)!;
      const el = elementOf(a, def.width, def.height, def.defaults);
      const flipped = resizeSmartShapePoints(el, def.width, -def.height)!;
      expect(flipped.customData?.yasinSmartShape?.id).toBe(b);
    }

    // Callouts mirror tailPositionRatio on horizontal flip
    for (const id of [
      "callout-rectangle",
      "callout-rounded",
      "callout-oval",
    ] as const) {
      const el = elementOf(id, 180, 130, { tailPositionRatio: 0.7 });
      const flipped = resizeSmartShapePoints(el, 180, 130, { flipByX: true })!;
      expect(
        flipped.customData?.yasinSmartShape?.parameters.tailPositionRatio,
      ).toBeCloseTo(0.3, 5);
    }

    // Braces mirror cuspRatio along their span axis
    const hBrace = elementOf("brace-up", 200, 36, { cuspRatio: 0.25 });
    const hFlipped = resizeSmartShapePoints(hBrace, 200, 36, {
      flipByX: true,
    })!;
    expect(hFlipped.customData?.yasinSmartShape?.id).toBe("brace-up");
    expect(
      hFlipped.customData?.yasinSmartShape?.parameters.cuspRatio,
    ).toBeCloseTo(0.75, 5);

    const vBrace = elementOf("brace-left", 36, 200, { cuspRatio: 0.25 });
    const vFlipped = resizeSmartShapePoints(vBrace, 36, 200, {
      flipByY: true,
    })!;
    expect(vFlipped.customData?.yasinSmartShape?.id).toBe("brace-left");
    expect(
      vFlipped.customData?.yasinSmartShape?.parameters.cuspRatio,
    ).toBeCloseTo(0.75, 5);
  });

  it("mirrors non-paired asymmetric Smart Shapes on horizontal and vertical flips without snap-back (YAZ-6690)", () => {
    const toBox = (pts: readonly (readonly [number, number])[]) => {
      const b = box(pts);
      return pts.map(([x, y]) => [x - b.minX, y - b.minY] as const);
    };

    const flipXIds: readonly SmartShapeId[] = [
      "bent-arrow",
      "pentagon-arrow",
      "notched-arrow",
      "curved-arrow",
      "right-triangle",
      "parallelogram",
      "tag",
    ];
    for (const id of flipXIds) {
      const def = getSmartShapeDefinition(id)!;
      const el = elementOf(id, def.width, def.height, def.defaults);
      const origBox = toBox(el.points);

      const flipped = resizeSmartShapePoints(el, -def.width, def.height)!;
      const flippedBox = toBox(flipped.points);
      expect(flippedBox, `${id} flipX`).not.toEqual(origBox);
      for (let i = 0; i < origBox.length; i++) {
        expect(flippedBox[i][0], `${id} flipX x[${i}]`).toBeCloseTo(
          def.width - origBox[i][0],
          4,
        );
        expect(flippedBox[i][1], `${id} flipX y[${i}]`).toBeCloseTo(
          origBox[i][1],
          4,
        );
      }

      // Flipping a second time restores the original orientation
      const flippedBack = resizeSmartShapePoints(
        { ...el, customData: flipped.customData },
        def.width,
        def.height,
        { flipByX: true },
      )!;
      const backBox = toBox(flippedBack.points);
      for (let i = 0; i < origBox.length; i++) {
        expect(backBox[i][0], `${id} flipX back x[${i}]`).toBeCloseTo(
          origBox[i][0],
          4,
        );
        expect(backBox[i][1], `${id} flipX back y[${i}]`).toBeCloseTo(
          origBox[i][1],
          4,
        );
      }
    }

    const flipYIds: readonly SmartShapeId[] = [
      "callout-rectangle",
      "callout-rounded",
      "callout-oval",
      "trapezoid",
      "heart",
      "semicircle",
      "bookmark",
      "shield",
    ];
    for (const id of flipYIds) {
      const def = getSmartShapeDefinition(id)!;
      const el = elementOf(id, def.width, def.height, def.defaults);
      const origBox = toBox(el.points);

      const flipped = resizeSmartShapePoints(el, def.width, -def.height)!;
      const flippedBox = toBox(flipped.points);
      expect(flippedBox, `${id} flipY`).not.toEqual(origBox);
      for (let i = 0; i < origBox.length; i++) {
        expect(flippedBox[i][0], `${id} flipY x[${i}]`).toBeCloseTo(
          origBox[i][0],
          4,
        );
        expect(flippedBox[i][1], `${id} flipY y[${i}]`).toBeCloseTo(
          def.height - origBox[i][1],
          4,
        );
      }
    }

    // Flipped non-paired shape keeps mirrored orientation across subsequent handle drags and resizes
    const bent = elementOf("bent-arrow", 180, 180, {
      thicknessRatio: 0.3,
      headAspect: 0.8,
    });
    const flippedBentRes = resizeSmartShapePoints(bent, -180, 180)!;
    const flippedBent = {
      ...bent,
      points: flippedBentRes.points,
      customData: flippedBentRes.customData,
    } as ExcalidrawLinearElement;

    // Head handle now lies on the left half of the mirrored bent-arrow
    const origHeadX = getSmartShapeHandles(bent).find(
      ({ name }) => name === "head",
    )!.scenePoint[0];
    const flippedHead = getSmartShapeHandles(flippedBent).find(
      ({ name }) => name === "head",
    )!;
    expect(flippedHead.scenePoint[0]).toBeLessThan(origHeadX);

    // Dragging head handle keeps flipX intact and solves the parameter accurately
    const updatedBent = updateSmartShapeParameter(
      flippedBent,
      "headAspect",
      1.1,
    );
    expect(getSmartShapeMetadata(updatedBent)?.flipX).toBe(true);
    const targetPt = getSmartShapeHandles(updatedBent).find(
      ({ name }) => name === "head",
    )!.scenePoint;
    const draggedBent = updateSmartShapeFromHandle(
      flippedBent,
      "head",
      targetPt,
    );
    expect(getSmartShapeMetadata(draggedBent)?.flipX).toBe(true);
    expect(
      getSmartShapeMetadata(draggedBent)?.parameters.headAspect,
    ).toBeCloseTo(1.1, 2);

    // Resizing the flipped shape preserves flipX
    const resizedBent = resizeSmartShapePoints(draggedBent, 260, 180)!;
    expect(resizedBent.customData?.yasinSmartShape?.flipX).toBe(true);

    // Vertically flipped callout keeps tail at the top across handle drags
    const callout = elementOf("callout-rounded", 180, 130, {
      tailPositionRatio: 0.7,
    });
    const flippedCalloutRes = resizeSmartShapePoints(callout, 180, -130)!;
    const flippedCallout = {
      ...callout,
      points: flippedCalloutRes.points,
      customData: flippedCalloutRes.customData,
    } as ExcalidrawLinearElement;
    const flippedTail = getSmartShapeHandles(flippedCallout).find(
      ({ name }) => name === "tail",
    )!;
    const calloutBox = box(flippedCallout.points);
    // Tail handle is now at the top edge (y = flippedCallout.y + calloutBox.minY)
    expect(flippedTail.scenePoint[1]).toBeCloseTo(
      flippedCallout.y + calloutBox.minY,
      4,
    );
  });

  it("returns null for non-smart elements or zero dimensions", () => {
    expect(
      resizeSmartShapePoints(
        { type: "rectangle", width: 100, height: 100, customData: {} },
        200,
        100,
      ),
    ).toBeNull();
    const arrow = elementOf("arrow-right", 200, 100, {
      shaftRatio: 0.5,
      headAspect: 0.8,
    });
    expect(resizeSmartShapePoints(arrow, 0, 100)).toBeNull();
    expect(resizeSmartShapePoints(arrow, 200, 0)).toBeNull();
  });

  it("hides inner Smart Shape handles when a shape is small on screen (YAZ-6705)", () => {
    const normalArrow = elementOf("arrow-right", 200, 100, {
      shaftRatio: 0.5,
      headAspect: 0.8,
    });
    expect(shouldShowSmartShapeHandles(normalArrow, { value: 1 })).toBe(true);
    // Zoomed out or shrunk small: inner handles hide so body stays easy to grab
    expect(shouldShowSmartShapeHandles(normalArrow, { value: 0.3 })).toBe(
      false,
    );
    const smallArrow = elementOf("arrow-right", 60, 30, {
      shaftRatio: 0.5,
      headAspect: 0.8,
    });
    expect(shouldShowSmartShapeHandles(smallArrow, { value: 1 })).toBe(false);
    const smallHandle = getSmartShapeHandles(smallArrow)[0];
    expect(
      hitTestSmartShapeHandle(smallArrow, smallHandle.scenePoint, { value: 1 }),
    ).toBeNull();

    // Narrow normal curly brace (40x200) keeps its single tip handle; tiny 28px brace hides it
    const normalBrace = elementOf("brace-right", 40, 200, { cuspRatio: 0.5 });
    expect(shouldShowSmartShapeHandles(normalBrace, { value: 1 })).toBe(true);
    const tinyBrace = elementOf("brace-right", 24, 28, { cuspRatio: 0.5 });
    expect(shouldShowSmartShapeHandles(tinyBrace, { value: 1 })).toBe(false);
  });
});
