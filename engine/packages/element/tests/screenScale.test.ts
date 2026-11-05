import { DEFAULT_ADAPTIVE_RADIUS, ROUNDNESS } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type { LocalPoint } from "@excalidraw/math";

import type { AppState } from "@excalidraw/excalidraw/types";

import {
  BASE_BINDING_GAP,
  getBindingGap,
  maxBindingDistance_simple,
} from "../src/binding";
import { getArrowheadPoints } from "../src/bounds";
import { getSizeRelativeResizeUpdates } from "../src/resizeElements";
import {
  getElementStyleScale,
  getStyleScale,
  toBoardSize,
  toScreenSize,
  withStyleScale,
} from "../src/screenScale";
import { generateRoughOptions } from "../src/shape";
import { getCornerRadius } from "../src/utils";

import type { Drawable } from "roughjs/bin/core";
import type { ExcalidrawElement, ExcalidrawLinearElement } from "../src/types";

/** `API.createElement` drops `customData`: put it back. */
const withData = <T extends ExcalidrawElement>(
  element: T,
  customData: ExcalidrawElement["customData"],
): T => (customData ? { ...element, customData } : element);

/**
 * YAZ-4406 (4J): the screen-scale switch point. A shape made at zoom z keeps
 * its look on screen: its board sizes are screen px ÷ z, and the renderer's
 * own sizes divide by `customData.styleScale`. At zoom 1 nothing changes.
 */
describe("screenScale.ts (YAZ-4406)", () => {
  it("makes the style scale the zoom only while the switch is on", () => {
    expect(getStyleScale(100, true)).toBe(100);
    expect(getStyleScale(0.25, true)).toBe(0.25);
    expect(getStyleScale(100, false)).toBe(1);
    expect(getStyleScale(100, undefined)).toBe(1);
    expect(getStyleScale(0, true)).toBe(1);
    expect(getStyleScale(Number.NaN, true)).toBe(1);
  });

  it("turns screen px into board px and back, to 4 digits, and changes nothing at scale 1", () => {
    expect(toBoardSize(2, 100)).toBe(0.02);
    expect(toBoardSize(2, 3)).toBe(0.6667);
    expect(toScreenSize(0.02, 100)).toBe(2);
    expect(toScreenSize(0.6667, 3)).toBe(2);
    // scale 1: the very same number (no rounding to 4 digits)
    expect(toBoardSize(1.23456789, 1)).toBe(1.23456789);
    expect(toScreenSize(1.23456789, 1)).toBe(1.23456789);
  });

  it("reads an element's style scale, and 1 for one without a valid one", () => {
    expect(getElementStyleScale({ customData: { styleScale: 50 } })).toBe(50);
    expect(getElementStyleScale({ customData: undefined })).toBe(1);
    expect(getElementStyleScale({ customData: { styleScale: 0 } })).toBe(1);
    expect(getElementStyleScale({ customData: { styleScale: -2 } })).toBe(1);
    expect(getElementStyleScale({ customData: { styleScale: "5" } })).toBe(1);
  });

  it("adds the style scale to customData, and leaves customData alone at 1", () => {
    const data = { other: true };
    expect(withStyleScale(data, 1)).toBe(data);
    expect(withStyleScale(undefined, 1)).toBeUndefined();
    expect(withStyleScale(data, 100)).toEqual({ other: true, styleScale: 100 });
    expect(withStyleScale(undefined, 1 / 3)).toEqual({ styleScale: 0.3333 });
  });
});

describe("the renderer's own sizes follow the style scale (YAZ-4406)", () => {
  const rectangle = (styleScale?: number) =>
    withData(
      API.createElement({
        type: "rectangle",
        width: 1,
        height: 0.5,
        strokeWidth: 0.02,
        strokeStyle: "dashed",
        roughness: 1,
        roundness: null,
      }),
      styleScale ? { styleScale } : undefined,
    );

  it("divides the rough.js wobble and the dash widening by the scale", () => {
    const scaled = generateRoughOptions(rectangle(100));
    expect(scaled.maxRandomnessOffset).toBeCloseTo(0.02, 10);
    expect(scaled.strokeWidth).toBeCloseTo(0.02 + 0.005, 10);
    // a shape made at zoom 1 keeps rough.js's own default and +0.5
    const plain = generateRoughOptions(rectangle());
    expect(plain.maxRandomnessOffset).toBeUndefined();
    expect(plain.strokeWidth).toBeCloseTo(0.52, 10);
  });

  it("measures the small-shape roughness rule in screen px", () => {
    // 1 × 0.5 board px made at 100× is 100 × 50 on screen: no reduction
    expect(generateRoughOptions(rectangle(100)).roughness).toBe(1);
    // the same board size made at zoom 1 is tiny: reduced
    expect(generateRoughOptions(rectangle()).roughness).toBeLessThan(1);
  });

  it("divides the adaptive corner (no value) by the scale, and keeps a fraction of a px", () => {
    const adaptive = (styleScale?: number) =>
      withData(
        API.createElement({
          type: "rectangle",
          roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
        }),
        styleScale ? { styleScale } : undefined,
      );
    expect(getCornerRadius(10, adaptive(100))).toBeCloseTo(
      DEFAULT_ADAPTIVE_RADIUS / 100,
      10,
    );
    expect(getCornerRadius(1000, adaptive())).toBe(DEFAULT_ADAPTIVE_RADIUS);
    // a picked radius of 0.08 board px is drawn as 0.08, not rounded to 0
    expect(
      getCornerRadius(
        10,
        API.createElement({
          type: "rectangle",
          roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 0.08 },
        }),
      ),
    ).toBe(0.08);
  });

  it("divides the arrowhead size by the scale", () => {
    const arrow = (styleScale?: number) =>
      withData(
        API.createElement({
          type: "arrow",
          points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(1000, 0)],
        }) as ExcalidrawLinearElement,
        styleScale ? { styleScale } : undefined,
      );
    // a straight path from 0,0 to 1000,0
    const shape = [
      {
        shape: "linearPath",
        options: {},
        sets: [
          {
            type: "path",
            ops: [
              { op: "move", data: [0, 0] },
              { op: "bcurveTo", data: [333, 0, 666, 0, 1000, 0] },
            ],
          },
        ],
      },
    ] as unknown as Drawable[];
    const headLength = (styleScale?: number) => {
      const points = getArrowheadPoints(
        arrow(styleScale),
        shape,
        "end",
        "arrow",
      )!;
      // the tip is at 1000,0; the head's back corners at 1000 - size
      return 1000 - points[2];
    };
    const plain = headLength();
    expect(plain).toBeGreaterThan(10);
    expect(headLength(10)).toBeCloseTo(plain / 10, 6);
  });
});

