import React from "react";
import { vi } from "vitest";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { getCommonBounds, isArrowElement } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, render, waitFor } from "./test-utils";

const { h } = window;

describe("ExcalidrawImperativeAPI.insertElements", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  it("creates fresh ids while preserving bindings and selects one inserted copy", async () => {
    const rectangle = API.createElement({
      id: "template-rectangle",
      type: "rectangle",
      boundElements: [
        { type: "text", id: "template-text" },
        { type: "arrow", id: "template-arrow" },
      ],
    });
    const text = API.createElement({
      id: "template-text",
      type: "text",
      text: "Component",
      containerId: rectangle.id,
    });
    const arrow = API.createElement({
      id: "template-arrow",
      type: "arrow",
      endBinding: {
        elementId: rectangle.id,
        fixedPoint: [0.5, 1],
        mode: "orbit",
      },
    });

    act(() => h.app.api.insertElements([rectangle, text, arrow]));

    await waitFor(() => expect(h.elements).toHaveLength(3));
    const insertedRectangle = h.elements.find(
      (element) => element.type === "rectangle",
    )!;
    const insertedText = h.elements.find((element) => element.type === "text")!;
    const insertedArrow = h.elements.find(isArrowElement)!;

    expect(insertedRectangle.id).not.toBe(rectangle.id);
    expect(insertedText.id).not.toBe(text.id);
    expect(insertedArrow.id).not.toBe(arrow.id);
    expect(insertedRectangle.boundElements).toEqual(
      expect.arrayContaining([
        { type: "text", id: insertedText.id },
        { type: "arrow", id: insertedArrow.id },
      ]),
    );
    expect(insertedText.containerId).toBe(insertedRectangle.id);
    expect(insertedArrow.endBinding?.elementId).toBe(insertedRectangle.id);
    expect(h.state.selectedElementIds).toMatchObject({
      [insertedRectangle.id]: true,
      [insertedArrow.id]: true,
    });

    act(() => h.app.api.insertElements([rectangle, text, arrow]));
    await waitFor(() => expect(h.elements).toHaveLength(6));
    expect(new Set(h.elements.map((element) => element.id)).size).toBe(6);
  });

  it("centers the inserted group in the measured usable viewport", async () => {
    API.setAppState({ width: 1000, height: 800 });
    vi.spyOn(h.app.viewport, "getOffsets").mockReturnValue({
      left: 280,
      right: 20,
      top: 100,
      bottom: 40,
    });
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    });

    act(() => h.app.api.insertElements([rectangle]));
    await waitFor(() => expect(h.elements).toHaveLength(1));

    const [minX, minY, maxX, maxY] = getCommonBounds(h.elements);
    const viewportCenter = sceneCoordsToViewportCoords(
      {
        sceneX: (minX + maxX) / 2,
        sceneY: (minY + maxY) / 2,
      },
      h.state,
    );
    expect(viewportCenter.x).toBeCloseTo(
      h.state.offsetLeft + 280 + (h.state.width - 280 - 20) / 2,
      0,
    );
    expect(viewportCenter.y).toBeCloseTo(
      h.state.offsetTop + 100 + (h.state.height - 100 - 40) / 2,
      0,
    );
  });

  it("remaps frame membership and shared group ids", async () => {
    const frame = API.createElement({
      id: "template-frame",
      type: "frame",
      width: 400,
      height: 300,
    });
    const first = API.createElement({
      id: "template-first",
      type: "rectangle",
      frameId: frame.id,
      groupIds: ["template-group"],
    });
    const second = API.createElement({
      id: "template-second",
      type: "ellipse",
      x: 140,
      frameId: frame.id,
      groupIds: ["template-group"],
    });

    act(() => h.app.api.insertElements([frame, first, second]));
    await waitFor(() => expect(h.elements).toHaveLength(3));

    const insertedFrame = h.elements.find(
      (element) => element.type === "frame",
    )!;
    const insertedFirst = h.elements.find(
      (element) => element.type === "rectangle",
    )!;
    const insertedSecond = h.elements.find(
      (element) => element.type === "ellipse",
    )!;
    expect(insertedFirst.frameId).toBe(insertedFrame.id);
    expect(insertedSecond.frameId).toBe(insertedFrame.id);
    expect(insertedFirst.groupIds).toHaveLength(1);
    expect(insertedFirst.groupIds).toEqual(insertedSecond.groupIds);
    expect(insertedFirst.groupIds).not.toContain("template-group");
  });

  it("undoes and redoes the complete insertion as one action", async () => {
    const elements = [
      API.createElement({ type: "rectangle" }),
      API.createElement({ type: "ellipse", x: 160 }),
    ];

    act(() => h.app.api.insertElements(elements));
    await waitFor(() => expect(h.elements).toHaveLength(2));
    await waitFor(() => expect(API.getUndoStack()).toHaveLength(1));

    Keyboard.undo();
    await waitFor(() =>
      expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(
        0,
      ),
    );

    Keyboard.redo();
    await waitFor(() =>
      expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(
        2,
      ),
    );
  });
});
