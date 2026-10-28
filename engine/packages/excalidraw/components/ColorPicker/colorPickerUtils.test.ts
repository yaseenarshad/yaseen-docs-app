import { COLOR_PALETTE } from "@excalidraw/common";

import {
  SEMANTIC_COLOR_HOTKEYS,
  getPaletteColorForSemanticHotkey,
  getSemanticColorHotkey,
  getSemanticColorNameForHotkey,
} from "./colorPickerUtils";

describe("semantic color hotkeys", () => {
  const approvedMap = {
    transparent: "t",
    black: "b",
    white: "w",
    gray: "d",
    red: "r",
    pink: "p",
    grape: "a",
    violet: "v",
    blue: "u",
    cyan: "c",
    teal: "e",
    green: "g",
    yellow: "y",
    orange: "o",
    bronze: "n",
  } as const;

  it("defines the complete approved map with unique keys", () => {
    expect(SEMANTIC_COLOR_HOTKEYS).toEqual(approvedMap);
    expect(new Set(Object.values(SEMANTIC_COLOR_HOTKEYS))).toHaveLength(
      Object.keys(COLOR_PALETTE).length,
    );
  });

  it("resolves canonical colors and keys in both directions", () => {
    expect(
      getSemanticColorHotkey({
        colorName: "blue",
        colorValue: COLOR_PALETTE.blue,
      }),
    ).toBe("u");
    expect(getSemanticColorNameForHotkey("U")).toBe("blue");
    expect(getSemanticColorNameForHotkey("e")).toBe("teal");
    expect(getSemanticColorNameForHotkey("?")).toBe(null);
  });

  it("uses canonical values when a custom palette is reordered or renamed", () => {
    const palette = {
      customBlue: COLOR_PALETTE.blue,
      red: COLOR_PALETTE.red,
      transparent: COLOR_PALETTE.transparent,
    };

    expect(
      getSemanticColorHotkey({
        colorName: "customBlue",
        colorValue: palette.customBlue,
      }),
    ).toBe("u");
    expect(
      getPaletteColorForSemanticHotkey({
        key: "R",
        palette,
        activeShade: 3,
      }),
    ).toBe(COLOR_PALETTE.red[3]);
  });

  it("does not shift or invent bindings for missing and unknown colors", () => {
    const palette = {
      red: COLOR_PALETTE.red,
      brand: "#123456",
    };

    expect(
      getPaletteColorForSemanticHotkey({
        key: "b",
        palette,
        activeShade: 4,
      }),
    ).toBe(null);
    expect(
      getSemanticColorHotkey({
        colorName: "brand",
        colorValue: palette.brand,
      }),
    ).toBe(null);
  });
});
