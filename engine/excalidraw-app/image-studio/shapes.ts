import { pointFrom } from "@excalidraw/math";

import {
  SMART_SHAPE_DEFINITIONS,
  createSmartShapeMetadata,
  generateSmartShapePoints,
} from "@excalidraw/element";

import type {
  ExcalidrawElementSkeleton,
  SmartShapeDefinition,
} from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";

export type ShapeCatalogItem = {
  id: string;
  title: string;
  preview: string;
  kind: string;
  direction?: "right" | "left" | "up" | "down";
  aliases: readonly string[];
  create: (x: number, y: number) => ExcalidrawElementSkeleton[];
};

const common = {
  strokeColor: "#1b1b1f",
  backgroundColor: "transparent",
  fillStyle: "solid" as const,
  strokeWidth: 2 as const,
  roughness: 1 as const,
};

const box = (
  type: "rectangle" | "ellipse" | "diamond",
  x: number,
  y: number,
): ExcalidrawElementSkeleton[] => [
  { type, x: x - 80, y: y - 55, width: 160, height: 110, ...common },
];

const polygon = (
  x: number,
  y: number,
  points: readonly (readonly [number, number])[],
): ExcalidrawElementSkeleton[] => [
  {
    type: "line",
    x: x - 80,
    y: y - 70,
    width: 160,
    height: 140,
    points: points.map(([pointX, pointY]) =>
      pointFrom<LocalPoint>(pointX, pointY),
    ),
    ...common,
  },
];

export const SHAPE_CATALOG: ShapeCatalogItem[] = [
  {
    id: "rectangle",
    title: "Rectangle",
    preview: "rectangle",
    kind: "basic",
    aliases: ["box", "square"],
    create: (x, y) => box("rectangle", x, y),
  },
  {
    id: "rounded-rectangle",
    title: "Rounded rectangle",
    preview: "rectangle",
    kind: "basic",
    aliases: ["rounded box"],
    create: (x, y) => [
      {
        ...box("rectangle", x, y)[0],
        roundness: { type: 3 },
      } as ExcalidrawElementSkeleton,
    ],
  },
  {
    id: "circle",
    title: "Circle",
    preview: "ellipse",
    kind: "basic",
    aliases: ["ellipse", "oval"],
    create: (x, y) => box("ellipse", x, y),
  },
  {
    id: "diamond",
    title: "Diamond",
    preview: "diamond",
    kind: "basic",
    aliases: ["rhombus", "decision"],
    create: (x, y) => box("diamond", x, y),
  },
  {
    id: "triangle",
    title: "Triangle",
    preview: "triangle",
    kind: "polygon",
    aliases: ["three sided"],
    create: (x, y) =>
      polygon(x, y, [
        [80, 0],
        [160, 140],
        [0, 140],
        [80, 0],
      ]),
  },
  {
    id: "hexagon",
    title: "Hexagon",
    preview: "hexagon",
    kind: "polygon",
    aliases: ["six sided"],
    create: (x, y) =>
      polygon(x, y, [
        [40, 0],
        [120, 0],
        [160, 70],
        [120, 140],
        [40, 140],
        [0, 70],
        [40, 0],
      ]),
  },
  {
    id: "star",
    title: "Star",
    preview: "star",
    kind: "polygon",
    aliases: ["favorite"],
    create: (x, y) =>
      polygon(x, y, [
        [80, 0],
        [99, 52],
        [156, 54],
        [111, 88],
        [127, 140],
        [80, 109],
        [33, 140],
        [49, 88],
        [4, 54],
        [61, 52],
        [80, 0],
      ]),
  },
  ...SMART_SHAPE_DEFINITIONS.map(
    (smartShape): ShapeCatalogItem => ({
      id: `smart:${smartShape.id}`,
      title: smartShape.title,
      preview: `smart:${smartShape.id}`,
      kind: smartShape.kind,
      direction: getDirection(smartShape.id),
      aliases: getSmartShapeAliases(smartShape),
      create: (x, y) => createSmartShapeSkeleton(smartShape, x, y),
    }),
  ),
];

function getDirection(id: string): ShapeCatalogItem["direction"] {
  const direction = id.match(/-(right|left|up|down)$/)?.[1];
  return direction === "right" ||
    direction === "left" ||
    direction === "up" ||
    direction === "down"
    ? direction
    : undefined;
}

function getSmartShapeAliases(
  smartShape: SmartShapeDefinition,
): readonly string[] {
  switch (smartShape.kind) {
    case "filled-arrow":
      return ["arrow", "pointer", "filled"];
    case "chevron":
      return ["arrowhead", "direction"];
    case "brace":
      return ["curly", "curly bracket"];
    case "bracket":
      return ["square bracket"];
    case "parenthesis":
      return ["paren", "round bracket"];
    case "callout":
      return ["speech", "annotation", "label"];
  }
}

export const filterShapeCatalog = (query: string) => {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return SHAPE_CATALOG;
  }
  return SHAPE_CATALOG.filter((shape) => {
    const searchable = [
      shape.title,
      shape.id,
      shape.kind,
      shape.direction,
      ...shape.aliases,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return tokens.every((token) => searchable.includes(token));
  });
};

export const getSmartShapePreview = (kind: string) => {
  if (!kind.startsWith("smart:")) {
    return null;
  }
  const id = kind.slice("smart:".length);
  const definition = SMART_SHAPE_DEFINITIONS.find((shape) => shape.id === id);
  if (!definition) {
    return null;
  }
  const points = generateSmartShapePoints(
    definition.id,
    definition.width,
    definition.height,
    definition.defaults,
  );
  const xValues = points.map(([x]) => x);
  const yValues = points.map(([, y]) => y);
  const minX = Math.min(...xValues);
  const minY = Math.min(...yValues);
  const maxX = Math.max(...xValues);
  const maxY = Math.max(...yValues);
  const padding = Math.max(maxX - minX, maxY - minY) * 0.08;

  return {
    closed: definition.closed,
    points: points.map(([x, y]) => `${x},${y}`).join(" "),
    viewBox: `${minX - padding} ${minY - padding} ${
      maxX - minX + padding * 2
    } ${maxY - minY + padding * 2}`,
  };
};

const createSmartShapeSkeleton = (
  smartShape: SmartShapeDefinition,
  x: number,
  y: number,
): ExcalidrawElementSkeleton[] => [
  {
    type: "line",
    x: x - smartShape.width / 2,
    y: y - smartShape.height / 2,
    width: smartShape.width,
    height: smartShape.height,
    points: generateSmartShapePoints(
      smartShape.id,
      smartShape.width,
      smartShape.height,
      smartShape.defaults,
    ),
    strokeColor: "#1b1b1f",
    backgroundColor: smartShape.closed ? "#1b1b1f" : "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    roughness: 1,
    roundness: smartShape.roundness,
    customData: {
      yasinSmartShape: createSmartShapeMetadata(smartShape.id),
    },
  },
];

export const getShape = (id: string) =>
  SHAPE_CATALOG.find((shape) => shape.id === id);
