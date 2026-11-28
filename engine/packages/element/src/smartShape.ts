import { pointDistance, pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, LocalPoint, Radians } from "@excalidraw/math";

import { newElementWith } from "./mutateElement";

import type { ExcalidrawElement, ExcalidrawLinearElement } from "./types";

export type SmartShapeCategory =
  | "basic"
  | "arrows"
  | "brackets"
  | "callouts"
  | "banners";

export const SMART_SHAPE_IDS = [
  // Arrows (15)
  "arrow-right",
  "arrow-left",
  "arrow-up",
  "arrow-down",
  "curved-arrow",
  "u-turn-arrow",
  "double-arrow",
  "circle-arrow",
  "bent-arrow",
  "pentagon-arrow",
  "notched-arrow",
  "chevron-right",
  "chevron-left",
  "chevron-up",
  "chevron-down",
  // Brackets & Braces (10)
  "brace-left",
  "brace-right",
  "brace-up",
  "brace-down",
  "bracket-left",
  "bracket-right",
  "bracket-up",
  "bracket-down",
  "parenthesis-left",
  "parenthesis-right",
  // Callouts (6)
  "callout-rectangle",
  "callout-rounded",
  "callout-oval",
  "cloud",
  "note-fold",
  "document",
  // Basic (11)
  "pill",
  "right-triangle",
  "pentagon",
  "octagon",
  "parallelogram",
  "trapezoid",
  "plus",
  "star-4",
  "starburst",
  "heart",
  "semicircle",
  // Banners (5)
  "bookmark",
  "tag",
  "shield",
  "ribbon",
  "cylinder",
] as const;

export type SmartShapeId = typeof SMART_SHAPE_IDS[number];

export type SmartShapeKind =
  | "filled-arrow"
  | "double-arrow"
  | "bent-arrow"
  | "curved-arrow"
  | "u-turn-arrow"
  | "circle-arrow"
  | "pentagon-arrow"
  | "notched-arrow"
  | "chevron"
  | "brace"
  | "bracket"
  | "parenthesis"
  | "callout"
  | "cloud"
  | "note-fold"
  | "document"
  | "pill"
  | "right-triangle"
  | "pentagon"
  | "octagon"
  | "parallelogram"
  | "trapezoid"
  | "plus"
  | "star-4"
  | "starburst"
  | "heart"
  | "semicircle"
  | "bookmark"
  | "tag"
  | "shield"
  | "ribbon"
  | "cylinder";

export type SmartShapeHandleName =
  | "shaft"
  | "head"
  | "thickness"
  | "tail"
  | "bend"
  | "gap"
  | "opening"
  | "cusp"
  | "skew"
  | "topWidth";

export type SmartShapeParameterName =
  | "shaftRatio"
  | "headAspect"
  | "headLengthRatio"
  | "thicknessRatio"
  | "tailPositionRatio"
  | "bendRatio"
  | "gapRatio"
  | "openingRatio"
  | "cuspRatio"
  | "skewRatio"
  | "topWidthRatio";

/** Default parameter for each handle; use `getSmartShapeHandleParameter` for shape-specific overrides (e.g. `curved-arrow`'s `head` -> `headLengthRatio`). */
export const SMART_SHAPE_HANDLE_PARAMETERS: Readonly<
  Record<SmartShapeHandleName, SmartShapeParameterName>
> = {
  shaft: "shaftRatio",
  head: "headAspect",
  thickness: "thicknessRatio",
  tail: "tailPositionRatio",
  bend: "bendRatio",
  gap: "gapRatio",
  opening: "openingRatio",
  cusp: "cuspRatio",
  skew: "skewRatio",
  topWidth: "topWidthRatio",
};

export type SmartShapeMetadata = {
  version: 1;
  id: SmartShapeId;
  kind: SmartShapeKind;
  parameters: Record<string, number>;
  flipX?: boolean;
  flipY?: boolean;
};

type SmartShapeFlip = {
  flipX?: boolean;
  flipY?: boolean;
};

export type SmartShapeDefinition = {
  id: SmartShapeId;
  title: string;
  kind: SmartShapeKind;
  category: SmartShapeCategory;
  width: number;
  height: number;
  closed: boolean;
  roundness: ExcalidrawElement["roundness"];
  defaults: Record<string, number>;
  /**
   * The ONE place a parameter's range lives (YAZ-4356): the point builders, a handle drag and
   * the Smart shape sliders all clamp to it.
   */
  limits: Partial<Record<SmartShapeParameterName, readonly [number, number]>>;
  handles: readonly SmartShapeHandleName[];
};

export type SmartShapeHandle = {
  name: SmartShapeHandleName;
  scenePoint: GlobalPoint;
};

export type SmartShapeResizeResult = {
  points: LocalPoint[];
  customData: ExcalidrawElement["customData"];
};

const definition = (
  value: Omit<SmartShapeDefinition, "width" | "height" | "roundness"> &
    Partial<Pick<SmartShapeDefinition, "width" | "height" | "roundness">>,
): SmartShapeDefinition => ({
  width: 200,
  height: 100,
  roundness: null,
  ...value,
});

