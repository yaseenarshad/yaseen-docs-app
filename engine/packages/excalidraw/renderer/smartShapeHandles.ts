import { getSmartShapeHandles } from "@excalidraw/element";

import type { ExcalidrawLinearElement } from "@excalidraw/element/types";

import type { Zoom } from "../types";

export const renderSmartShapeHandles = (
  context: CanvasRenderingContext2D,
  element: ExcalidrawLinearElement,
  zoom: Zoom,
) => {
  const radius = 7 / zoom.value;
  context.save();
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#6965db";
  context.lineWidth = 2 / zoom.value;
  for (const { scenePoint } of getSmartShapeHandles(element)) {
    context.beginPath();
    context.arc(scenePoint[0], scenePoint[1], radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
};
