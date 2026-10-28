import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { ShapeCatalogItem } from "./shapes";

export const insertShape = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  shape: ShapeCatalogItem,
) => {
  const appState = excalidrawAPI.getAppState();
  const centerX = appState.width / 2 / appState.zoom.value - appState.scrollX;
  const centerY = appState.height / 2 / appState.zoom.value - appState.scrollY;
  const elements = convertToExcalidrawElements(shape.create(centerX, centerY));
  const selectedElementIds = Object.fromEntries(
    elements.map((element) => [element.id, true as const]),
  );
  excalidrawAPI.updateScene({
    elements: [
      ...excalidrawAPI.getSceneElementsIncludingDeleted(),
      ...elements,
    ],
    appState: { selectedElementIds },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return elements;
};
