/**
 * YAZ-4277 demo: the screen-scale switch point. A new shape, arrow, line or
 * pen stroke looks the same on screen at every zoom, as new text does
 * (`getResponsiveTextFontSize`, YAZ-4247, which stays with the text tools).
 *
 * Every style picker and every default speaks SCREEN px at the zoom of the
 * moment; this module turns it into the board units the file keeps:
 *
 * - the line width and a picked corner radius are stored divided by the
 *   zoom (`toBoardSize`), so the file stays plain Excalidraw;
 * - the sizes the renderer adds by itself (the rough.js wobble, the small-
 *   shape roughness rule, the dashed-line widening, the arrowheads, the
 *   adaptive corner cap) divide by the scale the element was made at,
 *   `customData.styleScale`. Other Excalidraw apps keep that field and
 *   ignore it. Thus a shape made far from 100% looks different there: its
 *   line width is right, but its arrowheads, its rough wobble and its
 *   binding gap are drawn at board size (YAZ-4312 S11).
 *
 * At zoom 1, or with the switch off, nothing changes: no field, the same
 * numbers.
 */
import type { ExcalidrawElement } from "./types";

/** The scale a new element's styles are made at: the zoom, or 1 when off. */
export const getStyleScale = (zoom: number, enabled: boolean | undefined) =>
  enabled && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

/** A screen size at `scale`, in board units (4 significant digits). */
export const toBoardSize = (screen: number, scale: number) =>
  scale === 1 ? screen : Number((screen / scale).toPrecision(4));

/** A board size, as it shows on screen at `scale`. */
export const toScreenSize = (board: number, scale: number) =>
  scale === 1 ? board : Number((board * scale).toPrecision(4));

/** The scale an element was made at; 1 for one made at zoom 1, or before. */
export const getElementStyleScale = (
  element: Pick<ExcalidrawElement, "customData">,
) => {
  const scale = element.customData?.styleScale;
  return typeof scale === "number" && Number.isFinite(scale) && scale > 0
    ? scale
    : 1;
};

/** A new element's `customData` at `scale`: unchanged at 1. */
export const withStyleScale = (
  customData: ExcalidrawElement["customData"],
  scale: number,
) =>
  scale === 1
    ? customData
    : { ...customData, styleScale: Number(scale.toPrecision(4)) };
