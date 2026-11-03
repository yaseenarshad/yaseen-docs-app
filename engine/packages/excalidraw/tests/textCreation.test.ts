import {
  DEFAULT_NEW_TEXT_SCREEN_SIZE,
  getResponsiveTextBackgroundRadius,
  getResponsiveTextFontSize,
  getTextBackgroundRadiusForFontSize,
  scaleTextBackgroundRadiusForFontSize,
  setNewTextScreenSize,
  wrapWidthAtEdge,
} from "../textCreation";

describe("getResponsiveTextFontSize (YAZ-4247: the same size on screen at every zoom)", () => {
  afterEach(() => setNewTextScreenSize(DEFAULT_NEW_TEXT_SCREEN_SIZE));

  it.each([
    [0.5, 28],
    [1, 14],
    [2, 7],
    [3, 4.67],
  ])("resolves zoom %s to %spx (14px on screen)", (zoom, expectedFontSize) => {
    expect(getResponsiveTextFontSize(zoom)).toBe(expectedFontSize);
  });

  it("follows the app's screen size", () => {
    setNewTextScreenSize(24);
    expect(getResponsiveTextFontSize(0.5)).toBe(48);
    expect(getResponsiveTextFontSize(2)).toBe(12);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back safely for invalid zoom %s",
    (zoom) => {
      expect(getResponsiveTextFontSize(zoom)).toBe(14);
    },
  );
});

describe("wrapWidthAtEdge (YAZ-4247)", () => {
  it("is null while the text fits, the room left once it passes the edge", () => {
    expect(wrapWidthAtEdge(100, 200, 400, 16)).toBeNull();
    expect(wrapWidthAtEdge(100, 320, 400, 16)).toBe(300);
  });

  it("keeps growing when under two font sizes of room are left", () => {
    expect(wrapWidthAtEdge(380, 50, 400, 16)).toBeNull();
  });
});

describe("responsive text-background radius", () => {
  // At the 14 px default (YAZ-4265): font 28, 14 and 7 px.
  it.each([
    [0.5, 7],
    [1, 3],
    [2, 2],
  ])("resolves zoom %s to a %spx default radius", (zoom, expectedRadius) => {
    expect(getResponsiveTextBackgroundRadius(zoom)).toBe(expectedRadius);
  });

  it("uses the actual text size and clamps safely", () => {
    expect(getTextBackgroundRadiusForFontSize(20)).toBe(5);
    expect(getTextBackgroundRadiusForFontSize(130)).toBe(32);
    expect(getTextBackgroundRadiusForFontSize(440)).toBe(100);
    expect(getTextBackgroundRadiusForFontSize(Number.NaN)).toBe(32);
  });

  it("keeps custom text-background rounding proportional as font px changes", () => {
    expect(scaleTextBackgroundRadiusForFontSize(32, 130, 260)).toBe(64);
    expect(scaleTextBackgroundRadiusForFontSize(64, 260, 65)).toBe(16);
    expect(scaleTextBackgroundRadiusForFontSize(48, 130, 65)).toBe(24);
    expect(scaleTextBackgroundRadiusForFontSize(84, 341, 682)).toBe(100);
    expect(scaleTextBackgroundRadiusForFontSize(0, 130, 260)).toBe(0);
  });
});
