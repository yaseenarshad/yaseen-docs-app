import { isTransparent } from "@excalidraw/common";

import type { ElementOrToolType } from "@excalidraw/excalidraw/types";

import type { ExcalidrawElement } from "./types";

export const hasBackground = (type: ElementOrToolType) =>
  type === "rectangle" ||
  type === "iframe" ||
  type === "embeddable" ||
  type === "ellipse" ||
  type === "diamond" ||
  type === "line" ||
  type === "freedraw" ||
  type === "autoshape";

export const hasStrokeColor = (type: ElementOrToolType) =>
  type === "rectangle" ||
  type === "ellipse" ||
  type === "diamond" ||
  type === "freedraw" ||
  type === "arrow" ||
  type === "line" ||
  type === "text" ||
  type === "image" ||
  type === "embeddable" ||
  type === "autoshape";

export const hasStrokeWidth = (type: ElementOrToolType) =>
  type === "rectangle" ||
  type === "iframe" ||
  type === "embeddable" ||
  type === "ellipse" ||
  type === "diamond" ||
  type === "freedraw" ||
  type === "arrow" ||
  type === "line" ||
  type === "image" ||
  type === "autoshape";

export const hasVectorStrokeWidth = (type: ElementOrToolType) =>
  hasStrokeWidth(type);

export const hasStrokeStyle = (type: ElementOrToolType) =>
  type === "rectangle" ||
  type === "iframe" ||
  type === "embeddable" ||
  type === "ellipse" ||
  type === "diamond" ||
  type === "arrow" ||
  type === "line" ||
  type === "autoshape";

export const hasFreedrawMode = (type: ElementOrToolType) => type === "freedraw";

export const canChangeRoundness = (type: ElementOrToolType) =>
  type === "rectangle" ||
  type === "iframe" ||
  type === "embeddable" ||
  type === "line" ||
  type === "diamond" ||
  type === "image";

export const canChangeCornerRadius = (type: ElementOrToolType) =>
  type === "rectangle" ||
  type === "iframe" ||
  type === "embeddable" ||
  type === "diamond" ||
  type === "image";

export const canChangeCornerRadiusForElement = (element: ExcalidrawElement) =>
  canChangeCornerRadius(element.type) ||
  (element.type === "text" &&
    element.containerId === null &&
    !isTransparent(element.backgroundColor));

export const toolIsArrow = (type: ElementOrToolType) => type === "arrow";

export const canHaveArrowheads = (type: ElementOrToolType) => type === "arrow";