export const SMART_SHAPE_DEFINITIONS: readonly SmartShapeDefinition[] = [
  // Arrows
  definition({
    id: "arrow-right",
    title: "Arrow right",
    kind: "filled-arrow",
    category: "arrows",
    width: 200,
    height: 100,
    closed: true,
    defaults: { shaftRatio: 0.5, headAspect: 0.8 },
    limits: { shaftRatio: [0.1, 0.9], headAspect: [0.25, 2.5] },
    handles: ["shaft", "head"],
  }),
  definition({
    id: "arrow-left",
    title: "Arrow left",
    kind: "filled-arrow",
    category: "arrows",
    width: 200,
    height: 100,
    closed: true,
    defaults: { shaftRatio: 0.5, headAspect: 0.8 },
    limits: { shaftRatio: [0.1, 0.9], headAspect: [0.25, 2.5] },
    handles: ["shaft", "head"],
  }),
  definition({
    id: "arrow-up",
    title: "Arrow up",
    kind: "filled-arrow",
    category: "arrows",
    width: 100,
    height: 200,
    closed: true,
    defaults: { shaftRatio: 0.5, headAspect: 0.8 },
    limits: { shaftRatio: [0.1, 0.9], headAspect: [0.25, 2.5] },
    handles: ["shaft", "head"],
  }),
  definition({
    id: "arrow-down",
    title: "Arrow down",
    kind: "filled-arrow",
    category: "arrows",
    width: 100,
    height: 200,
    closed: true,
    defaults: { shaftRatio: 0.5, headAspect: 0.8 },
    limits: { shaftRatio: [0.1, 0.9], headAspect: [0.25, 2.5] },
    handles: ["shaft", "head"],
  }),
  definition({
    id: "curved-arrow",
    title: "Curved arrow",
    kind: "curved-arrow",
    category: "arrows",
    width: 200,
    height: 120,
    closed: true,
    defaults: { bendRatio: 1, thicknessRatio: 0.3, headLengthRatio: 0.2 },
    limits: {
      bendRatio: [0.5, 1.25],
      thicknessRatio: [0.1, 0.6],
      headLengthRatio: [0.1, 0.4],
    },
    handles: ["bend", "thickness", "head"],
  }),
  definition({
    id: "u-turn-arrow",
    title: "U-turn arrow",
    kind: "u-turn-arrow",
    category: "arrows",
    width: 140,
    height: 200,
    closed: true,
    defaults: { gapRatio: 0.4, thicknessRatio: 0.22 },
    limits: { gapRatio: [0.2, 0.9], thicknessRatio: [0.1, 0.35] },
    handles: ["gap", "thickness"],
  }),
  definition({
    id: "double-arrow",
    title: "Double arrow",
    kind: "double-arrow",
    category: "arrows",
    width: 240,
    height: 100,
    closed: true,
    defaults: { thicknessRatio: 0.45, headAspect: 0.6 },
    limits: { thicknessRatio: [0.1, 0.9], headAspect: [0.2, 2.0] },
    handles: ["thickness", "head"],
  }),
  definition({
    id: "circle-arrow",
    title: "Circle arrow",
    kind: "circle-arrow",
    category: "arrows",
    width: 160,
    height: 160,
    closed: true,
    defaults: { openingRatio: 0.15, thicknessRatio: 0.3 },
    limits: { openingRatio: [0.05, 0.3], thicknessRatio: [0.1, 0.5] },
    handles: ["opening", "thickness"],
  }),
  definition({
    id: "bent-arrow",
    title: "Bent arrow",
    kind: "bent-arrow",
    category: "arrows",
    width: 180,
    height: 180,
    closed: true,
    defaults: { thicknessRatio: 0.3, headAspect: 0.8 },
    limits: { thicknessRatio: [0.12, 0.55], headAspect: [0.25, 2.0] },
    handles: ["thickness", "head"],
  }),
  definition({
    id: "pentagon-arrow",
    title: "Pentagon arrow",
    kind: "pentagon-arrow",
    category: "arrows",
    width: 200,
    height: 100,
    closed: true,
    defaults: { headAspect: 0.5 },
    limits: { headAspect: [0.15, 1.5] },
    handles: ["head"],
  }),
  definition({
    id: "notched-arrow",
    title: "Notched arrow",
    kind: "notched-arrow",
    category: "arrows",
    width: 200,
    height: 100,
    closed: true,
    defaults: { headAspect: 0.5 },
    limits: { headAspect: [0.15, 1.5] },
    handles: ["head"],
  }),
  ...(["right", "left", "up", "down"] as const).map((direction) =>
    definition({
      id: `chevron-${direction}`,
      title: `Chevron ${direction}`,
      kind: "chevron",
      category: "arrows",
      width: direction === "up" || direction === "down" ? 100 : 200,
      height: direction === "up" || direction === "down" ? 200 : 100,
      closed: true,
      defaults: { thicknessRatio: 0.28 },
      limits: { thicknessRatio: [0.12, 0.46] },
      handles: ["thickness"],
    }),
  ),

  // Brackets & Braces
  ...(["left", "right", "up", "down"] as const).map((direction) =>
    definition({
      id: `brace-${direction}`,
      title: `Curly brace ${direction}`,
      kind: "brace",
      category: "brackets",
      width: direction === "up" || direction === "down" ? 200 : 36,
      height: direction === "up" || direction === "down" ? 36 : 200,
      closed: false,
      defaults: { cuspRatio: 0.5 },
      limits: { cuspRatio: [0.15, 0.85] },
      handles: ["cusp"],
    }),
  ),
  ...(["left", "right", "up", "down"] as const).map((direction) =>
    definition({
      id: `bracket-${direction}`,
      title: `Bracket ${direction}`,
      kind: "bracket",
      category: "brackets",
      width: direction === "up" || direction === "down" ? 200 : 36,
      height: direction === "up" || direction === "down" ? 36 : 200,
      closed: false,
      defaults: {},
      limits: {},
      handles: [],
    }),
  ),
  definition({
    id: "parenthesis-left",
    title: "Parenthesis left",
    kind: "parenthesis",
    category: "brackets",
    width: 40,
    height: 200,
    closed: false,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "parenthesis-right",
    title: "Parenthesis right",
    kind: "parenthesis",
    category: "brackets",
    width: 40,
    height: 200,
    closed: false,
    defaults: {},
    limits: {},
    handles: [],
  }),

  // Callouts
  definition({
    id: "callout-rectangle",
    title: "Callout",
    kind: "callout",
    category: "callouts",
    width: 180,
    height: 130,
    closed: true,
    defaults: { tailPositionRatio: 0.7 },
    limits: { tailPositionRatio: [0.2, 0.8] },
    handles: ["tail"],
  }),
  definition({
    id: "callout-rounded",
    title: "Rounded callout",
    kind: "callout",
    category: "callouts",
    width: 180,
    height: 130,
    closed: true,
    defaults: { tailPositionRatio: 0.7 },
    limits: { tailPositionRatio: [0.2, 0.8] },
    handles: ["tail"],
  }),
  definition({
    id: "callout-oval",
    title: "Oval callout",
    kind: "callout",
    category: "callouts",
    width: 180,
    height: 135,
    closed: true,
    defaults: { tailPositionRatio: 0.7 },
    limits: { tailPositionRatio: [0.2, 0.8] },
    handles: ["tail"],
  }),
  definition({
    id: "cloud",
    title: "Cloud",
    kind: "cloud",
    category: "callouts",
    width: 200,
    height: 130,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "note-fold",
    title: "Folded note",
    kind: "note-fold",
    category: "callouts",
    width: 150,
    height: 180,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "document",
    title: "Document",
    kind: "document",
    category: "callouts",
    width: 150,
    height: 180,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),

  // Basic
  definition({
    id: "pill",
    title: "Pill",
    kind: "pill",
    category: "basic",
    width: 200,
    height: 80,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "right-triangle",
    title: "Right triangle",
    kind: "right-triangle",
    category: "basic",
    width: 160,
    height: 140,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "pentagon",
    title: "Pentagon",
    kind: "pentagon",
    category: "basic",
    width: 160,
    height: 150,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "octagon",
    title: "Octagon",
    kind: "octagon",
    category: "basic",
    width: 160,
    height: 160,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "parallelogram",
    title: "Parallelogram",
    kind: "parallelogram",
    category: "basic",
    width: 200,
    height: 110,
    closed: true,
    defaults: { skewRatio: 0.2 },
    limits: { skewRatio: [0.05, 0.45] },
    handles: ["skew"],
  }),
  definition({
    id: "trapezoid",
    title: "Trapezoid",
    kind: "trapezoid",
    category: "basic",
    width: 200,
    height: 110,
    closed: true,
    defaults: { topWidthRatio: 0.6 },
    limits: { topWidthRatio: [0.2, 0.9] },
    handles: ["topWidth"],
  }),
  definition({
    id: "plus",
    title: "Plus",
    kind: "plus",
    category: "basic",
    width: 150,
    height: 150,
    closed: true,
    defaults: { thicknessRatio: 0.35 },
    limits: { thicknessRatio: [0.15, 0.7] },
    handles: ["thickness"],
  }),
  definition({
    id: "star-4",
    title: "4-point star",
    kind: "star-4",
    category: "basic",
    width: 150,
    height: 150,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "starburst",
    title: "Starburst",
    kind: "starburst",
    category: "basic",
    width: 160,
    height: 160,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "heart",
    title: "Heart",
    kind: "heart",
    category: "basic",
    width: 160,
    height: 150,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "semicircle",
    title: "Semicircle",
    kind: "semicircle",
    category: "basic",
    width: 180,
    height: 90,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),

  // Banners
  definition({
    id: "bookmark",
    title: "Bookmark",
    kind: "bookmark",
    category: "banners",
    width: 120,
    height: 180,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "tag",
    title: "Tag",
    kind: "tag",
    category: "banners",
    width: 200,
    height: 100,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "shield",
    title: "Shield",
    kind: "shield",
    category: "banners",
    width: 140,
    height: 170,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "ribbon",
    title: "Ribbon",
    kind: "ribbon",
    category: "banners",
    width: 220,
    height: 90,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "cylinder",
    title: "Cylinder",
    kind: "cylinder",
    category: "banners",
    width: 140,
    height: 180,
    closed: true,
    defaults: {},
    limits: {},
    handles: [],
  }),
] as readonly SmartShapeDefinition[];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const DEFINITIONS_BY_ID = new Map(
  SMART_SHAPE_DEFINITIONS.map((item) => [item.id, item]),
);

export const getSmartShapeHandleParameter = (
  definitionOrId: SmartShapeId | SmartShapeDefinition,
  handle: SmartShapeHandleName,
): SmartShapeParameterName => {
  const def =
    typeof definitionOrId === "string"
      ? DEFINITIONS_BY_ID.get(definitionOrId)
      : definitionOrId;
  if (
    handle === "head" &&
    def &&
    "headLengthRatio" in def.limits &&
    !("headAspect" in def.limits)
  ) {
    return "headLengthRatio";
  }
  return SMART_SHAPE_HANDLE_PARAMETERS[handle];
};

/** `value` held to the parameter's own limits on that shape; no limits, no clamp. */
const clampParameter = (
  id: SmartShapeId,
  parameter: SmartShapeParameterName,
  value: number,
) => {
  const limits = DEFINITIONS_BY_ID.get(id)?.limits[parameter];
  return limits ? clamp(value, limits[0], limits[1]) : value;
};

const headAspectAxes = (
  id: SmartShapeId,
  width: number,
  height: number,
): readonly [lengthAxis: number, crossAxis: number] =>
  id === "arrow-up" || id === "arrow-down" ? [height, width] : [width, height];

/**
 * A parameter as builders and sliders read it: stored value, legacy `headLengthRatio`
 * conversion when `headAspect` is absent, or default — clamped to the shape's limits.
 */
export const readSmartShapeParameter = (
  id: SmartShapeId,
  width: number,
  height: number,
  parameters: Record<string, number>,
  parameter: SmartShapeParameterName,
): number => {
  const stored = parameters[parameter];
  if (Number.isFinite(stored)) {
    return clampParameter(id, parameter, stored);
  }
  if (
    parameter === "headAspect" &&
    Number.isFinite(parameters.headLengthRatio)
  ) {
    const [lengthAxis, crossAxis] = headAspectAxes(id, width, height);
    return clampParameter(
      id,
      "headAspect",
      parameters.headLengthRatio * (lengthAxis / Math.max(crossAxis, 1)),
    );
  }
  return clampParameter(
    id,
    parameter,
    DEFINITIONS_BY_ID.get(id)?.defaults[parameter] ?? 0.5,
  );
};

const points = (values: readonly (readonly [number, number])[]) =>
  values.map(([x, y]) => pointFrom<LocalPoint>(x, y));

// ---------------------------------------------------------------------------
// Unified parametric Smart Shape builders (YAZ-4356, YAZ-6674).
//
// Every Smart Shape lives in `ANCHORED_BUILDERS` and returns an outline plus
// handle anchor points in the box `(0..width, 0..height)`. Shapes with curves
// sample explicit points (`roundness: null`) so RoughJS stays crisp at every
// size without spline overshoot.
// ---------------------------------------------------------------------------

type Vec = readonly [number, number];
type Direction = "right" | "left" | "up" | "down";

type AnchoredShape = {
  outline: Vec[];
  anchors: Partial<Record<SmartShapeHandleName, Vec>>;
};

type AnchoredBuilder = (
  id: SmartShapeId,
  width: number,
  height: number,
  read: (parameter: SmartShapeParameterName) => number,
) => AnchoredShape;

/** The steps along each curved stretch of a centre line. */
const CURVE_STEPS = 24;
/** Quarter-arc sampling for curly braces. */
const BRACE_ARC_STEPS = 8;
/** Corner-arc sampling for rounded callouts. */
const CORNER_ARC_STEPS = 6;
/** Maximum vertical arc radius on curly braces so tall braces stay crisp. */
const BRACE_MAX_RADIUS = 18;
/** The head is twice as wide as the shaft, as on the filled arrows' defaults. */
const HEAD_WIDTH_PER_THICKNESS = 2;
/** A head's length per shaft width, where no handle sets it (U-turn, circle). */
const HEAD_LENGTH_PER_THICKNESS = 1.6;

/** `steps + 1` points on an ellipse (or circle when `rx === ry`); positive sweep turns clockwise on screen. */
const ellipseArcPoints = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  start: number,
  sweep: number,
  steps: number,
): Vec[] =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const angle = start + (sweep * index) / steps;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
  });

