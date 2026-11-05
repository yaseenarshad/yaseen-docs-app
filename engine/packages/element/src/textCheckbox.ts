/**
 * YAZ-4277 D4: checklist items in a text box. The text keeps the marker
 * letters `☐ ` (open) and `☑ ` (done), so plain Excalidraw still reads them.
 * The renderers draw a real box in the marker's place, and a done item uses
 * the notes' done look: its letters at 55% (`--list-done-color` in the notes'
 * `bullets.css`) with a strike line. A click on the box ticks it.
 */
import { getVerticalOffset } from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import { getLineHeightInPx, getLineWidth } from "./textMeasurements";
import {
  getStyledVisualLineStart,
  getTextElementStyledLines,
} from "./textLineUnderlines";
import { TEXT_LIST_CHECK_MARKERS } from "./textList";

import type { GlobalPoint, Radians } from "@excalidraw/math";
import type { StyledTextSegment } from "./textLineUnderlines";
import type { ExcalidrawTextElement } from "./types";

/** The notes' done look: the letters at 55% of their color. */
export const CHECKLIST_DONE_ALPHA = 0.55;

/** The box, as a part of the text size. */
const CHECKBOX_SIZE = 0.62;

/**
 * The height of a list marker's middle in a line that starts at `lineTop`:
 * a third of the text size above the baseline, where `•` and `○` sit. The
 * checklist boxes and the fold arrows centre on it, so they line up with the
 * letters, not with the line's box.
 */
export const getListMarkerMiddle = (
  element: Pick<ExcalidrawTextElement, "fontFamily" | "fontSize">,
  lineTop: number,
  lineHeightPx: number,
) =>
  lineTop +
  getVerticalOffset(element.fontFamily, element.fontSize, lineHeightPx) -
  element.fontSize * 0.32;

/**
 * The drawn box of a checklist segment that starts at `x`, centred on the
 * marker letter and on `middle` (`getListMarkerMiddle`).
 */
export const getCheckboxGeometry = (
  segment: Pick<StyledTextSegment, "text" | "font">,
  x: number,
  middle: number,
  fontSize: number,
) => {
  const size = fontSize * CHECKBOX_SIZE;
  const markerWidth = getLineWidth(segment.text.trimEnd(), segment.font);
  const left = x + Math.max(0, (markerWidth - size) / 2);
  const top = middle - size / 2;
  return {
    x: left,
    y: top,
    size,
    radius: size * 0.18,
    // YAZ-4441: a part of the text size, with no floor: these are scene
    // units, and a floor of 1 is a blob on a box with a small text size
    strokeWidth: fontSize / 14,
    /** The tick of a done box: three points. */
    tick: [
      [left + size * 0.24, top + size * 0.52],
      [left + size * 0.43, top + size * 0.72],
      [left + size * 0.77, top + size * 0.3],
    ] as const,
  };
};

/** A checklist box under a scene point: the offset of its marker in `originalText`. */
export type TextCheckboxHit = {
  offset: number;
  state: "open" | "done";
};

/**
 * The checklist box of a text box under a scene point, or null. The point
 * maps to a line and a segment through the layout memo, as the link pills do.
 */
export const getTextCheckboxAt = (
  element: ExcalidrawTextElement,
  maxWidth: number,
  point: { x: number; y: number },
): TextCheckboxHit | null => {
  if (
    !element.originalText.includes(TEXT_LIST_CHECK_MARKERS[0]) &&
    !element.originalText.includes(TEXT_LIST_CHECK_MARKERS[1])
  ) {
    return null;
  }
  const [x, y] = pointRotateRads(
    pointFrom<GlobalPoint>(point.x, point.y),
    pointFrom<GlobalPoint>(
      element.x + element.width / 2,
      element.y + element.height / 2,
    ),
    -element.angle as Radians,
  );
  const localX = x - element.x;
  const localY = y - element.y;
  const lineHeightPx = getLineHeightInPx(element.fontSize, element.lineHeight);
  const lineIndex = Math.floor(localY / lineHeightPx);
  const line = getTextElementStyledLines(
    element,
    maxWidth,
    element.originalText,
  )[lineIndex];
  const segment = line?.segments?.find((candidate) => candidate.checkbox);
  if (!line || !segment) {
    return null;
  }
  const box = getCheckboxGeometry(
    segment,
    getStyledVisualLineStart(line, element.width, element.textAlign) +
      segment.x,
    getListMarkerMiddle(element, lineIndex * lineHeightPx, lineHeightPx),
    element.fontSize,
  );
  // a little more than the box, so a quick click lands
  const slack = box.size * 0.2;
  if (
    localX < box.x - slack ||
    localX > box.x + box.size + slack ||
    localY < box.y - slack ||
    localY > box.y + box.size + slack
  ) {
    return null;
  }
  return { offset: segment.start, state: segment.checkbox! };
};

/** The text with the marker at `offset` ticked or unticked. */
export const getToggledCheckboxText = (text: string, offset: number) => {
  const [open, done] = TEXT_LIST_CHECK_MARKERS;
  const marker = text[offset];
  if (marker !== open && marker !== done) {
    return text;
  }
  return `${text.slice(0, offset)}${marker === open ? done : open}${text.slice(
    offset + 1,
  )}`;
};