/**
 * YAZ-4414 (4M): at a high zoom the binding reach is capped at 60 screen px,
 * so an arrow drawn near tiny shapes at 10,000% does not bind both its ends
 * inside one. At zoom 4 or less nothing changes.
 */
describe("the binding reach and gap at high zoom (YAZ-4414)", () => {
  const zoom = (value: number) => ({ value } as AppState["zoom"]);

  it("caps the reach at 60 screen px ÷ zoom above zoom 4", () => {
    expect(maxBindingDistance_simple(zoom(100))).toBeCloseTo(0.6, 10);
    expect(maxBindingDistance_simple(zoom(10))).toBeCloseTo(6, 10);
  });

  it.each([
    [undefined, 15],
    [0.25, 30],
    [0.5, 20],
    [1, 15],
    [2, 15],
    [4, 15],
  ])("keeps the old reach at zoom %s: %s board px", (value, expected) => {
    expect(
      maxBindingDistance_simple(value === undefined ? undefined : zoom(value)),
    ).toBeCloseTo(expected, 10);
  });

  it("divides the gap by the arrow's style scale", () => {
    const target = { strokeWidth: 0.02 };
    expect(getBindingGap(target, { elbowed: false })).toBe(
      BASE_BINDING_GAP + 0.01,
    );
    expect(
      getBindingGap(target, {
        elbowed: false,
        customData: { styleScale: 100 },
      }),
    ).toBeCloseTo(BASE_BINDING_GAP / 100 + 0.01, 10);
  });
});

/**
 * YAZ-4408 (4L): a resize keeps a shape's border in proportion. A shape made
 * zoomed in (or a resize past 0.5–100 board px) scales its line and corner
 * exactly and its style scale with them; a normal shape at 100% is as before.
 */
describe("a resize keeps the border and the style scale in proportion (YAZ-4408)", () => {
  it("scales the line and the corner of a shape made at 10,000% exactly, and its style scale", () => {
    const rect = withData(
      API.createElement({
        type: "rectangle",
        width: 1,
        height: 1,
        strokeWidth: 0.02,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 0.08 },
      }),
      { styleScale: 100 },
    );
    // the number key makes it 48 board px: 48 times bigger
    expect(
      getSizeRelativeResizeUpdates(rect, 48, 48, { mode: "group" }),
    ).toEqual({
      strokeWidth: 0.96,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 3.84 },
      customData: { styleScale: 2.083 },
    });
  });

  it("drops the style scale when the resize brings it back to 1, and keeps other customData", () => {
    const rect = withData(
      API.createElement({
        type: "rectangle",
        width: 1,
        height: 1,
        strokeWidth: 0.02,
        roundness: null,
      }),
      { styleScale: 100, note: "kept" },
    );
    expect(
      getSizeRelativeResizeUpdates(rect, 100, 100, { mode: "single" }),
    ).toEqual({ strokeWidth: 2, customData: { note: "kept" } });
  });

  it("scales exactly when a normal shape's line would leave 0.5–100 board px", () => {
    const rect = API.createElement({
      type: "rectangle",
      width: 100,
      height: 100,
      strokeWidth: 2,
      roundness: null,
    });
    // 2 px × 0.1 = 0.2 px: no clamp to 0.5; the style scale keeps the look
    expect(
      getSizeRelativeResizeUpdates(rect, 10, 10, { mode: "single" }),
    ).toEqual({ strokeWidth: 0.2, customData: { styleScale: 10 } });
  });

  it("keeps the old behavior for a normal shape inside the range", () => {
    const rect = API.createElement({
      type: "rectangle",
      width: 100,
      height: 100,
      strokeWidth: 2,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
    });
    // the line rounds to tenths and the corner to whole px, no customData
    expect(
      getSizeRelativeResizeUpdates(rect, 133, 133, { mode: "single" }),
    ).toEqual({
      strokeWidth: 2.7,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 21 },
    });
  });
});