/** `steps + 1` points on a circle; angles in radians, positive sweep turns clockwise on screen. */
const arcPoints = (
  cx: number,
  cy: number,
  radius: number,
  start: number,
  sweep: number,
  steps = CURVE_STEPS,
): Vec[] => ellipseArcPoints(cx, cy, radius, radius, start, sweep, steps);

const dedupeAdjacent = (list: readonly Vec[], eps = 1e-6): Vec[] => {
  const out: Vec[] = [];
  for (const pt of list) {
    const prev = out[out.length - 1];
    if (
      !prev ||
      Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > eps
    ) {
      out.push(pt);
    }
  }
  return out;
};

const closeOutline = (raw: readonly Vec[], eps = 1e-6): Vec[] => {
  const outline = dedupeAdjacent(raw, eps);
  if (outline.length > 1) {
    const first = outline[0];
    const last = outline[outline.length - 1];
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) <= eps) {
      outline[outline.length - 1] = first;
    } else {
      outline.push(first);
    }
  }
  return outline;
};

export const getPointsMin = (
  pts: readonly (readonly [number, number])[],
): readonly [minX: number, minY: number] => {
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of pts) {
    if (x < minX) {
      minX = x;
    }
    if (y < minY) {
      minY = y;
    }
  }
  return [minX, minY];
};

const getPointsBounds = (
  pts: readonly (readonly [number, number])[],
): readonly [minX: number, minY: number, maxX: number, maxY: number] => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) {
      minX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
};

const unit = ([x, y]: Vec): Vec => {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
};

/** The normal on the right of the travel; on a clockwise line it points to the inside. */
const normalOf = (from: Vec, to: Vec): Vec => {
  const [dx, dy] = unit([to[0] - from[0], to[1] - from[1]]);
  return [-dy, dx];
};

/**
 * Isometric orientation of a canonical right-pointing shape built in
 * `(lengthAxis, crossAxis)` into `(width, height)`.
 */
const orientPoint = (
  [x, y]: Vec,
  direction: Direction,
  width: number,
  height: number,
): Vec => {
  switch (direction) {
    case "right":
      return [x, y];
    case "left":
      return [width - x, y];
    case "up":
      return [y, height - x];
    case "down":
      return [width - y, x];
  }
};

const orientShape = (
  shape: AnchoredShape,
  direction: Direction,
  width: number,
  height: number,
): AnchoredShape => ({
  outline: shape.outline.map((pt) => orientPoint(pt, direction, width, height)),
  anchors: Object.fromEntries(
    Object.entries(shape.anchors).map(([name, pt]) => [
      name,
      orientPoint(pt, direction, width, height),
    ]),
  ),
});

/**
 * A filled arrow along `centre`: the shaft is `thickness` wide, the head ends on the
 * last centre point and is `headLength` long. `inner(f)` is the point on the
 * inner edge (the side of `normalOf`) at fraction `f` of the shaft.
 */
const bandArrow = (centre: Vec[], thickness: number, headLength: number) => {
  const lengths = [0];
  for (let index = 1; index < centre.length; index++) {
    lengths.push(
      lengths[index - 1] +
        Math.hypot(
          centre[index][0] - centre[index - 1][0],
          centre[index][1] - centre[index - 1][1],
        ),
    );
  }
  const total = lengths[lengths.length - 1];
  const at = (distance: number) => {
    const clamped = clamp(distance, 0, total);
    let index = 1;
    while (index < centre.length - 1 && lengths[index] < clamped) {
      index++;
    }
    const from = centre[index - 1];
    const to = centre[index];
    const span = lengths[index] - lengths[index - 1] || 1;
    const t = (clamped - lengths[index - 1]) / span;
    return {
      point: [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
      ] as Vec,
      normal: normalOf(from, to),
    };
  };
  const baseDistance = clamp(total - headLength, total * 0.05, total);
  const base = at(baseDistance);
  const half = thickness / 2;
  // A sample just before the base would fold the inner edge back on itself
  // (its mitred offset lands past the base's), so the base replaces it.
  const body: Vec[] = centre.filter(
    (_, index) => index === 0 || lengths[index] < baseDistance - half,
  );
  body.push(base.point);
  // A mitred offset: the normal halfway between the two segments at a vertex,
  // made longer so that each segment's edge stays `half` away.
  const offsets = body.map((point, index) => {
    const before = index > 0 ? normalOf(body[index - 1], point) : null;
    const after =
      index < body.length - 1 ? normalOf(point, body[index + 1]) : null;
    const single = before ?? after ?? base.normal;
    const normal =
      before && after
        ? unit([before[0] + after[0], before[1] + after[1]])
        : index === body.length - 1
        ? base.normal
        : single;
    const scale =
      half / Math.max(0.2, normal[0] * single[0] + normal[1] * single[1]);
    return [normal[0] * scale, normal[1] * scale] as Vec;
  });
  const side = (sign: 1 | -1) =>
    body.map(
      (point, index) =>
        [
          point[0] + sign * offsets[index][0],
          point[1] + sign * offsets[index][1],
        ] as Vec,
    );
  const headHalf = (thickness * HEAD_WIDTH_PER_THICKNESS) / 2;
  const wing = (sign: 1 | -1): Vec => [
    base.point[0] + sign * base.normal[0] * headHalf,
    base.point[1] + sign * base.normal[1] * headHalf,
  ];
  const inside = side(1);
  const outside = side(-1);
  const outline: Vec[] = [
    ...outside,
    wing(-1),
    centre[centre.length - 1],
    wing(1),
    ...inside.reverse(),
  ];
  outline.push(outline[0]);
  return {
    outline,
    tip: centre[centre.length - 1],
    base: base.point,
    inner: (fraction: number): Vec => {
      const { point, normal } = at(baseDistance * fraction);
      return [point[0] + normal[0] * half, point[1] + normal[1] * half];
    },
  };
};

