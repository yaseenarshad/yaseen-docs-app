import React from "react";

import { distanceToElement, updateBindings } from "@excalidraw/element";

import type { ExcalidrawArrowElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

/**
 * YAZ-5739 (YAZ-5742): below 10% zoom an arrow binds to a box and keeps the
 * binding, as at 100%. "New shapes match the zoom" is on, so the box and the
 * arrow made at 1% have a 600 board px binding gap (6 screen px).
 */

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

/** The arrow's end binding, and how far its end is from the box on screen. */
const endState = () => {
  const [box, arrow] = h.elements as [any, ExcalidrawArrowElement];
  const end = arrow.points[arrow.points.length - 1];
  const distance = distanceToElement(
    box,
    h.app.scene.getNonDeletedElementsMap(),
    [arrow.x + end[0], arrow.y + end[1]] as any,
  );
  return {
    bound: arrow.endBinding?.elementId === box.id,
    screenPx: Number((distance * h.state.zoom.value).toFixed(1)),
  };
};

describe("YAZ-5739 arrows bind to a box below 10% zoom", () => {
  it.each([
    [1, "round"],
    [0.1, "round"],
    [0.05, "round"],
    [0.01, "round"],
    [1, "elbow"],
    [0.1, "elbow"],
    [0.05, "elbow"],
    [0.01, "elbow"],
  ] as const)("at zoom %s, the %s arrow", async (zoom, arrowType) => {
    await render(
      <Excalidraw handleKeyboardGlobally={true} newShapesMatchZoom={true} />,
    );
    API.setAppState({
      zoom: { value: zoom as any },
      currentItemBackgroundColor: "#ffc9c9",
      currentItemArrowType: arrowType,
    });
    const bound = { bound: true, screenPx: 6 };

    // a 60 × 40 screen px box, and an arrow that ends 2 screen px from it
    UI.clickTool("rectangle");
    mouse.reset();
    mouse.downAt(100, 100);
    mouse.moveTo(160, 140);
    mouse.up();
    UI.clickTool("arrow");
    mouse.reset();
    mouse.downAt(300, 120);
    mouse.moveTo(200, 120);
    mouse.moveTo(162, 120);
    mouse.up();
    expect(endState()).toEqual(bound);

    // drag the free start point of the selected arrow
    mouse.reset();
    mouse.downAt(300, 120);
    mouse.moveTo(300, 160);
    mouse.moveTo(300, 200);
    mouse.up();
    expect(endState()).toEqual(bound);

    // the Stats panel and a type change update the bindings of a round arrow
    if (arrowType === "round") {
      updateBindings(h.elements[1] as any, h.app.scene, h.state);
      expect(endState()).toEqual(bound);
    }

    // move the box 20 screen px down: the arrow follows
    Keyboard.keyPress("Escape");
    UI.clickTool("selection");
    mouse.reset();
    mouse.downAt(130, 120);
    mouse.moveTo(130, 130);
    mouse.moveTo(130, 140);
    mouse.up();
    expect(h.elements[0].y * zoom).toBeCloseTo(120);
    expect(endState()).toEqual(bound);
  });
});
