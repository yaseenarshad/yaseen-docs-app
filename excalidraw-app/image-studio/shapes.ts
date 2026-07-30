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
    create: (x, y) => box("rectangle", x, y),
  },
  {
    id: "rounded-rectangle",
    title: "Rounded rectangle",
    preview: "rectangle",
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
    create: (x, y) => box("ellipse", x, y),
  },
  {
    id: "diamond",
    title: "Diamond",
    preview: "diamond",
    create: (x, y) => box("diamond", x, y),
  },
  {
    id: "triangle",
    title: "Triangle",
    preview: "triangle",
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
      create: (x, y) => createSmartShapeSkeleton(smartShape, x, y),
    }),
  ),
];

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