/** Stretch an outline and its handle points so the outline's box is exactly `width` × `height`. */
const fitToBox = (
  shape: AnchoredShape,
  width: number,
  height: number,
): AnchoredShape => {
  const xs = shape.outline.map(([x]) => x);
  const ys = shape.outline.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const scaleX = width / (Math.max(...xs) - minX || 1);
  const scaleY = height / (Math.max(...ys) - minY || 1);
  const map = ([x, y]: Vec): Vec => [(x - minX) * scaleX, (y - minY) * scaleY];
  return {
    outline: shape.outline.map(map),
    anchors: Object.fromEntries(
      Object.entries(shape.anchors).map(([name, point]) => [name, map(point)]),
    ),
  };
};

const filledArrow: AnchoredBuilder = (id, width, height, read) => {
  const direction = id.slice("arrow-".length) as Direction;
  const vertical = direction === "up" || direction === "down";
  const lengthAxis = vertical ? height : width;
  const crossAxis = vertical ? width : height;
  const shaft = read("shaftRatio") * crossAxis;
  const headPx = Math.min(crossAxis * read("headAspect"), lengthAxis * 0.85);
  const headStart = lengthAxis - headPx;
  const center = crossAxis / 2;
  return orientShape(
    {
      outline: [
        [0, center - shaft / 2],
        [headStart, center - shaft / 2],
        [headStart, 0],
        [lengthAxis, center],
        [headStart, crossAxis],
        [headStart, center + shaft / 2],
        [0, center + shaft / 2],
        [0, center - shaft / 2],
      ],
      anchors: {
        shaft: [headStart / 2, center - shaft / 2],
        head: [headStart, center],
      },
    },
    direction,
    width,
    height,
  );
};

const doubleArrow: AnchoredBuilder = (_id, width, height, read) => {
  const shaft = read("thicknessRatio") * height;
  const head = Math.min(height * read("headAspect"), width * 0.42);
  const center = height / 2;
  const top = center - shaft / 2;
  const bottom = center + shaft / 2;
  return {
    outline: [
      [0, center],
      [head, 0],
      [head, top],
      [width - head, top],
      [width - head, 0],
      [width, center],
      [width - head, height],
      [width - head, bottom],
      [head, bottom],
      [head, height],
      [0, center],
    ],
    anchors: {
      thickness: [width / 2, top],
      head: [width - head, center],
    },
  };
};

const bentArrow: AnchoredBuilder = (_id, width, height, read) => {
  const headH = Math.min(height * 0.56, width * 1.1);
  const headMidY = headH / 2;
  const barH = Math.min(read("thicknessRatio") * headH, width * 0.4);
  const barTop = headMidY - barH / 2;
  const barBot = headMidY + barH / 2;
  const legW = barH;
  const headPx = Math.min(
    headH * read("headAspect"),
    Math.max(width - legW, 0) * 0.85,
  );
  const headBaseX = width - headPx;
  return {
    outline: [
      [0, height],
      [0, barTop],
      [headBaseX, barTop],
      [headBaseX, 0],
      [width, headMidY],
      [headBaseX, headH],
      [headBaseX, barBot],
      [legW, barBot],
      [legW, height],
      [0, height],
    ],
    anchors: {
      thickness: [(legW + headBaseX) / 2, barBot],
      head: [headBaseX, headMidY],
    },
  };
};

const curvedArrow: AnchoredBuilder = (_id, width, height, read) => {
  const sweep = read("bendRatio") * Math.PI;
  const thickness = read("thicknessRatio");
  const centre = arcPoints(1, 0, 1, Math.PI, sweep);
  const arrow = bandArrow(centre, thickness, read("headLengthRatio") * sweep);
  return fitToBox(
    {
      outline: arrow.outline,
      anchors: {
        bend: arrow.tip,
        thickness: arrow.inner(0.5),
        head: arrow.base,
      },
    },
    width,
    height,
  );
};

const uTurnArrow: AnchoredBuilder = (_id, width, height, read) => {
  const thickness = read("thicknessRatio");
  const gap = read("gapRatio");
  const radius = (thickness + gap) / 2;
  const centre: Vec[] = [
    [0, 1],
    ...arcPoints(radius, 0, radius, Math.PI, Math.PI),
    [radius * 2, 1],
  ];
  const arrow = bandArrow(
    centre,
    thickness,
    thickness * HEAD_LENGTH_PER_THICKNESS,
  );
  return fitToBox(
    {
      outline: arrow.outline,
      anchors: {
        gap: [radius * 2 - thickness / 2, 0.25],
        thickness: [thickness / 2, 0.6],
      },
    },
    width,
    height,
  );
};

const circleArrow: AnchoredBuilder = (_id, width, height, read) => {
  const opening = read("openingRatio") * Math.PI * 2;
  const thickness = read("thicknessRatio");
  const centre = arcPoints(
    0,
    0,
    1,
    -Math.PI / 2 + opening / 2,
    Math.PI * 2 - opening,
  );
  const arrow = bandArrow(
    centre,
    thickness,
    thickness * HEAD_LENGTH_PER_THICKNESS,
  );
  return fitToBox(
    {
      outline: arrow.outline,
      anchors: { opening: arrow.tip, thickness: arrow.inner(0.5) },
    },
    width,
    height,
  );
};

const pentagonArrow: AnchoredBuilder = (_id, width, height, read) => {
  const headPx = Math.min(height * read("headAspect"), width * 0.85);
  const shoulder = width - headPx;
  return {
    outline: [
      [0, 0],
      [shoulder, 0],
      [width, height / 2],
      [shoulder, height],
      [0, height],
      [0, 0],
    ],
    anchors: {
      head: [shoulder, 0],
    },
  };
};

const notchedArrow: AnchoredBuilder = (_id, width, height, read) => {
  const headPx = Math.min(height * read("headAspect"), width * 0.45);
  const shoulder = width - headPx;
  return {
    outline: [
      [0, 0],
      [shoulder, 0],
      [width, height / 2],
      [shoulder, height],
      [0, height],
      [headPx, height / 2],
      [0, 0],
    ],
    anchors: {
      head: [shoulder, 0],
    },
  };
};

const chevron: AnchoredBuilder = (id, width, height, read) => {
  const direction = id.slice("chevron-".length) as Direction;
  const vertical = direction === "up" || direction === "down";
  const lengthAxis = vertical ? height : width;
  const crossAxis = vertical ? width : height;
  const thickness = read("thicknessRatio");
  return orientShape(
    {
      outline: [
        [0, 0],
        [lengthAxis * thickness, 0],
        [lengthAxis, crossAxis / 2],
        [lengthAxis * thickness, crossAxis],
        [0, crossAxis],
        [lengthAxis * (1 - thickness), crossAxis / 2],
        [0, 0],
      ],
      anchors: {
        thickness: [lengthAxis * thickness, 0],
      },
    },
    direction,
    width,
    height,
  );
};

