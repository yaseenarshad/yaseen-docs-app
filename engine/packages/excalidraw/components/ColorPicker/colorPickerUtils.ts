import {
  COLOR_PALETTE,
  MAX_CUSTOM_COLORS_USED_IN_CANVAS,
} from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { ColorPickerColor, ColorPaletteCustom } from "@excalidraw/common";

import { atom } from "../../editor-jotai";

export const getColorNameAndShadeFromColor = ({
  palette,
  color,
}: {
  palette: ColorPaletteCustom;
  color: string | null;
}): {
  colorName: ColorPickerColor;
  shade: number | null;
} | null => {
  if (!color) {
    return null;
  }
  for (const [colorName, colorVal] of Object.entries(palette)) {
    if (Array.isArray(colorVal)) {
      const shade = colorVal.indexOf(color);
      if (shade > -1) {
        return { colorName: colorName as ColorPickerColor, shade };
      }
    } else if (colorVal === color) {
      return { colorName: colorName as ColorPickerColor, shade: null };
    }
  }
  return null;
};

const defineSemanticColorHotkeys = <T extends Record<ColorPickerColor, string>>(
  hotkeys: T,
) => hotkeys;

export const SEMANTIC_COLOR_HOTKEYS = defineSemanticColorHotkeys({
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
} as const);

const semanticColorEntries = Object.entries(SEMANTIC_COLOR_HOTKEYS) as [
  ColorPickerColor,
  string,
][];

const hasSamePaletteValue = (
  first: ColorPaletteCustom[string],
  second: ColorPaletteCustom[string],
) => {
  if (Array.isArray(first) && Array.isArray(second)) {
    return (
      first.length === second.length &&
      first.every((color, index) => color === second[index])
    );
  }
  return first === second;
};

const getCanonicalColorName = ({
  colorName,
  colorValue,
}: {
  colorName: string;
  colorValue: ColorPaletteCustom[string];
}): ColorPickerColor | null => {
  if (colorName in SEMANTIC_COLOR_HOTKEYS) {
    return colorName as ColorPickerColor;
  }

  return (
    semanticColorEntries.find(([canonicalName]) =>
      hasSamePaletteValue(colorValue, COLOR_PALETTE[canonicalName]),
    )?.[0] ?? null
  );
};

export const getSemanticColorHotkey = ({
  colorName,
  colorValue,
}: {
  colorName: string;
  colorValue: ColorPaletteCustom[string];
}) => {
  const canonicalColorName = getCanonicalColorName({ colorName, colorValue });
  return canonicalColorName ? SEMANTIC_COLOR_HOTKEYS[canonicalColorName] : null;
};

export const getSemanticColorNameForHotkey = (
  key: string,
): ColorPickerColor | null => {
  const normalizedKey = key.toLowerCase();
  return (
    semanticColorEntries.find(([, hotkey]) => hotkey === normalizedKey)?.[0] ??
    null
  );
};

export const getPaletteColorForSemanticHotkey = ({
  key,
  palette,
  activeShade,
}: {
  key: string;
  palette: ColorPaletteCustom;
  activeShade: number;
}): string | null => {
  const targetColorName = getSemanticColorNameForHotkey(key);
  if (!targetColorName) {
    return null;
  }

  const paletteEntry = Object.entries(palette).find(
    ([colorName, colorValue]) =>
      getCanonicalColorName({ colorName, colorValue }) === targetColorName,
  );
  if (!paletteEntry) {
    return null;
  }

  const colorValue = paletteEntry[1];
  return typeof colorValue === "string"
    ? colorValue
    : colorValue[activeShade] ?? null;
};

export const isCustomColor = ({
  color,
  palette,
}: {
  color: string;
  palette: ColorPaletteCustom;
}) => {
  const paletteValues = Object.values(palette).flat();
  return !paletteValues.includes(color);
};

export const getMostUsedCustomColors = (
  elements: readonly ExcalidrawElement[],
  type: "elementBackground" | "elementStroke",
  palette: ColorPaletteCustom,
) => {
  const elementColorTypeMap = {
    elementBackground: "backgroundColor",
    elementStroke: "strokeColor",
  };

  const colors = elements.filter((element) => {
    if (element.isDeleted) {
      return false;
    }

    const color =
      element[elementColorTypeMap[type] as "backgroundColor" | "strokeColor"];

    return isCustomColor({ color, palette });
  });

  const colorCountMap = new Map<string, number>();
  colors.forEach((element) => {
    const color =
      element[elementColorTypeMap[type] as "backgroundColor" | "strokeColor"];
    if (colorCountMap.has(color)) {
      colorCountMap.set(color, colorCountMap.get(color)! + 1);
    } else {
      colorCountMap.set(color, 1);
    }
  });

  return [...colorCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((c) => c[0])
    .slice(0, MAX_CUSTOM_COLORS_USED_IN_CANVAS);
};

export type ActiveColorPickerSectionAtomType =
  | "custom"
  | "baseColors"
  | "shades"
  | "hex"
  | null;
export const activeColorPickerSectionAtom =
  atom<ActiveColorPickerSectionAtomType>(null);

export type ColorPickerType =
  | "canvasBackground"
  | "elementBackground"
  | "elementStroke";
