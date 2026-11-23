/**
 * YAZ-4277 D5, D7: the fold arrows of a text box. A folded list item always
 * shows ▸ in the space left of its marker. An open list item with children
 * shows ▾ on hover over its line, or always, by the board's setting. Only ▸
 * exports (SVG, PDF, PNG, the share viewer).
 *
 * The arrow box is a square, `size`% of the text size. On screen it never
 * gets smaller than `minScreenSize` px; exports use the size alone.
 */
import { applyDarkModeFilter } from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import { getListMarkerMiddle } from "./textCheckbox";
import { getFoldableLines, getFoldedLines } from "./textFolds";
import {
  getLineHeightInPx,
  getLineWidth,
  getTextMetricsVersion,
} from "./textMeasurements";
import {
  getStyledVisualLineStart,
  getTextElementStyledLines,
} from "./textLineUnderlines";
import { getHostLinksVersion } from "./textLinks";
import { hasTextList } from "./textList";

import type { GlobalPoint, Radians } from "@excalidraw/math";
import type { ExcalidrawTextElement } from "./types";

/** `"off"`: no folding; the host keeps the saved folds aside (YAZ-4277 demo). */
export type FoldArrowMode = "hover" | "always" | "off";
export type FoldArrowThickness = "thin" | "normal" | "thick";

export type FoldArrowPrefs = Readonly<{
  /** When an open list item with children shows ▾. */
  openArrows: FoldArrowMode;
  /** The arrow box, in % of the text size. */
  size: number;
  thickness: FoldArrowThickness;
  /** The smallest arrow box on screen, px. Never used by exports. */
  minScreenSize: number;
}>;

export const DEFAULT_FOLD_ARROW_PREFS: FoldArrowPrefs = {
  openArrows: "hover",
  size: 100,
  thickness: "thick",
  minScreenSize: 14,
};

/** The stroke of the chevron, as a part of the arrow box. */
const FOLD_ARROW_STROKE: Record<FoldArrowThickness, number> = {
  thin: 0.07,
  normal: 0.1,
  thick: 0.13,
};

/** The space between the arrow box and its marker, as a part of the text size. */
const FOLD_ARROW_GAP = 0.1;

/** An open arrow is drawn lighter than a folded one. */
const OPEN_FOLD_ARROW_ALPHA = 0.55;

let foldArrowPrefs = DEFAULT_FOLD_ARROW_PREFS;

/**
 * The prefs for a render that has none of its own: an export, a thumbnail,
 * the share viewer. The board sets them from its `foldArrows` prop.
 *
 * YAZ-4312 N3: this is one value for the whole window. The last board that
 * mounted or changed its prop sets it. That is safe, because an export (a
 * render with no zoom) reads only `size` and `thickness`, and the host makes
 * both from app-wide rows (`foldArrowsOf` in `shared/canvasPrefs.ts`): each
 * board in a window has the same two. The board's own `openArrows` and the
 * screen-only `minScreenSize` never change an export. A board on screen
 * passes its own prefs (`renderConfig.foldArrows`). If a board ever gets its
 * own size or thickness, pass the prefs in the export config instead.
 */
export const setFoldArrowPrefs = (prefs: FoldArrowPrefs) => {
  foldArrowPrefs = prefs;
};

export const getFoldArrowPrefs = () => foldArrowPrefs;

/** Where a list item with children sits in its box (box coordinates). */
export type FoldArrowAnchor = Readonly<{
  /** The line in `originalText`. */
  line: number;
  folded: boolean;
  /** The x where the marker starts. */
  markerX: number;
  /** The top of the item's first visual line. */
  top: number;
  lineHeight: number;
  /** The height of its marker's middle (`getListMarkerMiddle`): the arrow centres on it. */
  middle: number;
}>;

const NO_ANCHORS: readonly FoldArrowAnchor[] = [];

/** One entry for each box object, kept while its version stays. */
const anchorsMemo = new WeakMap<
  ExcalidrawTextElement,
  {
    version: number;
    maxWidth: number;
    linksVersion: number;
    metricsVersion: number;
    anchors: readonly FoldArrowAnchor[];
  }
>();

