import { pointFrom } from "@excalidraw/math";

import { newElementWith } from "./mutateElement";

import type { ExcalidrawElement, ExcalidrawLinearElement } from "./types";
import type { LocalPoint } from "@excalidraw/math";

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
  if (id.startsWith("arrow-")) {
    return arrowPoints(id, width, height, parameters);
  }
  if (id.startsWith("chevron-")) {
    return chevronPoints(id, width, height, parameters);
  }
  if (id.startsWith("brace-")) {
    return scaleTemplate(
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
  }
  if (id.startsWith("bracket-")) {
    return scaleTemplate(
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
  }
  if (id.startsWith("parenthesis-")) {
    return scaleTemplate(
      [
        [1, 0],
        [0, 0.5],
        [1, 1],
      ],
      width,
      height,
      id === "parenthesis-right",
    );
  }
  const bodyBottom = height * 0.76;
  const anchor = clamp(parameters.tailPositionRatio ?? 0.7, 0.2, 0.8) * width;
  const halfTail = width * 0.09;
  return points([
    [0, 0],
    [width, 0],
    [width, bodyBottom],
    [anchor + halfTail, bodyBottom],
    [anchor, height],
    [anchor - halfTail, bodyBottom],
    [0, bodyBottom],
    [0, 0],
  ]);
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
  return newElementWith(element, {
    customData: {
      ...element.customData,
      yasinSmartShape: { ...metadata, parameters },
    },
    points: generateSmartShapePoints(
      metadata.id,
      element.width,
      element.height,
      parameters,
    ),
  });
};
