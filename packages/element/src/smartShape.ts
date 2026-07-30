import { pointDistance, pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, LocalPoint, Radians } from "@excalidraw/math";

import { newElementWith } from "./mutateElement";

import type { ExcalidrawElement, ExcalidrawLinearElement } from "./types";

export const SMART_SHAPE_IDS = [
  "arrow-right",
  "arrow-left",
  "arrow-up",
  "arrow-down",
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
  | "chevron"
  | "brace"
  | "bracket"
  | "parenthesis"
  | "callout";
export type SmartShapeHandleName = "shaft" | "head" | "thickness" | "tail";
export type SmartShapeParameterName =
  | "shaftRatio"
  | "headLengthRatio"
  | "thicknessRatio"
  | "tailPositionRatio";

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
    handles: ["shaft", "head"],
  }),
  definition({
    id: "arrow-left",
    title: "Arrow left",
    kind: "filled-arrow",
    closed: true,
    roundness: null,
    defaults: { shaftRatio: 0.5, headLengthRatio: 0.4 },
    handles: ["shaft", "head"],
  }),
  definition({
    id: "arrow-up",
    title: "Arrow up",
    kind: "filled-arrow",
    closed: true,
    roundness: null,
    defaults: { shaftRatio: 0.5, headLengthRatio: 0.4 },
    handles: ["shaft", "head"],
  }),
  definition({
    id: "arrow-down",
    title: "Arrow down",
    kind: "filled-arrow",
    closed: true,
    roundness: null,
    defaults: { shaftRatio: 0.5, headLengthRatio: 0.4 },
    handles: ["shaft", "head"],
  }),
  ...(["right", "left", "up", "down"] as const).map((direction) =>
    definition({
      id: `chevron-${direction}`,
      title: `Chevron ${direction}`,
      kind: "chevron",
      closed: true,
      roundness: null,
      defaults: { thicknessRatio: 0.28 },
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
    handles: ["tail"],
  }),
] as readonly SmartShapeDefinition[];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

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
  const shaft = clamp(parameters.shaftRatio ?? 0.5, 0.1, 0.9) * height;
  const headStart =
    width * (1 - clamp(parameters.headLengthRatio ?? 0.4, 0.15, 0.75));
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
  const thickness = clamp(parameters.thicknessRatio ?? 0.28, 0.12, 0.46);
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

export const getSmartShapeDefinition = (id: SmartShapeId) =>
  SMART_SHAPE_DEFINITIONS.find((item) => item.id === id);

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
  if (id.startsWith("arrow-")) {
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
    const anchor = clamp(parameters.tailPositionRatio ?? 0.7, 0.2, 0.8) * width;
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

  if (definition.kind === "filled-arrow") {
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
  const shapeX = localX - minX;
  const shapeY = localY - minY;
  const horizontal =
    metadata.id.endsWith("-right") || metadata.id.endsWith("-left");

  if (handle === "shaft") {
    const ratio = horizontal
      ? (Math.abs(shapeY - element.height / 2) * 2) / element.height
      : (Math.abs(shapeX - element.width / 2) * 2) / element.width;
    return updateSmartShapeParameter(
      element,
      "shaftRatio",
      clamp(ratio, 0.1, 0.9),
    );
  }
  if (handle === "head") {
    const ratio = metadata.id.endsWith("-right")
      ? (element.width - shapeX) / element.width
      : metadata.id.endsWith("-left")
      ? shapeX / element.width
      : metadata.id.endsWith("-up")
      ? shapeY / element.height
      : (element.height - shapeY) / element.height;
    return updateSmartShapeParameter(
      element,
      "headLengthRatio",
      clamp(ratio, 0.15, 0.75),
    );
  }
  if (handle === "thickness") {
    const ratio = horizontal ? shapeX / element.width : shapeY / element.height;
    return updateSmartShapeParameter(
      element,
      "thicknessRatio",
      clamp(Math.abs(ratio), 0.12, 0.46),
    );
  }
  return updateSmartShapeParameter(
    element,
    "tailPositionRatio",
    clamp(shapeX / element.width, 0.2, 0.8),
  );
};
