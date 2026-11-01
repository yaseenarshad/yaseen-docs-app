import { pointFrom, pointRotateRads } from "@excalidraw/math";

import { getLineHeightInPx } from "./textMeasurements";
import {
  getStyledVisualLineStart,
  getTextElementStyledLines,
} from "./textLineUnderlines";
import { hasHostLinks } from "./textLinks";

import type { StyledTextSegment } from "./textLineUnderlines";
import type { ExcalidrawTextElement } from "./types";

/** A link pill under a point: its run, and its box in scene coordinates. */
export type TextLinkHit = {
  segment: StyledTextSegment;
  lineIndex: number;
  rect: { x: number; y: number; width: number; height: number };
};

/**
 * YAZ-4039 D11: the link pill of a text box under a scene point, or null. The
 * point maps to a line and a pill through the layout memo (YAZ-3718 D1): a
 * pointer move makes no new layout. `maxWidth` is the canvas's.
 */
export const getTextLinkAt = (
  element: ExcalidrawTextElement,
  maxWidth: number,
  point: { x: number; y: number },
): TextLinkHit | null => {
  if (!hasHostLinks(element.originalText)) {
    return null;
  }
  const [x, y] = pointRotateRads(
    pointFrom(point.x, point.y),
    pointFrom(element.x + element.width / 2, element.y + element.height / 2),
    -element.angle as typeof element.angle,
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
  if (!line?.segments) {
    return null;
  }
  const lineStart = getStyledVisualLineStart(
    line,
    element.width,
    element.textAlign,
  );
  for (const segment of line.segments) {
    const left = lineStart + segment.x;
    if (segment.link && localX >= left && localX <= left + segment.width) {
      return {
        segment,
        lineIndex,
        rect: {
          x: element.x + left,
          y: element.y + lineIndex * lineHeightPx,
          width: segment.width,
          height: lineHeightPx,
        },
      };
    }
  }
  return null;
};