/**
 * Curly brace built from 4 constant-radius quarter arcs (`ry = min(depth/2, seg1/2, seg2/2, 18)`)
 * sampled at 8 steps per arc. Stays crisp from tiny sizes to 2000px tall.
 */
const buildLeftBrace = (
  depth: number,
  span: number,
  cuspRatio: number,
): AnchoredShape => {
  const cuspY = cuspRatio * span;
  const seg1 = cuspY;
  const seg2 = span - cuspY;
  const rx = depth / 2;
  const ry = Math.min(
    depth / 2,
    seg1 / 2,
    seg2 / 2,
    Math.max(BRACE_MAX_RADIUS, depth * 0.35),
  );
  const raw: Vec[] = [
    ...ellipseArcPoints(
      depth,
      ry,
      rx,
      ry,
      -Math.PI / 2,
      -Math.PI / 2,
      BRACE_ARC_STEPS,
    ),
    ...ellipseArcPoints(
      0,
      cuspY - ry,
      rx,
      ry,
      0,
      Math.PI / 2,
      BRACE_ARC_STEPS,
    ),
    ...ellipseArcPoints(
      0,
      cuspY + ry,
      rx,
      ry,
      -Math.PI / 2,
      Math.PI / 2,
      BRACE_ARC_STEPS,
    ),
    ...ellipseArcPoints(
      depth,
      span - ry,
      rx,
      ry,
      Math.PI,
      -Math.PI / 2,
      BRACE_ARC_STEPS,
    ),
  ];
  return {
    outline: dedupeAdjacent(raw),
    anchors: {
      cusp: [0, cuspY],
    },
  };
};

const brace: AnchoredBuilder = (id, width, height, read) => {
  const direction = id.slice("brace-".length) as Direction;
  const cuspRatio = read("cuspRatio");
  if (direction === "left") {
    return buildLeftBrace(width, height, cuspRatio);
  }
  if (direction === "right") {
    const base = buildLeftBrace(width, height, cuspRatio);
    return {
      outline: base.outline.map(([x, y]) => [width - x, y]),
      anchors: { cusp: [width, base.anchors.cusp![1]] },
    };
  }
  // Horizontal braces: build canonical left brace with (depth=height, span=width)
  const base = buildLeftBrace(height, width, cuspRatio);
  if (direction === "up") {
    return {
      outline: base.outline.map(([x, y]) => [y, x]),
      anchors: { cusp: [base.anchors.cusp![1], 0] },
    };
  }
  return {
    outline: base.outline.map(([x, y]) => [y, height - x]),
    anchors: { cusp: [base.anchors.cusp![1], height] },
  };
};

const bracket: AnchoredBuilder = (id, width, height) => {
  const direction = id.slice("bracket-".length) as Direction;
  let outline: Vec[];
  switch (direction) {
    case "left":
      outline = [
        [width, 0],
        [0, 0],
        [0, height],
        [width, height],
      ];
      break;
    case "right":
      outline = [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ];
      break;
    case "up":
      outline = [
        [0, height],
        [0, 0],
        [width, 0],
        [width, height],
      ];
      break;
    case "down":
      outline = [
        [0, 0],
        [0, height],
        [width, height],
        [width, 0],
      ];
      break;
  }
  return { outline, anchors: {} };
};

const parenthesis: AnchoredBuilder = (id, width, height) => {
  const isRight = id === "parenthesis-right";
  const outline: Vec[] = Array.from({ length: CURVE_STEPS + 1 }, (_, index) => {
    const angle = (Math.PI * index) / CURVE_STEPS;
    const xLeft = width * (1 - Math.sin(angle));
    const y = (height / 2) * (1 - Math.cos(angle));
    return [isRight ? width - xLeft : xLeft, y] as Vec;
  });
  return { outline, anchors: {} };
};

const callout: AnchoredBuilder = (id, width, height, read) => {
  const tailRatio = read("tailPositionRatio");
  if (id === "callout-oval") {
    const bodyH = height * 0.78;
    const rx = width / 2;
    const ry = bodyH / 2;
    const cx = rx;
    const cy = ry;
    const tipX = tailRatio * width;
    const tailAngle = Math.acos(clamp(2 * tailRatio - 1, -0.82, 0.82));
    const spread = 0.16;
    const a1 = Math.max(0.12 * Math.PI, tailAngle - spread);
    const a2 = Math.min(0.88 * Math.PI, tailAngle + spread);
    const startAngle = a2;
    const endAngle = a1 + Math.PI * 2;
    const steps = 40;
    const angles: number[] = [];
    for (let i = 0; i <= steps; i++) {
      angles.push(startAngle + ((endAngle - startAngle) * i) / steps);
    }
    // Include exact cardinal angles so the oval fills [0..width] x [0..bodyH] precisely.
    for (const cardinal of [Math.PI, Math.PI * 1.5, Math.PI * 2]) {
      if (cardinal > startAngle && cardinal < endAngle) {
        angles.push(cardinal);
      }
    }
    angles.sort((a, b) => a - b);
    const ovalPoints: Vec[] = angles.map((angle) => [
      cx + rx * Math.cos(angle),
      cy + ry * Math.sin(angle),
    ]);
    const outline = closeOutline([...ovalPoints, [tipX, height]]);
    return {
      outline,
      anchors: { tail: [tipX, height] },
    };
  }

  const bodyBottom = height * 0.76;
  const anchor = tailRatio * width;
  if (id === "callout-rounded") {
    const r = Math.min(width * 0.12, bodyBottom * 0.28, 20);
    const halfTail = Math.min(width * 0.075, height * 0.22);
    const raw: Vec[] = [
      ...arcPoints(width - r, r, r, -Math.PI / 2, Math.PI / 2, CORNER_ARC_STEPS),
      ...arcPoints(
        width - r,
        bodyBottom - r,
        r,
        0,
        Math.PI / 2,
        CORNER_ARC_STEPS,
      ),
      [anchor + halfTail, bodyBottom],
      [anchor, height],
      [anchor - halfTail, bodyBottom],
      ...arcPoints(
        r,
        bodyBottom - r,
        r,
        Math.PI / 2,
        Math.PI / 2,
        CORNER_ARC_STEPS,
      ),
      ...arcPoints(r, r, r, Math.PI, Math.PI / 2, CORNER_ARC_STEPS),
    ];
    const outline = closeOutline(raw);
    return {
      outline,
      anchors: { tail: [anchor, height] },
    };
  }

  // callout-rectangle
  const halfTail = Math.min(width * 0.09, height * 0.22);
  return {
    outline: [
      [0, 0],
      [width, 0],
      [width, bodyBottom],
      [anchor + halfTail, bodyBottom],
      [anchor, height],
      [anchor - halfTail, bodyBottom],
      [0, bodyBottom],
      [0, 0],
    ],
    anchors: { tail: [anchor, height] },
  };
};

/** Outer intersection of two overlapping circles along a clockwise ring (screen coords). */
const outerCircleIntersection = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): Vec => {
  const [ax, ay, ra] = a;
  const [bx, by, rb] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy) || 1;
  const dist = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - dist * dist));
  const mx = ax + (dist * dx) / d;
  const my = ay + (dist * dy) / d;
  return [mx + (h * dy) / d, my - (h * dx) / d];
};

const CLOUD_LOBES: readonly (readonly [number, number, number])[] = [
  [-0.38, -0.22, 0.36],
  [0.06, -0.34, 0.42],
  [0.5, -0.14, 0.34],
  [0.66, 0.18, 0.28],
  [0.26, 0.28, 0.3],
  [-0.2, 0.28, 0.3],
  [-0.64, 0.14, 0.3],
];

