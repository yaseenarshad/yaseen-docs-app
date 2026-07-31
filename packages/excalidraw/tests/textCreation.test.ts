import {
  getResponsiveTextBackgroundRadius,
  getResponsiveTextFontSize,
  getTextBackgroundRadiusForFontSize,
} from "../textCreation";

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

describe("responsive text-background radius", () => {
  it.each([
    [0.1, 100],
    [0.25, 74],
    [0.5, 48],
    [1, 32],
    [1.5, 18],
    [2, 13],
    [3, 8],
    [4, 8],
  ])("resolves zoom %s to a %spx default radius", (zoom, expectedRadius) => {
    expect(getResponsiveTextBackgroundRadius(zoom)).toBe(expectedRadius);
  });

  it("uses the actual text size and clamps safely", () => {
    expect(getTextBackgroundRadiusForFontSize(20)).toBe(5);
    expect(getTextBackgroundRadiusForFontSize(130)).toBe(32);
    expect(getTextBackgroundRadiusForFontSize(440)).toBe(100);
    expect(getTextBackgroundRadiusForFontSize(Number.NaN)).toBe(32);
  });
});
