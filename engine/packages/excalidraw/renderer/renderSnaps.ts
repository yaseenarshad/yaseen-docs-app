import { pointFrom, type GlobalPoint, type LocalPoint } from "@excalidraw/math";

import { THEME } from "@excalidraw/common";

import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  getSnapBounds,
  type GapSnapLine,
  type PointSnapLine,
  type PointerSnapLine,
} from "../snapping";
import type { InteractiveCanvasAppState } from "../types";

// Canva-style magenta. In dark mode, the interactive canvas applies
// `filter: invert(93%) hue-rotate(180deg)` (`styles.scss`), so `#a8187d`
// pre-filter renders as crisp bright magenta on the dark canvas.
export const SNAP_COLOR_LIGHT = "#e024a7";
export const SNAP_COLOR_DARK = "#a8187d";
const SNAP_PILL_TEXT_LIGHT = "#ffffff";
// Pre-filter dark text that inverts to bright white under `invert(93%) hue-rotate(180deg)`.
const SNAP_PILL_TEXT_DARK = "#000000";
const SNAP_WIDTH = 1;
const SNAP_DASH_SCREEN_PX = [4, 3];
const SNAP_PILL_MIN_SCREEN_GAP = 32;
const SNAP_BAND_ALPHA = 0.14;

const SNAP_HEX_RE = /^#([0-9a-fA-F]{6})$/;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const parseHexRgb = (hex: string): [number, number, number] | null => {
  const m = SNAP_HEX_RE.exec(hex);
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

const toHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b]
    .map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0"))
    .join("")}`;

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  if (s === 0) {
    return [l, l, l];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) {
      tt += 1;
    }
    if (tt > 1) {
      tt -= 1;
    }
    if (tt < 1 / 6) {
      return p + (q - p) * 6 * tt;
    }
    if (tt < 1 / 2) {
      return q;
    }
    if (tt < 2 / 3) {
      return p + (q - p) * (2 / 3 - tt) * 6;
    }
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
};

/**
 * Pre-compensate a `#rrggbb` color for the dark-mode canvas CSS filter
 * (`invert(93%) hue-rotate(180deg)`) so any user-chosen color renders
 * true-to-hue on the dark canvas.
 */
export const preCompensateDarkFilter = (hex: string): string => {
  const rgb = parseHexRgb(hex);
  if (!rgb) {
    return SNAP_COLOR_DARK;
  }
  const [h, s, l] = rgbToHsl(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
  const [r1, g1, b1] = hslToRgb((h + 0.5) % 1, s, l);
  return toHex(
    (0.93 - r1) / 0.86,
    (0.93 - g1) / 0.86,
    (0.93 - b1) / 0.86,
  );
};

const resolveSnapColors = (appState: InteractiveCanvasAppState) => {
  const rawHex =
    typeof appState.snapColor === "string" && SNAP_HEX_RE.test(appState.snapColor)
      ? appState.snapColor.toLowerCase()
      : SNAP_COLOR_LIGHT;
  const isDarkFiltered = appState.theme !== THEME.LIGHT;
  const snapColor = !isDarkFiltered
    ? rawHex
    : rawHex === SNAP_COLOR_LIGHT
    ? SNAP_COLOR_DARK
    : preCompensateDarkFilter(rawHex);

  const rgb = parseHexRgb(rawHex) ?? [224, 36, 167];
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const wantsDarkText = luminance > 0.6;
  const pillTextColor = wantsDarkText
    ? isDarkFiltered
      ? SNAP_PILL_TEXT_LIGHT
      : "#111111"
    : isDarkFiltered
    ? SNAP_PILL_TEXT_DARK
    : SNAP_PILL_TEXT_LIGHT;

  return { snapColor, pillTextColor };
};

export const renderSnaps = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  if (!appState.snapLines.length) {
    return;
  }

  const { snapColor, pillTextColor } = resolveSnapColors(appState);
  const snapWidth =
    (appState.zenModeEnabled ? SNAP_WIDTH * 1.5 : SNAP_WIDTH) /
    appState.zoom.value;
  const gapStyle = appState.snapGapStyle ?? "pill";

  context.save();
  context.translate(appState.scrollX, appState.scrollY);

  for (const snapLine of appState.snapLines) {
    if (snapLine.type === "pointer") {
      context.lineWidth = snapWidth;
      context.strokeStyle = snapColor;
      drawPointerSnapLine(snapLine, context, appState);
    } else if (snapLine.type === "gap") {
      context.lineWidth = snapWidth;
      context.strokeStyle = snapColor;
      drawGapLine(
        snapLine,
        gapStyle,
        snapColor,
        pillTextColor,
        appState,
        context,
      );
    } else if (snapLine.type === "points") {
      context.lineWidth = snapWidth;
      context.strokeStyle = snapColor;
      drawPointsSnapLine(snapLine, context, appState);
    }
  }

  context.restore();
};

const drawPointsSnapLine = (
  pointSnapLine: PointSnapLine,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  if (pointSnapLine.points.length < 2) {
    return;
  }
  const firstPoint = pointSnapLine.points[0];
  const lastPoint = pointSnapLine.points[pointSnapLine.points.length - 1];

  context.save();
  if (pointSnapLine.role !== "center") {
    context.setLineDash(
      SNAP_DASH_SCREEN_PX.map((d) => d / appState.zoom.value),
    );
  }
  drawLine(firstPoint, lastPoint, context);
  context.restore();
};