const cloud: AnchoredBuilder = (_id, width, height) => {
  const n = CLOUD_LOBES.length;
  const raw: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const prev = CLOUD_LOBES[(i - 1 + n) % n];
    const curr = CLOUD_LOBES[i];
    const next = CLOUD_LOBES[(i + 1) % n];
    const pStart = outerCircleIntersection(prev, curr);
    const pEnd = outerCircleIntersection(curr, next);
    const aStart = Math.atan2(pStart[1] - curr[1], pStart[0] - curr[0]);
    const aEnd = Math.atan2(pEnd[1] - curr[1], pEnd[0] - curr[0]);
    const sweep = ((aEnd - aStart) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const lobePts = arcPoints(curr[0], curr[1], curr[2], aStart, sweep, 8);
    raw.push(...(i === 0 ? lobePts : lobePts.slice(1)));
  }
  const outline = closeOutline(raw);
  return fitToBox({ outline, anchors: {} }, width, height);
};

const noteFold: AnchoredBuilder = (_id, width, height) => {
  const fold = Math.min(width, height) * 0.25;
  return {
    outline: [
      [0, 0],
      [width - fold, 0],
      [width, fold],
      [width, height],
      [0, height],
      [0, 0],
    ],
    anchors: {},
  };
};

const documentShape: AnchoredBuilder = (_id, width, height) => {
  const amp = height * 0.08;
  const baseY = height - amp;
  const waveSteps = 24;
  const wave: Vec[] = Array.from({ length: waveSteps + 1 }, (_, i) => {
    const t = 1 - i / waveSteps;
    return [width * t, baseY + amp * Math.sin(t * Math.PI * 2)] as Vec;
  });
  return {
    outline: closeOutline([[0, 0], [width, 0], ...wave]),
    anchors: {},
  };
};

const pill: AnchoredBuilder = (_id, width, height) => {
  const capSteps = 16;
  let raw: Vec[];
  if (width >= height) {
    const r = height / 2;
    raw = [
      ...arcPoints(width - r, r, r, -Math.PI / 2, Math.PI, capSteps),
      ...arcPoints(r, r, r, Math.PI / 2, Math.PI, capSteps),
    ];
  } else {
    const r = width / 2;
    raw = [
      ...arcPoints(r, r, r, Math.PI, Math.PI, capSteps),
      ...arcPoints(r, height - r, r, 0, Math.PI, capSteps),
    ];
  }
  const outline = closeOutline(raw);
  return { outline, anchors: {} };
};

const rightTriangle: AnchoredBuilder = (_id, width, height) => ({
  outline: [
    [0, 0],
    [width, height],
    [0, height],
    [0, 0],
  ],
  anchors: {},
});

const pentagon: AnchoredBuilder = (_id, width, height) => {
  const outline: Vec[] = Array.from({ length: 6 }, (_, i) => {
    const angle = -Math.PI / 2 + ((i % 5) * Math.PI * 2) / 5;
    return [Math.cos(angle), Math.sin(angle)] as Vec;
  });
  return fitToBox({ outline, anchors: {} }, width, height);
};

const octagon: AnchoredBuilder = (_id, width, height) => {
  const cut = Math.min(width, height) / (2 + Math.SQRT2);
  return {
    outline: [
      [cut, 0],
      [width - cut, 0],
      [width, cut],
      [width, height - cut],
      [width - cut, height],
      [cut, height],
      [0, height - cut],
      [0, cut],
      [cut, 0],
    ],
    anchors: {},
  };
};

const parallelogram: AnchoredBuilder = (_id, width, height, read) => {
  const skew = read("skewRatio") * width;
  return {
    outline: [
      [0, height],
      [skew, 0],
      [width, 0],
      [width - skew, height],
      [0, height],
    ],
    anchors: { skew: [skew, 0] },
  };
};

const trapezoid: AnchoredBuilder = (_id, width, height, read) => {
  const inset = ((1 - read("topWidthRatio")) / 2) * width;
  return {
    outline: [
      [0, height],
      [inset, 0],
      [width - inset, 0],
      [width, height],
      [0, height],
    ],
    anchors: { topWidth: [width - inset, 0] },
  };
};

const plusShape: AnchoredBuilder = (_id, width, height, read) => {
  const arm = read("thicknessRatio") * Math.min(width, height);
  const x1 = (width - arm) / 2;
  const x2 = (width + arm) / 2;
  const y1 = (height - arm) / 2;
  const y2 = (height + arm) / 2;
  return {
    outline: [
      [x1, 0],
      [x2, 0],
      [x2, y1],
      [width, y1],
      [width, y2],
      [x2, y2],
      [x2, height],
      [x1, height],
      [x1, y2],
      [0, y2],
      [0, y1],
      [x1, y1],
      [x1, 0],
    ],
    anchors: { thickness: [x2, y1] },
  };
};

const star4: AnchoredBuilder = (_id, width, height) => {
  const cx = width / 2;
  const cy = height / 2;
  const ix = width * 0.14;
  const iy = height * 0.14;
  return {
    outline: [
      [cx, 0],
      [cx + ix, cy - iy],
      [width, cy],
      [cx + ix, cy + iy],
      [cx, height],
      [cx - ix, cy + iy],
      [0, cy],
      [cx - ix, cy - iy],
      [cx, 0],
    ],
    anchors: {},
  };
};

const starburst: AnchoredBuilder = (_id, width, height) => {
  const rays = 12;
  const total = rays * 2;
  const outline: Vec[] = Array.from({ length: total + 1 }, (_, i) => {
    const idx = i % total;
    const angle = -Math.PI / 2 + (idx * Math.PI * 2) / total;
    const radius = idx % 2 === 0 ? 1 : 0.76;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as Vec;
  });
  return fitToBox({ outline, anchors: {} }, width, height);
};

const heart: AnchoredBuilder = (_id, width, height) => {
  const steps = 48;
  const outline: Vec[] = Array.from({ length: steps + 1 }, (_, i) => {
    const t = ((i % steps) * Math.PI * 2) / steps;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t)
    );
    return [x, y] as Vec;
  });
  return fitToBox({ outline, anchors: {} }, width, height);
};

const semicircle: AnchoredBuilder = (_id, width, height) => {
  const arc = ellipseArcPoints(
    width / 2,
    height,
    width / 2,
    height,
    Math.PI,
    Math.PI,
    CURVE_STEPS,
  );
  return { outline: closeOutline(arc), anchors: {} };
};

const bookmark: AnchoredBuilder = (_id, width, height) => {
  const notchY = height - Math.min(height * 0.25, width * 0.45);
  return {
    outline: [
      [0, 0],
      [width, 0],
      [width, height],
      [width / 2, notchY],
      [0, height],
      [0, 0],
    ],
    anchors: {},
  };
};

const tagShape: AnchoredBuilder = (_id, width, height) => {
  const nose = Math.min(width * 0.25, height * 0.5);
  return {
    outline: [
      [0, height * 0.35],
      [nose, 0],
      [width, 0],
      [width, height],
      [nose, height],
      [0, height * 0.65],
      [0, height * 0.35],
    ],
    anchors: {},
  };
};

const quadBezier = (p0: Vec, p1: Vec, p2: Vec, steps: number): Vec[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return [
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ] as Vec;
  });

const shield: AnchoredBuilder = (_id, width, height) => {
  const sideY = height * 0.45;
  const ctrlY = height * 0.82;
  const rightCurve = quadBezier(
    [width, sideY],
    [width, ctrlY],
    [width / 2, height],
    12,
  );
  const leftCurve = quadBezier(
    [width / 2, height],
    [0, ctrlY],
    [0, sideY],
    12,
  );
  const outline = closeOutline([
    [0, 0],
    [width, 0],
    ...rightCurve,
    ...leftCurve.slice(1),
  ]);
  return { outline, anchors: {} };
};

const ribbon: AnchoredBuilder = (_id, width, height) => {
  const notch = Math.min(width * 0.14, height * 0.4);
  return {
    outline: [
      [0, 0],
      [width, 0],
      [width - notch, height / 2],
      [width, height],
      [0, height],
      [notch, height / 2],
      [0, 0],
    ],
    anchors: {},
  };
};

const cylinder: AnchoredBuilder = (_id, width, height) => {
  const rx = width / 2;
  const ry = Math.min(height * 0.14, width * 0.22);
  const capSteps = 16;
  const topArc = ellipseArcPoints(rx, ry, rx, ry, Math.PI, Math.PI, capSteps);
  const bottomArc = ellipseArcPoints(
    rx,
    height - ry,
    rx,
    ry,
    0,
    Math.PI,
    capSteps,
  );
  return { outline: closeOutline([...topArc, ...bottomArc]), anchors: {} };
};

