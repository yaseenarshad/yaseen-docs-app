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
  state: Pick<AppState, NewElementStyleKey | "selectedElementIds" | "editingTextElement">,
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