/** The list items with children of a box, through the layout memo. */
export const getFoldArrowAnchors = (
  element: ExcalidrawTextElement,
  maxWidth: number,
): readonly FoldArrowAnchor[] => {
  const linksVersion = getHostLinksVersion();
  // YAZ-4438: a font that loads moves the lines
  const metricsVersion = getTextMetricsVersion();
  const memo = anchorsMemo.get(element);
  if (
    memo &&
    memo.version === element.version &&
    memo.maxWidth === maxWidth &&
    memo.linksVersion === linksVersion &&
    memo.metricsVersion === metricsVersion
  ) {
    return memo.anchors;
  }
  const text = element.originalText;
  const foldable = hasTextList(text) ? getFoldableLines(text) : [];
  let anchors = NO_ANCHORS;
  if (foldable.length) {
    const folded = new Set(getFoldedLines(element));
    const wanted = new Set(foldable);
    const lineHeight = getLineHeightInPx(element.fontSize, element.lineHeight);
    const lines = getTextElementStyledLines(element, maxWidth, text);
    const found: FoldArrowAnchor[] = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      // the first visual line of the item only
      if (!wanted.delete(line.logicalLine)) {
        continue;
      }
      const indentation = text.slice(line.start, line.end).match(/^[ \t]*/)![0];
      found.push({
        line: line.logicalLine,
        folded: folded.has(line.logicalLine),
        markerX:
          getStyledVisualLineStart(line, element.width, element.textAlign) +
          (indentation ? getLineWidth(indentation, line.font) : 0),
        top: index * lineHeight,
        lineHeight,
        middle: getListMarkerMiddle(element, index * lineHeight, lineHeight),
      });
    }
    anchors = found;
  }
  anchorsMemo.set(element, {
    version: element.version,
    maxWidth,
    linksVersion,
    metricsVersion,
    anchors,
  });
  return anchors;
};

/** The side of the arrow box in scene units; `zoom` only on screen. */
export const getFoldArrowSize = (
  element: Pick<ExcalidrawTextElement, "fontSize">,
  prefs: FoldArrowPrefs,
  zoom?: number,
) => {
  const size = (element.fontSize * prefs.size) / 100;
  return zoom ? Math.max(size, prefs.minScreenSize / zoom) : size;
};

/** The arrow box of an item, in box coordinates. */
export const getFoldArrowBox = (
  element: Pick<ExcalidrawTextElement, "fontSize">,
  anchor: FoldArrowAnchor,
  size: number,
) => ({
  x: anchor.markerX - element.fontSize * FOLD_ARROW_GAP - size,
  y: anchor.middle - size / 2,
  size,
});

const toBoxPoint = (
  element: ExcalidrawTextElement,
  point: Readonly<{ x: number; y: number }>,
) => {
  const [x, y] = pointRotateRads(
    pointFrom<GlobalPoint>(point.x, point.y),
    pointFrom<GlobalPoint>(
      element.x + element.width / 2,
      element.y + element.height / 2,
    ),
    -element.angle as Radians,
  );
  return { x: x - element.x, y: y - element.y };
};

export type FoldArrowHit = Readonly<{
  elementId: ExcalidrawTextElement["id"];
  line: number;
  /** True on the arrow box itself; false on the rest of the item's line. */
  onArrow: boolean;
}>;

/**
 * The item of a box under a scene point: on its arrow box, or on the rest of
 * its first line (the hover of an open arrow). A box with no list item with
 * children costs one memo read.
 */
export const getFoldArrowAt = (
  element: ExcalidrawTextElement,
  maxWidth: number,
  prefs: FoldArrowPrefs,
  zoom: number,
  point: Readonly<{ x: number; y: number }>,
): FoldArrowHit | null => {
  const anchors = getFoldArrowAnchors(element, maxWidth);
  if (!anchors.length) {
    return null;
  }
  const local = toBoxPoint(element, point);
  const size = getFoldArrowSize(element, prefs, zoom);
  for (const anchor of anchors) {
    const box = getFoldArrowBox(element, anchor, size);
    if (
      local.x >= box.x &&
      local.x <= box.x + box.size &&
      local.y >= box.y &&
      local.y <= box.y + box.size
    ) {
      return { elementId: element.id, line: anchor.line, onArrow: true };
    }
    if (
      local.x >= box.x &&
      local.x <= element.width &&
      local.y >= anchor.top &&
      local.y < anchor.top + anchor.lineHeight
    ) {
      return { elementId: element.id, line: anchor.line, onArrow: false };
    }
  }
  return null;
};

