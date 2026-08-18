import {
  CaptureUpdateAction,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import {
  createDocEmbeddableElement,
  getDocPlacementReference,
} from "./docEmbeddableData";

export const DOC_LIBRARY_REORDER_DRAG_TYPE = "application/x-yaseendraw-doc-id";
export const DOC_CANVAS_DRAG_TYPE = "application/x-yaseendraw-doc";

export type DocCanvasDragPayload = {
  docId: string;
  title: string;
};

export const encodeDocCanvasDragPayload = (payload: DocCanvasDragPayload) =>
  JSON.stringify(payload);

export const decodeDocCanvasDragPayload = (
  value: string,
): DocCanvasDragPayload | null => {
  try {
    const candidate = JSON.parse(value) as Partial<DocCanvasDragPayload>;
    return typeof candidate.docId === "string" &&
      candidate.docId.trim() &&
      typeof candidate.title === "string" &&
      candidate.title.trim()
      ? { docId: candidate.docId, title: candidate.title }
      : null;
  } catch {
    return null;
  }
};

export const hasDocCanvasDragType = (types: readonly string[]) =>
  types.includes(DOC_CANVAS_DRAG_TYPE);

export const findMostRecentDocPlacement = (
  elements: readonly NonDeletedExcalidrawElement[],
  docId: string,
) => {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const reference = getDocPlacementReference(elements[index]);
    if (reference?.docId === docId) {
      return elements[index];
    }
  }
  return null;
};

export const activateOrInsertDocPlacement = (
  api: ExcalidrawImperativeAPI,
  payload: DocCanvasDragPayload,
) => {
  const existing = findMostRecentDocPlacement(
    api.getSceneElements(),
    payload.docId,
  );
  if (existing) {
    api.updateScene({
      appState: { selectedElementIds: { [existing.id]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    api.setViewport({
      target: existing.id,
      fit: "contain",
      animation: true,
      offsets: { ui: true },
    });
    return { action: "focused" as const, elementId: existing.id };
  }

  const template = createDocEmbeddableElement({
    ...payload,
    x: 0,
    y: 0,
  });
  api.insertElements([template]);
  return { action: "inserted" as const };
};

export const getDocDropScenePoint = (
  point: { clientX: number; clientY: number },
  appState: Pick<
    AppState,
    "zoom" | "offsetLeft" | "offsetTop" | "scrollX" | "scrollY"
  >,
) => viewportCoordsToSceneCoords(point, appState);

export const insertDocPlacementAtPoint = (
  api: ExcalidrawImperativeAPI,
  payload: DocCanvasDragPayload,
  point: { x: number; y: number },
) => {
  const element = createDocEmbeddableElement({
    ...payload,
    x: point.x - 240,
    y: point.y - 280,
  });
  api.updateScene({
    elements: [...api.getSceneElements(), element],
    appState: { selectedElementIds: { [element.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return element;
};