/** Every Smart Shape kind has one builder here. */
const ANCHORED_BUILDERS: Record<SmartShapeKind, AnchoredBuilder> = {
  "filled-arrow": filledArrow,
  "double-arrow": doubleArrow,
  "bent-arrow": bentArrow,
  "curved-arrow": curvedArrow,
  "u-turn-arrow": uTurnArrow,
  "circle-arrow": circleArrow,
  "pentagon-arrow": pentagonArrow,
  "notched-arrow": notchedArrow,
  chevron,
  brace,
  bracket,
  parenthesis,
  callout,
  cloud,
  "note-fold": noteFold,
  document: documentShape,
  pill,
  "right-triangle": rightTriangle,
  pentagon,
  octagon,
  parallelogram,
  trapezoid,
  plus: plusShape,
  "star-4": star4,
  starburst,
  heart,
  semicircle,
  bookmark,
  tag: tagShape,
  shield,
  ribbon,
  cylinder,
};

const buildAnchored = (
  id: SmartShapeId,
  width: number,
  height: number,
  parameters: Record<string, number>,
  flip?: SmartShapeFlip,
): AnchoredShape => {
  const def = DEFINITIONS_BY_ID.get(id);
  if (!def) {
    throw new Error(`Unknown Smart Shape: ${id}`);
  }
  const builder = ANCHORED_BUILDERS[def.kind];
  const shape = builder(id, width, height, (parameter) =>
    readSmartShapeParameter(id, width, height, parameters, parameter),
  );
  if (!flip?.flipX && !flip?.flipY) {
    return shape;
  }
  const mirror = ([x, y]: Vec): Vec => [
    flip.flipX ? width - x : x,
    flip.flipY ? height - y : y,
  ];
  return {
    outline: shape.outline.map(mirror),
    anchors: Object.fromEntries(
      Object.entries(shape.anchors).map(([name, pt]) => [name, mirror(pt)]),
    ),
  };
};

/** The handle points of an anchored shape, in the element's own frame (first point at 0, 0). */
const anchoredHandlePoints = (
  shape: AnchoredShape,
  handles: readonly SmartShapeHandleName[],
) => {
  const [originX, originY] = shape.outline[0];
  return handles.flatMap((name) => {
    const point = shape.anchors[name];
    return point
      ? [
          {
            name,
            point: pointFrom<LocalPoint>(
              point[0] - originX,
              point[1] - originY,
            ),
          },
        ]
      : [];
  });
};

/** Samples across a parameter's limits, then halvings around the best one. */
const SOLVE_SAMPLES = 32;
const SOLVE_REFINEMENTS = 12;

/**
 * The value of the handle's parameter whose handle anchor is nearest `targetBoxPoint`
 * in box coordinates `(0..width, 0..height)`.
 */
const solveHandle = (
  id: SmartShapeId,
  width: number,
  height: number,
  parameters: Record<string, number>,
  handle: SmartShapeHandleName,
  targetBoxPoint: Vec,
  flip?: SmartShapeFlip,
) => {
  const parameter = getSmartShapeHandleParameter(id, handle);
  const limits = DEFINITIONS_BY_ID.get(id)?.limits[parameter];
  if (!limits) {
    return null;
  }
  const [min, max] = limits;
  const distanceAt = (value: number) => {
    const shape = buildAnchored(
      id,
      width,
      height,
      {
        ...parameters,
        [parameter]: value,
      },
      flip,
    );
    const point = shape.anchors[handle];
    return point
      ? Math.hypot(point[0] - targetBoxPoint[0], point[1] - targetBoxPoint[1])
      : Infinity;
  };
  let best = min;
  let bestDistance = Infinity;
  for (let index = 0; index <= SOLVE_SAMPLES; index++) {
    const value = min + ((max - min) * index) / SOLVE_SAMPLES;
    const distance = distanceAt(value);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }
  let step = (max - min) / SOLVE_SAMPLES;
  for (let round = 0; round < SOLVE_REFINEMENTS; round++) {
    step /= 2;
    for (const value of [best - step, best + step]) {
      if (value >= min && value <= max) {
        const distance = distanceAt(value);
        if (distance < bestDistance) {
          best = value;
          bestDistance = distance;
        }
      }
    }
  }
  return clamp(Math.round(best * 1000) / 1000, min, max);
};

// Paired directional IDs swapped on horizontal or vertical flip (YAZ-6673).
const HORIZONTAL_FLIP_ID: Partial<Record<SmartShapeId, SmartShapeId>> = {
  "arrow-right": "arrow-left",
  "arrow-left": "arrow-right",
  "chevron-right": "chevron-left",
  "chevron-left": "chevron-right",
  "brace-left": "brace-right",
  "brace-right": "brace-left",
  "bracket-left": "bracket-right",
  "bracket-right": "bracket-left",
  "parenthesis-left": "parenthesis-right",
  "parenthesis-right": "parenthesis-left",
};

const VERTICAL_FLIP_ID: Partial<Record<SmartShapeId, SmartShapeId>> = {
  "arrow-up": "arrow-down",
  "arrow-down": "arrow-up",
  "chevron-up": "chevron-down",
  "chevron-down": "chevron-up",
  "brace-up": "brace-down",
  "brace-down": "brace-up",
  "bracket-up": "bracket-down",
  "bracket-down": "bracket-up",
};

export const getSmartShapeDefinition = (id: SmartShapeId) =>
  DEFINITIONS_BY_ID.get(id);

export const isSmartShapeId = (value: unknown): value is SmartShapeId =>
  typeof value === "string" &&
  (SMART_SHAPE_IDS as readonly string[]).includes(value);

export const createSmartShapeMetadata = (
  id: SmartShapeId,
): SmartShapeMetadata => {
  const item = getSmartShapeDefinition(id);
  if (!item) {
    throw new Error(`Unknown Smart Shape: ${id}`);
  }
  return {
    version: 1,
    id,
    kind: item.kind,
    parameters: { ...item.defaults },
  };
};

export const getSmartShapeMetadata = (
  element: Pick<ExcalidrawElement, "customData">,
): SmartShapeMetadata | null => {
  const value = element.customData?.yasinSmartShape;
  return value?.version === 1 &&
    isSmartShapeId(value.id) &&
    typeof value.parameters === "object"
    ? (value as SmartShapeMetadata)
    : null;
};

export const generateSmartShapePoints = (
  id: SmartShapeId,
  width: number,
  height: number,
  parameters: Record<string, number>,
  flip?: SmartShapeFlip,
): LocalPoint[] => {
  const safeWidth = Math.max(Math.abs(width), 1e-3);
  const safeHeight = Math.max(Math.abs(height), 1e-3);
  const anchored = buildAnchored(id, safeWidth, safeHeight, parameters, flip);
  const generated = points(anchored.outline);
  const [originX, originY] = generated[0];
  return generated.map(([x, y]) =>
    pointFrom<LocalPoint>(x - originX, y - originY),
  );
};

/**
 * Regenerates a Smart Shape's points parametrically for `(nextWidth, nextHeight)`,
 * handling legacy `headLengthRatio` migration and directional flip swaps/mirrors.
 * Returns `null` when `origElement` is not a Smart Shape or dimensions are degenerate.
 */
