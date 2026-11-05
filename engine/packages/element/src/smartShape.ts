import { pointDistance, pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, LocalPoint, Radians } from "@excalidraw/math";

import { newElementWith } from "./mutateElement";

import type { ExcalidrawElement, ExcalidrawLinearElement } from "./types";

export const SMART_SHAPE_IDS = [
  "arrow-right",
  "arrow-left",
  "arrow-up",
  "arrow-down",
  "curved-arrow",
  "u-turn-arrow",
  "double-arrow",
  "circle-arrow",
  "chevron-right",
  "chevron-left",
  "chevron-up",
  "chevron-down",
  "brace-left",
  "brace-right",
  "bracket-left",
  "bracket-right",
  "parenthesis-left",
  "parenthesis-right",
  "callout-rectangle",
  "callout-rounded",
] as const;

export type SmartShapeId = typeof SMART_SHAPE_IDS[number];
export type SmartShapeKind =
  | "filled-arrow"
  | "curved-arrow"
  | "u-turn-arrow"
  | "double-arrow"
  | "circle-arrow"
  | "chevron"
  | "brace"
  | "bracket"
  | "parenthesis"
  | "callout";
export type SmartShapeHandleName =
  | "shaft"
  | "head"
  | "thickness"
  | "tail"
  | "bend"
  | "gap"
  | "opening";
export type SmartShapeParameterName =
  | "shaftRatio"
  | "headLengthRatio"
  | "thicknessRatio"
  | "tailPositionRatio"
  | "bendRatio"
  | "gapRatio"
  | "openingRatio";

/** Each handle moves one parameter; the Smart shape sliders show the same ones. */
export const SMART_SHAPE_HANDLE_PARAMETERS: Readonly<
  Record<SmartShapeHandleName, SmartShapeParameterName>
> = {
  shaft: "shaftRatio",
  head: "headLengthRatio",
  thickness: "thicknessRatio",
  tail: "tailPositionRatio",
  bend: "bendRatio",
  gap: "gapRatio",
  opening: "openingRatio",
};

export type SmartShapeMetadata = {
  version: 1;
  id: SmartShapeId;
  kind: SmartShapeKind;
  parameters: Record<string, number>;
};

