import { vi } from "vitest";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  activateOrInsertDocPlacement,
  decodeDocCanvasDragPayload,
  encodeDocCanvasDragPayload,
  findMostRecentDocPlacement,
  getDocDropScenePoint,
  insertDocPlacementAtPoint,
} from "./docCanvasPlacement";
import { createDocEmbeddableElement } from "./docEmbeddableData";

const payload = { docId: "doc-1", title: "Strategy" };

const createApi = (initial: NonDeletedExcalidrawElement[] = []) => {
  let elements = initial;
  const updateScene = vi.fn((update) => {
    if (update.elements) {
      elements = [...update.elements];
    }
  });
  return {
    api: {
      getSceneElements: () => elements,
      updateScene,
      insertElements: vi.fn(),
      setViewport: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI,
    updateScene,
    getElements: () => elements,
  };
};

describe("Doc canvas placement", () => {
  it("round-trips only valid Doc drag payloads", () => {
    expect(
      decodeDocCanvasDragPayload(encodeDocCanvasDragPayload(payload)),
    ).toEqual(payload);
    expect(decodeDocCanvasDragPayload("{}")).toBeNull();
    expect(decodeDocCanvasDragPayload("not-json")).toBeNull();
  });

  it("focuses the last current-Board placement without adding a duplicate", () => {
    const first = createDocEmbeddableElement({ ...payload, x: 0, y: 0 });
    const second = createDocEmbeddableElement({ ...payload, x: 500, y: 0 });
    const { api, updateScene } = createApi([first, second]);

    expect(findMostRecentDocPlacement([first, second], payload.docId)).toBe(
      second,
    );
    expect(activateOrInsertDocPlacement(api, payload)).toEqual({
      action: "focused",
      elementId: second.id,
    });
    expect(api.insertElements).not.toHaveBeenCalled();
    expect(updateScene).toHaveBeenCalledWith({
      appState: { selectedElementIds: { [second.id]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    expect(api.setViewport).toHaveBeenCalledWith({
      target: second.id,
      fit: "contain",
      animation: true,
      offsets: { ui: true },
    });
  });

  it("inserts one centered card when smart activation finds no placement", () => {
    const { api } = createApi();

    expect(activateOrInsertDocPlacement(api, payload)).toEqual({
      action: "inserted",
    });
    expect(api.insertElements).toHaveBeenCalledTimes(1);
    expect(api.insertElements).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "embeddable",
        customData: {
          yaseenDoc: { docId: "doc-1", titleSnapshot: "Strategy" },
        },
      }),
    ]);
  });

  it("maps a zoomed and scrolled drop to scene coordinates and always adds", () => {
    const point = getDocDropScenePoint(
      { clientX: 510, clientY: 420 },
      {
        zoom: { value: 2 } as never,
        offsetLeft: 10,
        offsetTop: 20,
        scrollX: -100,
        scrollY: 50,
      },
    );
    expect(point).toEqual({ x: 350, y: 150 });

    const { api, updateScene, getElements } = createApi();
    const first = insertDocPlacementAtPoint(api, payload, point);
    const second = insertDocPlacementAtPoint(api, payload, {
      x: point.x + 20,
      y: point.y + 20,
    });

    expect(first.id).not.toBe(second.id);
    expect(getElements()).toHaveLength(2);
    expect(first).toMatchObject({ x: 110, y: -130 });
    expect(second).toMatchObject({ x: 130, y: -110 });
    expect(updateScene).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appState: { selectedElementIds: { [second.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );
  });
});