/** The chevron of one arrow, centred in its box: a list of points. */
export const getFoldArrowPoints = (
  box: { x: number; y: number; size: number },
  folded: boolean,
) => {
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  const across = box.size * 0.25;
  const along = box.size * 0.14;
  // ▸ points right; ▾ points down
  return folded
    ? [
        [cx - along, cy - across],
        [cx + along, cy],
        [cx - along, cy + across],
      ]
    : [
        [cx - across, cy - along],
        [cx, cy + along],
        [cx + across, cy - along],
      ];
};

export const getFoldArrowStrokeWidth = (size: number, prefs: FoldArrowPrefs) =>
  size * FOLD_ARROW_STROKE[prefs.thickness];

export const getFoldArrowAlpha = (folded: boolean) =>
  folded ? 1 : OPEN_FOLD_ARROW_ALPHA;

/**
 * Draws the arrows of a box on a canvas whose origin is the scene origin
 * (`offsetX` / `offsetY` move it there, as `scrollX` / `scrollY` do). `zoom`
 * is null for an export: then only ▸ draws, at the size row alone.
 */
export const renderTextFoldArrows = (
  context: CanvasRenderingContext2D,
  element: ExcalidrawTextElement,
  maxWidth: number,
  options: {
    prefs: FoldArrowPrefs;
    zoom: number | null;
    offsetX: number;
    offsetY: number;
    dark: boolean;
    /** Draw only these items (the hover); else the arrows the prefs show. */
    lines?: readonly number[];
  },
) => {
  const anchors = getFoldArrowAnchors(element, maxWidth);
  if (!anchors.length) {
    return;
  }
  const shown = anchors.filter((anchor) =>
    options.lines
      ? options.lines.includes(anchor.line)
      : anchor.folded ||
        (options.zoom !== null && options.prefs.openArrows === "always"),
  );
  if (!shown.length) {
    return;
  }
  const size = getFoldArrowSize(
    element,
    options.prefs,
    options.zoom ?? undefined,
  );
  context.save();
  context.translate(
    element.x + options.offsetX + element.width / 2,
    element.y + options.offsetY + element.height / 2,
  );
  context.rotate(element.angle);
  context.translate(-element.width / 2, -element.height / 2);
  context.strokeStyle = applyDarkModeFilter(element.strokeColor, options.dark);
  context.lineWidth = getFoldArrowStrokeWidth(size, options.prefs);
  context.lineCap = "round";
  context.lineJoin = "round";
  const opacity = element.opacity / 100;
  for (const anchor of shown) {
    const points = getFoldArrowPoints(
      getFoldArrowBox(element, anchor, size),
      anchor.folded,
    );
    context.globalAlpha = opacity * getFoldArrowAlpha(anchor.folded);
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    context.lineTo(points[1][0], points[1][1]);
    context.lineTo(points[2][0], points[2][1]);
    context.stroke();
  }
  context.restore();
};

/** The scene left edge of a box's ▸ arrows in an export, or null (export bounds). */
export const getFoldArrowExportLeft = (
  element: ExcalidrawTextElement,
  maxWidth: number,
  prefs: FoldArrowPrefs,
) => {
  const folded = getFoldArrowAnchors(element, maxWidth).filter(
    (anchor) => anchor.folded,
  );
  if (!folded.length) {
    return null;
  }
  const size = getFoldArrowSize(element, prefs);
  const center = pointFrom<GlobalPoint>(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  let left = Infinity;
  for (const anchor of folded) {
    const box = getFoldArrowBox(element, anchor, size);
    for (const y of [box.y, box.y + box.size]) {
      const [x] = pointRotateRads(
        pointFrom<GlobalPoint>(element.x + box.x, element.y + y),
        center,
        element.angle,
      );
      left = Math.min(left, x);
    }
  }
  return left;
};
