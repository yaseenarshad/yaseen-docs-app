/**
 * YAZ-4277 D14: new shapes and text start with the default style. In the
 * host's "Start with the default style" mode (`newElementStyle: "default"`):
 *
 * - a style change on a selected element (or in a text edit) changes that
 *   element only: the action's `currentItem*` writes are dropped;
 * - a style picked with nothing selected (a tool on) still sets `currentItem*`,
 *   so the next shapes get it;
 * - going back to the selection tool sets `currentItem*` to the defaults again.
 *
 * Without the prop, or with "keep", the engine keeps the last style, as
 * upstream Excalidraw does.
 */
import { getStrokeWidthByKey, ROUNDNESS } from "@excalidraw/common";
import {
  getDefaultCornerRadiusForElementType,
  hasVectorStrokeWidth,
  isTextElement,
  isUsingAdaptiveRadius,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "./appState";

import type { AppState } from "./types";

/** The `currentItem*` fields a new element takes its style from. */
export const NEW_ELEMENT_STYLE_KEYS = [
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemVectorStrokeWidth",
  "currentItemWritingStrokeWidth",
  "currentItemStrokeWidthKey",
  "currentItemStrokeStyle",
  "currentItemRoughness",
  "currentItemOpacity",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemTextAlign",
  "currentItemStartArrowhead",
  "currentItemEndArrowhead",
  "currentItemRoundness",
  "currentItemArrowType",
] as const;

export type NewElementStyleKey = typeof NEW_ELEMENT_STYLE_KEYS[number];
export type NewElementStyle = Pick<AppState, NewElementStyleKey>;

/** The default style: the engine's own, then the host's (its Settings › Drawings defaults). */
export const getDefaultNewElementStyle = (
  hostDefaults: Partial<NewElementStyle> | undefined,
): NewElementStyle => {
  const engine = getDefaultAppState();
  const style = {} as Record<NewElementStyleKey, unknown>;
  for (const key of NEW_ELEMENT_STYLE_KEYS) {
    style[key] = hostDefaults?.[key] ?? engine[key];
  }
  return style as NewElementStyle;
};

/**
 * The next appState with its new-element style left as it was, when the
 * style change had a target: a selection or a text in edit.
 */
export const keepNewElementStyle = <T extends Partial<AppState>>(
  state: Pick<
    AppState,
    NewElementStyleKey | "selectedElementIds" | "editingTextElement"
  >,
  next: T,
): T => {
  const hasTarget =
    !!state.editingTextElement ||
    Object.keys(state.selectedElementIds).length > 0;
  if (!hasTarget || !NEW_ELEMENT_STYLE_KEYS.some((key) => key in next)) {
    return next;
  }
  const kept: Partial<AppState> = { ...next };
  for (const key of NEW_ELEMENT_STYLE_KEYS) {
    if (key in next) {
      (kept as Record<string, unknown>)[key] = state[key];
    }
  }
  return kept as T;
};

/** True for the tools that select: going back to one ends a picked style. */
export const isSelectTool = (type: string) =>
  type === "selection" || type === "lasso";

/**
 * YAZ-4277 D15: the style fields ⌘\ sets back to the default style on one
 * element, or null for an element it leaves alone (a picture, a frame, an
 * embed). It never touches the place, size, rotation, text, font size, link,
 * lock, groups, bindings, folds or checkbox letters.
 */
export const getDefaultStyleUpdates = (
  element: ExcalidrawElement,
  defaults: NewElementStyle,
): Record<string, unknown> | null => {
  const shape = {
    strokeColor: defaults.currentItemStrokeColor,
    backgroundColor: defaults.currentItemBackgroundColor,
    opacity: defaults.currentItemOpacity,
  };
  if (isTextElement(element)) {
    return {
      ...shape,
      fontFamily: defaults.currentItemFontFamily,
      // a label keeps its place in its shape
      ...(element.containerId
        ? {}
        : { textAlign: defaults.currentItemTextAlign }),
      textRuns: undefined,
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      strikethrough: false,
      backgroundPaddingScale: undefined,
      roundness: null,
    };
  }
  if (
    element.type !== "rectangle" &&
    element.type !== "ellipse" &&
    element.type !== "diamond" &&
    element.type !== "arrow" &&
    element.type !== "line" &&
    element.type !== "freedraw"
  ) {
    return null;
  }
  const round = defaults.currentItemRoundness === "round";
  return {
    ...shape,
    fillStyle: defaults.currentItemFillStyle,
    strokeWidth: hasVectorStrokeWidth(element.type)
      ? defaults.currentItemVectorStrokeWidth
      : getStrokeWidthByKey(element.type, defaults.currentItemStrokeWidthKey),
    strokeStyle: defaults.currentItemStrokeStyle,
    roughness: defaults.currentItemRoughness,
    ...(element.type === "freedraw"
      ? {}
      : {
          roundness: !round
            ? null
            : element.type === "rectangle"
            ? {
                type: ROUNDNESS.ADAPTIVE_RADIUS,
                value: getDefaultCornerRadiusForElementType("rectangle"),
              }
            : {
                type: isUsingAdaptiveRadius(element.type)
                  ? ROUNDNESS.ADAPTIVE_RADIUS
                  : ROUNDNESS.PROPORTIONAL_RADIUS,
              },
        }),
    ...(element.type === "arrow"
      ? {
          startArrowhead: defaults.currentItemStartArrowhead,
          endArrowhead: defaults.currentItemEndArrowhead,
        }
      : {}),
  };
};
