import React from "react";

import {
  CURSOR_TYPE,
  reseed,
  sceneCoordsToViewportCoords,
} from "@excalidraw/common";
import {
  pointFrom,
  pointRotateRads,
  type GlobalPoint,
  type LocalPoint,
  type Radians,
} from "@excalidraw/math";

import { Excalidraw } from "../index";
import { getNormalizedZoom } from "../scene";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import {
  assertSelectedElements,
  GlobalTestState,
  render,
  unmountComponent,
} from "./test-utils";

unmountComponent();

const mouse = new Pointer("mouse");
const touch = new Pointer("touch", 2);
const pen = new Pointer("pen", 3);

describe("transparent closed-shape selection", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    Pointer.resetAll();
    await render(<Excalidraw />);
  });

  it("selects a transparent rectangle from its interior", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 100,
      height: 80,
      backgroundColor: "transparent",
      strokeColor: "#1b1b1f",
    });
    API.setElements([rectangle]);

    mouse.clickAt(70, 60);

    assertSelectedElements([rectangle.id]);
  });

  it("selects other transparent closed fillable shapes from their interiors", () => {
    const ellipse = API.createElement({
      type: "ellipse",
      x: 20,
      y: 20,
      width: 100,
      height: 80,
      backgroundColor: "transparent",
      strokeColor: "#1b1b1f",
    });
    const diamond = API.createElement({
      type: "diamond",
      x: 160,
      y: 20,
      width: 100,
      height: 80,
      backgroundColor: "transparent",
      strokeColor: "#1b1b1f",
    });
    const polygon = API.createElement({
      type: "line",
      x: 300,
      y: 20,
      backgroundColor: "transparent",
      strokeColor: "#1b1b1f",
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(100, 0),
        pointFrom<LocalPoint>(100, 80),
        pointFrom<LocalPoint>(0, 80),
        pointFrom<LocalPoint>(0, 0),
      ],
    });
    const freeDrawLoop = API.createElement({
      type: "freedraw",
      x: 440,
      y: 20,
      backgroundColor: "transparent",
      strokeColor: "#1b1b1f",
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(100, 0),
        pointFrom<LocalPoint>(100, 80),
        pointFrom<LocalPoint>(0, 80),
        pointFrom<LocalPoint>(0, 0),
      ],
    });
    API.setElements([ellipse, diamond, polygon, freeDrawLoop]);

    for (const [element, x] of [
      [ellipse, 70],
      [diamond, 210],
      [polygon, 350],
      [freeDrawLoop, 490],
    ] as const) {
      mouse.clickAt(x, 60);
      assertSelectedElements([element.id]);
    }
  });

  it("uses precise rotated geometry instead of axis-aligned bounds", () => {
    const angle = (Math.PI / 4) as Radians;
    const rectangle = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 100,
      height: 80,
      angle,
      backgroundColor: "transparent",
    });
    const ellipse = API.createElement({
      type: "ellipse",
      x: 180,
      y: 20,
      width: 100,
      height: 80,
      angle,
      backgroundColor: "transparent",
    });
    const diamond = API.createElement({
      type: "diamond",
      x: 340,
      y: 20,
      width: 100,
      height: 80,
      angle,
      backgroundColor: "transparent",
    });
    API.setElements([rectangle, ellipse, diamond]);

    mouse.clickAt(70, 60);
    assertSelectedElements([rectangle.id]);

    API.clearSelection();
    const ellipseCorner = pointRotateRads<GlobalPoint>(
      pointFrom<GlobalPoint>(185, 25),
      pointFrom<GlobalPoint>(230, 60),
      angle,
    );
    mouse.clickAt(ellipseCorner[0], ellipseCorner[1]);
    assertSelectedElements([]);

    const diamondCorner = pointRotateRads<GlobalPoint>(
      pointFrom<GlobalPoint>(345, 25),
      pointFrom<GlobalPoint>(390, 60),
      angle,
    );
    mouse.clickAt(diamondCorner[0], diamondCorner[1]);
    assertSelectedElements([]);
  });

  it("does not create a phantom interior target from invisible bound content", () => {
    const underlying = API.createElement({
      type: "rectangle",
      id: "invisible-underlying",
      x: 20,
      y: 20,
      width: 100,
      height: 80,
      backgroundColor: "#a5d8ff",
    });
    const invisibleContainer = API.createElement({
      type: "rectangle",
      id: "invisible-container",
      x: 20,
      y: 20,
      width: 100,
      height: 80,
      backgroundColor: "transparent",
      strokeColor: "transparent",
      boundElements: [{ id: "invisible-label", type: "text" }],
    });
    const invisibleLabel = API.createElement({
      type: "text",
      id: "invisible-label",
      x: 45,
      y: 45,
      width: 50,
      height: 20,
      text: "hidden",
      containerId: invisibleContainer.id,
      strokeColor: "transparent",
      opacity: 0,
    });
    API.setElements([underlying, invisibleContainer, invisibleLabel]);

    mouse.clickAt(30, 30);

    assertSelectedElements([underlying.id]);
  });

  it("passes through an opacity-zero transparent shape", () => {
    const underlying = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 100,
      height: 80,
      backgroundColor: "#a5d8ff",
    });
    const opacityZero = API.createElement({
      type: "ellipse",
      id: "opacity-zero",
      x: 20,
      y: 20,
      width: 100,
      height: 80,
      backgroundColor: "transparent",
      strokeColor: "#1b1b1f",
      opacity: 0,
    });
    API.setElements([underlying, opacityZero]);

    mouse.clickAt(70, 60);

    assertSelectedElements([underlying.id]);
  });

  it("allows visible bound text to expose its transparent container interior", () => {
    const container = API.createElement({
      type: "rectangle",
      id: "visible-container",
      x: 20,
      y: 20,
      width: 140,
      height: 100,
      backgroundColor: "transparent",
      strokeColor: "transparent",
      boundElements: [{ id: "visible-label", type: "text" }],
    });
    const label = API.createElement({
      type: "text",
      id: "visible-label",
      x: 65,
      y: 60,
      width: 50,
      height: 20,
      text: "Label",
      containerId: container.id,
      strokeColor: "#1b1b1f",
    });
    API.setElements([container, label]);

    mouse.clickAt(35, 35);

    assertSelectedElements([container.id]);
  });

  it("keeps open lines, arrows, and free-draw strokes outline-only", () => {
    const openPoints = [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(100, 0),
      pointFrom<LocalPoint>(100, 80),
      pointFrom<LocalPoint>(0, 80),
    ];
    const line = API.createElement({
      type: "line",
      x: 20,
      y: 20,
      points: openPoints,
      backgroundColor: "transparent",
    });
    const arrow = API.createElement({
      type: "arrow",
      x: 160,
      y: 20,
      points: openPoints,
      backgroundColor: "transparent",
    });
    const freeDraw = API.createElement({
      type: "freedraw",
      x: 300,
      y: 20,
      points: openPoints,
      backgroundColor: "transparent",
    });
    API.setElements([line, arrow, freeDraw]);

    for (const x of [70, 210, 350]) {
      mouse.clickAt(x, 60);
      assertSelectedElements([]);
    }
  });

  it("keeps frame interiors pass-through while selecting a transparent child", () => {
    const frame = API.createElement({
      type: "frame",
      x: 20,
      y: 20,
      width: 180,
      height: 120,
    });
    const child = API.createElement({
      type: "rectangle",
      x: 40,
      y: 40,
      width: 80,
      height: 60,
      frameId: frame.id,
      backgroundColor: "transparent",
    });
    API.setElements([frame, child]);

    mouse.clickAt(80, 70);
    assertSelectedElements([child.id]);

    mouse.clickAt(170, 110);
    assertSelectedElements([]);
  });

  it("does not select a transparent frame child through its clipped-away area", () => {
    const frame = API.createElement({
      type: "frame",
      x: 20,
      y: 20,
      width: 100,
      height: 100,
    });
    const child = API.createElement({
      type: "rectangle",
      x: 80,
      y: 40,
      width: 100,
      height: 60,
      frameId: frame.id,
      backgroundColor: "transparent",
    });
    API.setElements([frame, child]);

    mouse.clickAt(150, 70);

    assertSelectedElements([]);
  });

  it("preserves topmost ordering and group-deep Ctrl selection", () => {
    const underlying = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 120,
      height: 90,
      backgroundColor: "#a5d8ff",
    });
    const top = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 120,
      height: 90,
      backgroundColor: "transparent",
      groupIds: ["top-group"],
    });
    const groupMate = API.createElement({
      type: "rectangle",
      x: 180,
      y: 20,
      width: 80,
      height: 60,
      groupIds: ["top-group"],
    });
    API.setElements([underlying, top, groupMate]);

    mouse.clickAt(80, 65);
    assertSelectedElements([top, groupMate]);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      mouse.clickAt(80, 65);
    });
    assertSelectedElements([top]);
  });

  it("selects and drags from the transparent interior in one gesture", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 100,
      height: 80,
      backgroundColor: "transparent",
    });
    API.setElements([rectangle]);

    mouse.downAt(70, 60);
    mouse.moveTo(100, 90);
    mouse.up();

    const movedRectangle = API.getElement(rectangle);
    expect(movedRectangle.x).toBe(50);
    expect(movedRectangle.y).toBe(50);
    assertSelectedElements([rectangle.id]);
  });

  it.each([
    ["touch", touch],
    ["pen", pen],
  ])(
    "selects from the transparent interior with %s input",
    (_name, pointer) => {
      const rectangle = API.createElement({
        type: "rectangle",
        x: 20,
        y: 20,
        width: 100,
        height: 80,
        backgroundColor: "transparent",
      });
      API.setElements([rectangle]);

      pointer.clickAt(70, 60);

      assertSelectedElements([rectangle.id]);
    },
  );

  it("uses the transparent interior for hover and context selection", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 100,
      height: 80,
      backgroundColor: "transparent",
    });
    API.setElements([rectangle]);

    mouse.moveTo(70, 60);
    expect(GlobalTestState.interactiveCanvas.style.cursor).toBe(
      CURSOR_TYPE.MOVE,
    );

    mouse.rightClickAt(70, 60);
    expect(UI.queryContextMenu()).not.toBeNull();
    assertSelectedElements([rectangle.id]);
  });

  it.each([0.25, 1, 4])(
    "selects the transparent interior at %s× zoom",
    (zoomValue) => {
      const rectangle = API.createElement({
        type: "rectangle",
        x: 20,
        y: 20,
        width: 100,
        height: 80,
        backgroundColor: "transparent",
      });
      API.setElements([rectangle]);
      API.setAppState({
        zoom: { value: getNormalizedZoom(zoomValue) },
      });
      const viewportPoint = sceneCoordsToViewportCoords(
        { sceneX: 70, sceneY: 60 },
        window.h.state,
      );

      mouse.clickAt(viewportPoint.x, viewportPoint.y);

      assertSelectedElements([rectangle.id]);
    },
  );
});