export type SmartShapeDefinition = {
  id: SmartShapeId;
  title: string;
  kind: SmartShapeKind;
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

const definition = (
  value: Omit<SmartShapeDefinition, "width" | "height"> &
    Partial<Pick<SmartShapeDefinition, "width" | "height">>,
): SmartShapeDefinition => ({
  width: 200,
  height: 100,
  ...value,
});

export const SMART_SHAPE_DEFINITIONS: readonly SmartShapeDefinition[] = [
  definition({
    id: "arrow-right",
    title: "Arrow right",
    kind: "filled-arrow",
    closed: true,
    roundness: null,
    defaults: { shaftRatio: 0.5, headLengthRatio: 0.4 },
    limits: { shaftRatio: [0.1, 0.9], headLengthRatio: [0.15, 0.75] },
    handles: ["shaft", "head"],
  }),
  definition({
    id: "arrow-left",
    title: "Arrow left",
    kind: "filled-arrow",
    closed: true,
    roundness: null,
    defaults: { shaftRatio: 0.5, headLengthRatio: 0.4 },
    limits: { shaftRatio: [0.1, 0.9], headLengthRatio: [0.15, 0.75] },
    handles: ["shaft", "head"],
  }),
  definition({
    id: "arrow-up",
    title: "Arrow up",
    kind: "filled-arrow",
    closed: true,
    roundness: null,
    defaults: { shaftRatio: 0.5, headLengthRatio: 0.4 },
    limits: { shaftRatio: [0.1, 0.9], headLengthRatio: [0.15, 0.75] },
    handles: ["shaft", "head"],
  }),
  definition({
    id: "arrow-down",
    title: "Arrow down",
    kind: "filled-arrow",
    closed: true,
    roundness: null,
    defaults: { shaftRatio: 0.5, headLengthRatio: 0.4 },
    limits: { shaftRatio: [0.1, 0.9], headLengthRatio: [0.15, 0.75] },
    handles: ["shaft", "head"],
  }),
  // YAZ-4356: the four arrows drawn along a centre line. Each kind has its point builder in
  // `ANCHORED_BUILDERS`, which also places its handles.
  definition({
    id: "curved-arrow",
    title: "Curved arrow",
    kind: "curved-arrow",
    width: 200,
    height: 120,
    closed: true,
    roundness: null,
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
    width: 140,
    height: 200,
    closed: true,
    roundness: null,
    defaults: { gapRatio: 0.4, thicknessRatio: 0.22 },
    limits: { gapRatio: [0.2, 0.9], thicknessRatio: [0.1, 0.35] },
    handles: ["gap", "thickness"],
  }),
  definition({
    id: "double-arrow",
    title: "Double arrow",
    kind: "double-arrow",
    width: 240,
    height: 100,
    closed: true,
    roundness: null,
    defaults: { thicknessRatio: 0.45, headLengthRatio: 0.25 },
    limits: { thicknessRatio: [0.1, 0.9], headLengthRatio: [0.1, 0.45] },
    handles: ["thickness", "head"],
  }),
  definition({
    id: "circle-arrow",
    title: "Circle arrow",
    kind: "circle-arrow",
    width: 160,
    height: 160,
    closed: true,
    roundness: null,
    defaults: { openingRatio: 0.15, thicknessRatio: 0.3 },
    limits: { openingRatio: [0.05, 0.3], thicknessRatio: [0.1, 0.5] },
    handles: ["opening", "thickness"],
  }),
  ...(["right", "left", "up", "down"] as const).map((direction) =>
    definition({
      id: `chevron-${direction}`,
      title: `Chevron ${direction}`,
      kind: "chevron",
      closed: true,
      roundness: null,
      defaults: { thicknessRatio: 0.28 },
      limits: { thicknessRatio: [0.12, 0.46] },
      handles: ["thickness"],
    }),
  ),
  definition({
    id: "brace-left",
    title: "Curly brace left",
    kind: "brace",
    width: 60,
    height: 200,
    closed: false,
    roundness: { type: 2 },
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "brace-right",
    title: "Curly brace right",
    kind: "brace",
    width: 60,
    height: 200,
    closed: false,
    roundness: { type: 2 },
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "bracket-left",
    title: "Bracket left",
    kind: "bracket",
    width: 40,
    height: 200,
    closed: false,
    roundness: null,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "bracket-right",
    title: "Bracket right",
    kind: "bracket",
    width: 40,
    height: 200,
    closed: false,
    roundness: null,
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "parenthesis-left",
    title: "Parenthesis left",
    kind: "parenthesis",
    width: 50,
    height: 200,
    closed: false,
    roundness: { type: 2 },
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "parenthesis-right",
    title: "Parenthesis right",
    kind: "parenthesis",
    width: 50,
    height: 200,
    closed: false,
    roundness: { type: 2 },
    defaults: {},
    limits: {},
    handles: [],
  }),
  definition({
    id: "callout-rectangle",
    title: "Callout",
    kind: "callout",
    width: 180,
    height: 130,
    closed: true,
    roundness: null,
    defaults: { tailPositionRatio: 0.7 },
    limits: { tailPositionRatio: [0.2, 0.8] },
    handles: ["tail"],
  }),
  definition({
    id: "callout-rounded",
    title: "Rounded callout",
    kind: "callout",
    width: 180,
    height: 130,
    closed: true,
    roundness: { type: 2 },
    defaults: { tailPositionRatio: 0.7 },
    limits: { tailPositionRatio: [0.2, 0.8] },
    handles: ["tail"],
  }),
] as readonly SmartShapeDefinition[];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const DEFINITIONS_BY_ID = new Map(
  SMART_SHAPE_DEFINITIONS.map((item) => [item.id, item]),
);

/** `value` held to the parameter's own limits on that shape; no limits, no clamp. */
const clampParameter = (
  id: SmartShapeId,
  parameter: SmartShapeParameterName,
  value: number,
) => {
  const limits = DEFINITIONS_BY_ID.get(id)?.limits[parameter];
  return limits ? clamp(value, limits[0], limits[1]) : value;
};

/** A parameter as a builder uses it: the stored value or the default, within the limits. */
const readParameter = (
  id: SmartShapeId,
  parameters: Record<string, number>,
  parameter: SmartShapeParameterName,
) => {
  const stored = parameters[parameter];
  return clampParameter(
    id,
    parameter,
    Number.isFinite(stored)
      ? stored
      : DEFINITIONS_BY_ID.get(id)?.defaults[parameter] ?? 0.5,
  );
};

const points = (values: readonly (readonly [number, number])[]) =>
  values.map(([x, y]) => pointFrom<LocalPoint>(x, y));

const transformDirectional = (
  values: readonly (readonly [number, number])[],
  direction: "right" | "left" | "up" | "down",
  width: number,
  height: number,
) => {
  if (direction === "right") {
    return values;
  }
  if (direction === "left") {
    return values.map(([x, y]) => [width - x, y] as const);
  }
  const sourceWidth = height;
  const sourceHeight = width;
  const vertical = values.map(([x, y]) => [
    (x / width) * sourceWidth,
    (y / height) * sourceHeight,
  ]);
  return direction === "up"
    ? vertical.map(([x, y]) => [y, height - x] as const)
    : vertical.map(([x, y]) => [width - y, x] as const);
};

const arrowPoints = (
  id: SmartShapeId,
  width: number,
  height: number,
  parameters: Record<string, number>,
) => {
  const direction = id.slice("arrow-".length) as
    | "right"
    | "left"
    | "up"
    | "down";
  const shaft = readParameter(id, parameters, "shaftRatio") * height;
  const headStart =
    width * (1 - readParameter(id, parameters, "headLengthRatio"));
  const center = height / 2;
  return points(
    transformDirectional(
      [
        [0, center - shaft / 2],
        [headStart, center - shaft / 2],
        [headStart, 0],
        [width, center],
        [headStart, height],
        [headStart, center + shaft / 2],
        [0, center + shaft / 2],
        [0, center - shaft / 2],
      ],
      direction,
      width,
      height,
    ),
  );
};

const chevronPoints = (
  id: SmartShapeId,
  width: number,
  height: number,
  parameters: Record<string, number>,
) => {
  const direction = id.slice("chevron-".length) as
    | "right"
    | "left"
    | "up"
    | "down";
  const thickness = readParameter(id, parameters, "thicknessRatio");
  return points(
    transformDirectional(
      [
        [0, 0],
        [width * thickness, 0],
        [width, height / 2],
        [width * thickness, height],
        [0, height],
        [width * (1 - thickness), height / 2],
        [0, 0],
      ],
      direction,
      width,
      height,
    ),
  );
};

const scaleTemplate = (
  template: readonly (readonly [number, number])[],
  width: number,
  height: number,
  mirror = false,
) =>
  points(template.map(([x, y]) => [(mirror ? 1 - x : x) * width, y * height]));

// ---------------------------------------------------------------------------
// The arrows along a centre line (YAZ-4356).
//
// A builder returns the closed outline AND one point per handle, both in the
// box (0..width, 0..height). A shape must FILL its box at every parameter
// value: a handle drag writes the points through `mutateElement`, which sets
// `width` and `height` from them, and the next drag builds in that box again.
// So a curved outline is drawn in its own units and then stretched to the box
// (`fitToBox`). A handle drag needs no code per shape: it looks for the value
// whose handle point is nearest the pointer (`solveHandle`).
// ---------------------------------------------------------------------------

type Vec = readonly [number, number];
type AnchoredShape = {
  outline: Vec[];
  anchors: Partial<Record<SmartShapeHandleName, Vec>>;
};
type AnchoredBuilder = (
  width: number,
  height: number,
  read: (parameter: SmartShapeParameterName) => number,
) => AnchoredShape;

/** The steps along each curved stretch of a centre line. */
const CURVE_STEPS = 24;
/** The head is twice as wide as the shaft, as on the filled arrows' defaults. */
const HEAD_WIDTH_PER_THICKNESS = 2;
/** A head's length per shaft width, where no handle sets it (U-turn, circle). */
const HEAD_LENGTH_PER_THICKNESS = 1.6;

/** `steps` + 1 points on a circle; angles in radians, a positive sweep turns clockwise on screen. */
const arcPoints = (
  cx: number,
  cy: number,
  radius: number,
  start: number,
  sweep: number,
): Vec[] =>
  Array.from({ length: CURVE_STEPS + 1 }, (_, index) => {
    const angle = start + (sweep * index) / CURVE_STEPS;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });

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

/**
 * Curved arrow: an arc that starts upward at the bottom left and turns clockwise by
 * `bendRatio` × 180°, from 90° (the tip points right, at the top) to 225° (the tip
 * curls back under). Bend sits on the tip, head on the head's base.
 */
const curvedArrow: AnchoredBuilder = (width, height, read) => {
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

/**
 * U-turn arrow: up the left leg, over a half circle, down the right leg to the head.
 * The legs are 1 long; `gapRatio` is the space between them. Gap sits on the right
 * leg's inner edge, thickness on the left leg's.
 */
const uTurnArrow: AnchoredBuilder = (width, height, read) => {
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

/**
 * Double arrow: a straight shaft with a head at each end, drawn in the box as the
 * filled arrows are. One `head` handle sets both heads.
 */
const doubleArrow: AnchoredBuilder = (width, height, read) => {
  const shaft = read("thicknessRatio") * height;
  const head = read("headLengthRatio") * width;
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

/**
 * Circle arrow: a ring that runs clockwise from the top, with an opening of
 * `openingRatio` × 360° at the top and the head at its end. Opening sits on the tip.
 */
const circleArrow: AnchoredBuilder = (width, height, read) => {
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

/** A new shape of this family is one definition entry and one builder here. */
const ANCHORED_BUILDERS: Partial<Record<SmartShapeKind, AnchoredBuilder>> = {
  "curved-arrow": curvedArrow,
  "u-turn-arrow": uTurnArrow,
  "double-arrow": doubleArrow,
  "circle-arrow": circleArrow,
};

const buildAnchored = (
  id: SmartShapeId,
  width: number,
  height: number,
  parameters: Record<string, number>,
): AnchoredShape | null => {
  const kind = DEFINITIONS_BY_ID.get(id)?.kind;
  const builder = kind ? ANCHORED_BUILDERS[kind] : undefined;
  return builder
    ? builder(width, height, (parameter) =>
        readParameter(id, parameters, parameter),
      )
    : null;
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
const SOLVE_SAMPLES = 24;
const SOLVE_REFINEMENTS = 10;

/**
 * The value of the handle's parameter whose handle point is nearest `target`
 * (element frame). A drag keeps the first point where it is (`App` writes only
 * the points), so the handle points are compared in that frame too.
 */
const solveHandle = (
  id: SmartShapeId,
  width: number,
  height: number,
  parameters: Record<string, number>,
  handle: SmartShapeHandleName,
  target: Vec,
) => {
  const parameter = SMART_SHAPE_HANDLE_PARAMETERS[handle];
  const limits = DEFINITIONS_BY_ID.get(id)?.limits[parameter];
  if (!limits) {
    return null;
  }
  const [min, max] = limits;
  const distanceAt = (value: number) => {
    const shape = buildAnchored(id, width, height, {
      ...parameters,
      [parameter]: value,
    });
    const point = shape
      ? anchoredHandlePoints(shape, [handle])[0]?.point
      : undefined;
    return point
      ? Math.hypot(point[0] - target[0], point[1] - target[1])
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
): LocalPoint[] => {
  let generated: LocalPoint[];
  const anchored = buildAnchored(id, width, height, parameters);
  if (anchored) {
    generated = points(anchored.outline);
  } else if (id.startsWith("arrow-")) {
    generated = arrowPoints(id, width, height, parameters);
  } else if (id.startsWith("chevron-")) {
    generated = chevronPoints(id, width, height, parameters);
  } else if (id.startsWith("brace-")) {
    generated = scaleTemplate(
      [
        [1, 0],
        [0.5, 0],
        [0.5, 0.4],
        [0, 0.5],
        [0.5, 0.6],
        [0.5, 1],
        [1, 1],
      ],
      width,
      height,
      id === "brace-right",
    );
  } else if (id.startsWith("bracket-")) {
    generated = scaleTemplate(
      [
        [1, 0],
        [0, 0],
        [0, 1],
        [1, 1],
      ],
      width,
      height,
      id === "bracket-right",
    );
  } else if (id.startsWith("parenthesis-")) {
    generated = scaleTemplate(
      [
        [1, 0],
        [0, 0.5],
        [1, 1],
      ],
      width,
      height,
      id === "parenthesis-right",
    );
  } else {
    const bodyBottom = height * 0.76;
    const anchor = readParameter(id, parameters, "tailPositionRatio") * width;
    const halfTail = width * 0.09;
    generated = points([
      [0, 0],
      [width, 0],
      [width, bodyBottom],
      [anchor + halfTail, bodyBottom],
      [anchor, height],
      [anchor - halfTail, bodyBottom],
      [0, bodyBottom],
      [0, 0],
    ]);
  }
  const [originX, originY] = generated[0];
  return generated.map(([x, y]) =>
    pointFrom<LocalPoint>(x - originX, y - originY),
  );
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
  const parameters = { ...metadata.parameters, [parameter]: value };
  const nextPoints = generateSmartShapePoints(
    metadata.id,
    element.width,
    element.height,
    parameters,
  );
  const oldMinX = Math.min(...element.points.map(([x]) => x));
  const oldMinY = Math.min(...element.points.map(([, y]) => y));
  const nextMinX = Math.min(...nextPoints.map(([x]) => x));
  const nextMinY = Math.min(...nextPoints.map(([, y]) => y));
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

const midpoint = (a: LocalPoint, b: LocalPoint) =>
  pointFrom<LocalPoint>((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);

export const getSmartShapeHandles = (
  element: ExcalidrawLinearElement,
): SmartShapeHandle[] => {
  const metadata = getSmartShapeMetadata(element);
  const definition = metadata
    ? getSmartShapeDefinition(metadata.id)
    : undefined;
  if (!metadata || !definition || element.locked) {
    return [];
  }
  const generated = generateSmartShapePoints(
    metadata.id,
    element.width,
    element.height,
    metadata.parameters,
  );
  const localHandles: Array<{
    name: SmartShapeHandleName;
    point: LocalPoint;
  }> = [];

  const anchored = buildAnchored(
    metadata.id,
    element.width,
    element.height,
    metadata.parameters,
  );
  if (anchored) {
    localHandles.push(...anchoredHandlePoints(anchored, definition.handles));
  } else if (definition.kind === "filled-arrow") {
    localHandles.push(
      { name: "shaft", point: midpoint(generated[0], generated[1]) },
      { name: "head", point: midpoint(generated[2], generated[4]) },
    );
  } else if (definition.kind === "chevron") {
    localHandles.push({ name: "thickness", point: generated[1] });
  } else if (definition.kind === "callout") {
    localHandles.push({ name: "tail", point: generated[4] });
  }

  const minX = Math.min(...generated.map(([x]) => x));
  const maxX = Math.max(...generated.map(([x]) => x));
  const minY = Math.min(...generated.map(([, y]) => y));
  const maxY = Math.max(...generated.map(([, y]) => y));
  const center = pointFrom<GlobalPoint>(
    element.x + (minX + maxX) / 2,
    element.y + (minY + maxY) / 2,
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

export const hitTestSmartShapeHandle = (
  element: ExcalidrawLinearElement,
  scenePoint: GlobalPoint,
  zoom: { value: number },
): SmartShapeHandleName | null =>
  getSmartShapeHandles(element).find(
    ({ scenePoint: handlePoint }) =>
      pointDistance(handlePoint, scenePoint) <= 9 / zoom.value,
  )?.name ?? null;

export const updateSmartShapeFromHandle = (
  element: ExcalidrawLinearElement,
  handle: SmartShapeHandleName,
  scenePoint: GlobalPoint,
) => {
  const metadata = getSmartShapeMetadata(element);
  if (!metadata) {
    return element;
  }
  const generated = generateSmartShapePoints(
    metadata.id,
    element.width,
    element.height,
    metadata.parameters,
  );
  const minX = Math.min(...generated.map(([x]) => x));
  const maxX = Math.max(...generated.map(([x]) => x));
  const minY = Math.min(...generated.map(([, y]) => y));
  const maxY = Math.max(...generated.map(([, y]) => y));
  const center = pointFrom<GlobalPoint>(
    element.x + (minX + maxX) / 2,
    element.y + (minY + maxY) / 2,
  );
  const unrotated = pointRotateRads(
    scenePoint,
    center,
    -element.angle as Radians,
  );
  const localX = unrotated[0] - element.x;
  const localY = unrotated[1] - element.y;

  if (ANCHORED_BUILDERS[metadata.kind]) {
    const value = solveHandle(
      metadata.id,
      element.width,
      element.height,
      metadata.parameters,
      handle,
      [localX, localY],
    );
    return value === null
      ? element
      : updateSmartShapeParameter(
          element,
          SMART_SHAPE_HANDLE_PARAMETERS[handle],
          value,
        );
  }

  const shapeX = localX - minX;
  const shapeY = localY - minY;
  const horizontal =
    metadata.id.endsWith("-right") || metadata.id.endsWith("-left");
  const update = (parameter: SmartShapeParameterName, ratio: number) =>
    updateSmartShapeParameter(
      element,
      parameter,
      clampParameter(metadata.id, parameter, ratio),
    );

  if (handle === "shaft") {
    return update(
      "shaftRatio",
      horizontal
        ? (Math.abs(shapeY - element.height / 2) * 2) / element.height
        : (Math.abs(shapeX - element.width / 2) * 2) / element.width,
    );
  }
  if (handle === "head") {
    return update(
      "headLengthRatio",
      metadata.id.endsWith("-right")
        ? (element.width - shapeX) / element.width
        : metadata.id.endsWith("-left")
        ? shapeX / element.width
        : metadata.id.endsWith("-up")
        ? shapeY / element.height
        : (element.height - shapeY) / element.height,
    );
  }
  if (handle === "thickness") {
    return update(
      "thicknessRatio",
      Math.abs(horizontal ? shapeX / element.width : shapeY / element.height),
    );
  }
  return update("tailPositionRatio", shapeX / element.width);
};
