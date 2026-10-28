import {
  CORNER_RADIUS,
  DEFAULT_ADAPTIVE_RADIUS,
  ROUNDNESS,
} from "@excalidraw/common";

import {
  getCornerRadius,
  getRelativeImageCornerRadius,
  getRequestedCornerRadius,
  normalizeCornerRadius,
} from "../src/utils";

import type { ExcalidrawElement } from "../src/types";

const elementWithRoundness = (
  roundness: ExcalidrawElement["roundness"],
): ExcalidrawElement =>
  ({
    type: "rectangle",
    roundness,
  } as ExcalidrawElement);

describe("getRelativeImageCornerRadius", () => {
  it.each([
    [400, 300, 3],
    [1200, 800, 8],
    [30, 30, 0],
    [20000, 20000, 100],
  ])("%ix%i -> %i (1% of shortest side, clamped)", (w, h, expected) => {
    expect(getRelativeImageCornerRadius(w, h)).toBe(expected);
  });
});

describe("continuous corner radius", () => {
  it("publishes the approved numeric contract", () => {
    expect(CORNER_RADIUS).toEqual({
      min: 0,
      max: 100,
      step: 1,
      default: 32,
      presets: [0, 4, 8, 16, 32, 64],
    });
  });

  it.each([
    [-10, 0],
    [0, 0],
    [15.4, 15],
    [15.6, 16],
    [100, 100],
    [140, 100],
  ])("normalizes %s to %s scene pixels", (value, expected) => {
    expect(normalizeCornerRadius(value)).toBe(expected);
  });

  it("falls back to the approved default for non-finite input", () => {
    expect(normalizeCornerRadius(Number.NaN)).toBe(DEFAULT_ADAPTIVE_RADIUS);
    expect(normalizeCornerRadius(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_ADAPTIVE_RADIUS,
    );
  });

  it("returns the requested value without replacing legacy value-less data", () => {
    expect(getRequestedCornerRadius(elementWithRoundness(null))).toBe(0);
    expect(
      getRequestedCornerRadius(
        elementWithRoundness({ type: ROUNDNESS.ADAPTIVE_RADIUS }),
      ),
    ).toBe(DEFAULT_ADAPTIVE_RADIUS);
    expect(
      getRequestedCornerRadius(
        elementWithRoundness({
          type: ROUNDNESS.ADAPTIVE_RADIUS,
          value: 64,
        }),
      ),
    ).toBe(64);
  });

  it("clamps an explicit requested radius to half the available geometry", () => {
    expect(
      getCornerRadius(
        100,
        elementWithRoundness({
          type: ROUNDNESS.ADAPTIVE_RADIUS,
          value: 80,
        }),
      ),
    ).toBe(50);

    expect(
      getCornerRadius(
        200,
        elementWithRoundness({
          type: ROUNDNESS.ADAPTIVE_RADIUS,
          value: 80,
        }),
      ),
    ).toBe(80);
  });

  it("uses explicit scene pixels for proportional diamond geometry too", () => {
    expect(
      getCornerRadius(
        100,
        elementWithRoundness({
          type: ROUNDNESS.PROPORTIONAL_RADIUS,
          value: 64,
        }),
      ),
    ).toBe(50);
  });

  it("keeps existing value-less algorithms visually unchanged", () => {
    expect(
      getCornerRadius(
        40,
        elementWithRoundness({ type: ROUNDNESS.ADAPTIVE_RADIUS }),
      ),
    ).toBe(10);
    expect(
      getCornerRadius(
        200,
        elementWithRoundness({ type: ROUNDNESS.ADAPTIVE_RADIUS }),
      ),
    ).toBe(DEFAULT_ADAPTIVE_RADIUS);
    expect(
      getCornerRadius(
        80,
        elementWithRoundness({ type: ROUNDNESS.PROPORTIONAL_RADIUS }),
      ),
    ).toBe(20);
  });
});