export const resizeSmartShapePoints = (
  origElement: Pick<
    ExcalidrawElement,
    "type" | "width" | "height" | "customData"
  >,
  nextWidth: number,
  nextHeight: number,
  opts?: { flipByX?: boolean; flipByY?: boolean },
): SmartShapeResizeResult | null => {
  if (origElement.type !== "line") {
    return null;
  }
  const metadata = getSmartShapeMetadata(origElement);
  if (!metadata) {
    return null;
  }
  const width = Math.abs(nextWidth);
  const height = Math.abs(nextHeight);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width === 0 ||
    height === 0
  ) {
    return null;
  }

  const origDef = DEFINITIONS_BY_ID.get(metadata.id);
  if (!origDef) {
    return null;
  }

  const parameters: Record<string, number> = { ...metadata.parameters };
  // Convert legacy `headLengthRatio` using resize-start dimensions so the first
  // resize preserves the arrowhead's visual size instead of stretching it.
  if (
    "headAspect" in origDef.limits &&
    !Number.isFinite(parameters.headAspect) &&
    Number.isFinite(parameters.headLengthRatio)
  ) {
    parameters.headAspect = readSmartShapeParameter(
      metadata.id,
      Math.max(Math.abs(origElement.width), 1),
      Math.max(Math.abs(origElement.height), 1),
      parameters,
      "headAspect",
    );
    delete parameters.headLengthRatio;
  }

  const flipByX = opts?.flipByX ?? nextWidth < 0;
  const flipByY = opts?.flipByY ?? nextHeight < 0;

  let nextId: SmartShapeId = metadata.id;
  let flipX = Boolean(metadata.flipX);
  let flipY = Boolean(metadata.flipY);

  if (flipByX) {
    const swappedX = HORIZONTAL_FLIP_ID[nextId];
    if (swappedX) {
      nextId = swappedX;
    } else {
      const defAfterX = DEFINITIONS_BY_ID.get(nextId)!;
      if (defAfterX.kind === "callout") {
        const current = readSmartShapeParameter(
          nextId,
          width,
          height,
          parameters,
          "tailPositionRatio",
        );
        parameters.tailPositionRatio = clampParameter(
          nextId,
          "tailPositionRatio",
          1 - current,
        );
      } else if (nextId === "brace-up" || nextId === "brace-down") {
        const current = readSmartShapeParameter(
          nextId,
          width,
          height,
          parameters,
          "cuspRatio",
        );
        parameters.cuspRatio = clampParameter(
          nextId,
          "cuspRatio",
          1 - current,
        );
      } else {
        flipX = !flipX;
      }
    }
  }
  if (flipByY) {
    const swappedY = VERTICAL_FLIP_ID[nextId];
    if (swappedY) {
      nextId = swappedY;
    } else if (nextId === "brace-left" || nextId === "brace-right") {
      const current = readSmartShapeParameter(
        nextId,
        width,
        height,
        parameters,
        "cuspRatio",
      );
      parameters.cuspRatio = clampParameter(nextId, "cuspRatio", 1 - current);
    } else {
      flipY = !flipY;
    }
  }

  const nextDef = DEFINITIONS_BY_ID.get(nextId)!;
  const nextFlip: SmartShapeFlip = {
    ...(flipX ? { flipX: true } : {}),
    ...(flipY ? { flipY: true } : {}),
  };
  const nextPoints = generateSmartShapePoints(
    nextId,
    width,
    height,
    parameters,
    nextFlip,
  );
  const nextMetadata: SmartShapeMetadata = {
    version: 1,
    id: nextId,
    kind: nextDef.kind,
    parameters,
    ...nextFlip,
  };

  return {
    points: nextPoints,
    customData: {
      ...origElement.customData,
      yasinSmartShape: nextMetadata,
    },
  };
};

export const updateSmartShapeParameter = (
  element: ExcalidrawLinearElement,
  parameter: SmartShapeParameterName,
  value: number,
) => {
  const metadata = getSmartShapeMetadata(element);
  if (!metadata) {
    return element;
  }
  const def = DEFINITIONS_BY_ID.get(metadata.id);
  const clamped = clampParameter(metadata.id, parameter, value);
  const parameters: Record<string, number> = {
    ...metadata.parameters,
    [parameter]: clamped,
  };
  if (parameter === "headAspect" && def && !("headLengthRatio" in def.limits)) {
    delete parameters.headLengthRatio;
  }
  const flip: SmartShapeFlip = {
    flipX: metadata.flipX,
    flipY: metadata.flipY,
  };
  const nextPoints = generateSmartShapePoints(
    metadata.id,
    element.width,
    element.height,
    parameters,
    flip,
  );
  const [oldMinX, oldMinY] = getPointsMin(element.points);
  const [nextMinX, nextMinY] = getPointsMin(nextPoints);
  return newElementWith(element, {
    x: element.x + oldMinX - nextMinX,
    y: element.y + oldMinY - nextMinY,
    customData: {
      ...element.customData,
      yasinSmartShape: { ...metadata, parameters },
    },
    points: nextPoints,
  });
};

export const getSmartShapeHandles = (
  element: ExcalidrawLinearElement,
): SmartShapeHandle[] => {
  const metadata = getSmartShapeMetadata(element);
  const def = metadata ? getSmartShapeDefinition(metadata.id) : undefined;
  if (!metadata || !def || element.locked || def.handles.length === 0) {
    return [];
  }
  const anchored = buildAnchored(
    metadata.id,
    Math.max(Math.abs(element.width), 1e-3),
    Math.max(Math.abs(element.height), 1e-3),
    metadata.parameters,
    { flipX: metadata.flipX, flipY: metadata.flipY },
  );
  const localHandles = anchoredHandlePoints(anchored, def.handles);
  const [originX, originY] = anchored.outline[0];
  const [rawMinX, rawMinY, rawMaxX, rawMaxY] = getPointsBounds(
    anchored.outline,
  );
  const center = pointFrom<GlobalPoint>(
    element.x + (rawMinX + rawMaxX) / 2 - originX,
    element.y + (rawMinY + rawMaxY) / 2 - originY,
  );
  return localHandles.map(({ name, point }) => ({
    name,
    scenePoint: pointRotateRads(
      pointFrom<GlobalPoint>(element.x + point[0], element.y + point[1]),
      center,
      element.angle,
    ),
  }));
};

export const shouldShowSmartShapeHandles = (
  element: Pick<
    ExcalidrawLinearElement,
    "width" | "height" | "locked" | "customData"
  >,
  zoom: { value: number },
): boolean => {
  if (element.locked) {
    return false;
  }
  const metadata = getSmartShapeMetadata(element);
  const def = metadata ? getSmartShapeDefinition(metadata.id) : undefined;
  if (!metadata || !def || def.handles.length === 0) {
    return false;
  }
  const screenW = Math.abs(element.width) * zoom.value;
  const screenH = Math.abs(element.height) * zoom.value;
  const maxDim = Math.max(screenW, screenH);
  const minDim = Math.min(screenW, screenH);
  return def.handles.length === 1
    ? maxDim >= 56
    : maxDim >= 72 && minDim >= 36;
};

export const hitTestSmartShapeHandle = (
  element: ExcalidrawLinearElement,
  scenePoint: GlobalPoint,
  zoom: { value: number },
): SmartShapeHandleName | null =>
  shouldShowSmartShapeHandles(element, zoom)
    ? getSmartShapeHandles(element).find(
        ({ scenePoint: handlePoint }) =>
          pointDistance(handlePoint, scenePoint) <= 9 / zoom.value,
      )?.name ?? null
    : null;

export const updateSmartShapeFromHandle = (
  element: ExcalidrawLinearElement,
  handle: SmartShapeHandleName,
  scenePoint: GlobalPoint,
) => {
  const metadata = getSmartShapeMetadata(element);
  if (!metadata) {
    return element;
  }
  const flip: SmartShapeFlip = {
    flipX: metadata.flipX,
    flipY: metadata.flipY,
  };
  const generated = generateSmartShapePoints(
    metadata.id,
    element.width,
    element.height,
    metadata.parameters,
    flip,
  );
  const [minX, minY, maxX, maxY] = getPointsBounds(generated);
  const center = pointFrom<GlobalPoint>(
    element.x + (minX + maxX) / 2,
    element.y + (minY + maxY) / 2,
  );
  const unrotated = pointRotateRads(
    scenePoint,
    center,
    -element.angle as Radians,
  );
  const shapeX = unrotated[0] - element.x - minX;
  const shapeY = unrotated[1] - element.y - minY;

  const value = solveHandle(
    metadata.id,
    element.width,
    element.height,
    metadata.parameters,
    handle,
    [shapeX, shapeY],
    flip,
  );
  if (value === null) {
    return element;
  }
  return updateSmartShapeParameter(
    element,
    getSmartShapeHandleParameter(metadata.id, handle),
    value,
  );
};