const drawPointerSnapLine = (
  pointerSnapLine: PointerSnapLine,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  context.save();
  context.setLineDash(SNAP_DASH_SCREEN_PX.map((d) => d / appState.zoom.value));
  drawLine(pointerSnapLine.points[0], pointerSnapLine.points[1], context);
  context.restore();
};

const drawLine = <Point extends LocalPoint | GlobalPoint>(
  from: Point,
  to: Point,
  context: CanvasRenderingContext2D,
) => {
  context.beginPath();
  context.moveTo(from[0], from[1]);
  context.lineTo(to[0], to[1]);
  context.stroke();
};

const drawRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
};

const drawPillLabel = (
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  label: string,
  bgColor: string,
  textColor: string,
  zoom: number,
) => {
  const fontSize = 10 / zoom;
  const padX = 5 / zoom;
  const pillH = 15 / zoom;
  const radius = 4 / zoom;

  context.save();
  context.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  const textWidth = context.measureText(label).width;
  const pillW = Math.max(pillH, textWidth + padX * 2);

  context.fillStyle = bgColor;
  drawRoundedRect(context, cx - pillW / 2, cy - pillH / 2, pillW, pillH, radius);
  context.fill();

  context.fillStyle = textColor;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, cx, cy + 0.5 / zoom);
  context.restore();
};

const drawDistancePill = (
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  distance: number,
  bgColor: string,
  textColor: string,
  zoom: number,
) => {
  drawPillLabel(
    context,
    cx,
    cy,
    `${Math.round(distance)}`,
    bgColor,
    textColor,
    zoom,
  );
};

export const renderResizeSizeBadge = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  selectedElements: readonly NonDeletedExcalidrawElement[],
) => {
  if (!appState.showResizeSizeBadge || !appState.isResizing) {
    return;
  }
  const targets =
    selectedElements.length > 0
      ? selectedElements
      : appState.resizingElement
      ? [appState.resizingElement]
      : [];
  if (targets.length === 0) {
    return;
  }

  const elementsMap = new Map(
    targets.map((el) => [el.id, el]),
  ) as ElementsMap;
  const [minX, minY, maxX, maxY] = getSnapBounds(targets, elementsMap);
  const w = Math.round(maxX - minX);
  const h = Math.round(maxY - minY);
  const zoom = appState.zoom.value;
  const { snapColor: bgColor, pillTextColor: textColor } =
    resolveSnapColors(appState);

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  drawPillLabel(
    context,
    (minX + maxX) / 2,
    maxY + 18 / zoom,
    `${w} × ${h}`,
    bgColor,
    textColor,
    zoom,
  );
  context.restore();
};

const drawGapLine = (
  snapLine: GapSnapLine,
  gapStyle: "pill" | "bracket" | "band",
  snapColor: string,
  pillTextColor: string,
  appState: InteractiveCanvasAppState,
  context: CanvasRenderingContext2D,
) => {
  const [from, to] = snapLine.points;
  const zoom = appState.zoom.value;
  const tick = 5 / zoom;
  const rawDistance =
    snapLine.distance ?? Math.hypot(to[0] - from[0], to[1] - from[1]);
  const screenLen = rawDistance * zoom;

  if (gapStyle === "band") {
    context.save();
    context.fillStyle = snapColor;
    context.globalAlpha = SNAP_BAND_ALPHA;
    if (snapLine.direction === "horizontal") {
      const x = Math.min(from[0], to[0]);
      const w = Math.abs(to[0] - from[0]);
      const y1 = snapLine.bandSpan ? snapLine.bandSpan[0] : from[1] - tick * 2;
      const y2 = snapLine.bandSpan ? snapLine.bandSpan[1] : from[1] + tick * 2;
      context.fillRect(x, y1, w, Math.max(1 / zoom, y2 - y1));
    } else {
      const y = Math.min(from[1], to[1]);
      const h = Math.abs(to[1] - from[1]);
      const x1 = snapLine.bandSpan ? snapLine.bandSpan[0] : from[0] - tick * 2;
      const x2 = snapLine.bandSpan ? snapLine.bandSpan[1] : from[0] + tick * 2;
      context.fillRect(x1, y, Math.max(1 / zoom, x2 - x1), h);
    }
    context.restore();
  }

  // Draw clean bracket line + perpendicular end-ticks (no center "||" bars).
  if (gapStyle !== "band") {
    if (snapLine.direction === "horizontal") {
      drawLine(
        pointFrom(from[0], from[1] - tick),
        pointFrom(from[0], from[1] + tick),
        context,
      );
      drawLine(
        pointFrom(to[0], to[1] - tick),
        pointFrom(to[0], to[1] + tick),
        context,
      );
    } else {
      drawLine(
        pointFrom(from[0] - tick, from[1]),
        pointFrom(from[0] + tick, from[1]),
        context,
      );
      drawLine(
        pointFrom(to[0] - tick, to[1]),
        pointFrom(to[0] + tick, to[1]),
        context,
      );
    }
    drawLine(from, to, context);
  }

  if (
    snapLine.alwaysShowPill ||
    ((gapStyle === "pill" || gapStyle === "band") &&
      screenLen >= SNAP_PILL_MIN_SCREEN_GAP)
  ) {
    const midX = (from[0] + to[0]) / 2;
    const midY = (from[1] + to[1]) / 2;
    drawDistancePill(
      context,
      midX,
      midY,
      rawDistance,
      snapColor,
      pillTextColor,
      zoom,
    );
  }
};
