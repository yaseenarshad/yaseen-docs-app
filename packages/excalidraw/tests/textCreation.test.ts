import { getResponsiveTextFontSize } from "../textCreation";

describe("getResponsiveTextFontSize", () => {
  it.each([
    [0.1, 440],
    [0.25, 299],
    [0.5, 197],
    [1, 130],
    [1.5, 75],
    [2, 51],
    [3, 32],
    [4, 32],
  ])("resolves zoom %s to %spx", (zoom, expectedFontSize) => {
    expect(getResponsiveTextFontSize(zoom)).toBe(expectedFontSize);
  });

  it.each([0.001, Number.MIN_VALUE])(
    "clamps extreme zoom-out %s to the maximum",
    (zoom) => {
      expect(getResponsiveTextFontSize(zoom)).toBe(440);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back safely for invalid zoom %s",
    (zoom) => {
      expect(getResponsiveTextFontSize(zoom)).toBe(130);
    },
  );
});
