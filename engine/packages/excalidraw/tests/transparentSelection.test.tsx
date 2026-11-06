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

import { getFreeTextInteractionCoords } from "@excalidraw/element";

import { getSelectionHoverBox } from "../renderer/interactiveScene";

import type { RenderableElementsMap } from "../scene/types";

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

  // YAZ-4469 D1: a drawn fill behind a transparent box wins in the overlap; the
  // box's own border keeps topmost ordering and group-deep Ctrl selection.
  it("picks a drawn fill behind a transparent box, and the box from its border", () => {
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
    assertSelectedElements([underlying]);

    mouse.clickAt(1, 1);
    mouse.clickAt(80, 20);
    assertSelectedElements([top, groupMate]);

    mouse.clickAt(1, 1);
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      mouse.clickAt(80, 20);
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

// YAZ-4469: what is drawn under the pointer wins over a transparent box's empty
// inside (D1); among empty insides only, the smallest box wins (D2).
describe("drawn elements beat transparent interiors", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    Pointer.resetAll();
    await render(<Excalidraw />);
  });

  const boxOver = (
    extra: Partial<Parameters<typeof API.createElement>[0]> = {},
  ) => {
    const text = API.createElement({
      type: "text",
      id: "text-behind",
      x: 100,
      y: 50,
      width: 80,
      height: 25,
      text: "Lead Magnet",
    });
    const box = API.createElement({
      type: "rectangle",
      id: "box-in-front",
      x: 20,
      y: 20,
      width: 200,
      height: 120,
      backgroundColor: "transparent",
      strokeColor: "#1b1b1f",
      ...extra,
    });
    API.setElements([text, box]);
    // The text's own hit area hugs its measured glyphs: aim at its middle.
    const [, , , , cx, cy] = getFreeTextInteractionCoords(
      API.getElement(text) as typeof text & { type: "text" },
    )!;
    return { text, box, cx, cy };
  };

  it.each([0.5, 1, 3])(
    "selects the text behind a transparent box at %s× zoom",
    (zoomValue) => {
      const { text, cx, cy } = boxOver();
      API.setAppState({ zoom: { value: getNormalizedZoom(zoomValue) } });
      const at = sceneCoordsToViewportCoords(
        { sceneX: cx, sceneY: cy },
        window.h.state,
      );

      mouse.clickAt(at.x, at.y);

      assertSelectedElements([text.id]);
    },
  );

  it("selects the box from its empty inside and from its border", () => {
    const { box } = boxOver();

    mouse.clickAt(180, 110);
    assertSelectedElements([box.id]);

    mouse.clickAt(5, 5);
    mouse.clickAt(20, 80);
    assertSelectedElements([box.id]);
  });

  it("uses the text for the hover cursor and the right-click", () => {
    const { text, cx, cy } = boxOver();

    mouse.moveTo(cx, cy);
    expect(GlobalTestState.interactiveCanvas.style.cursor).toBe(
      CURSOR_TYPE.MOVE,
    );

    mouse.rightClickAt(cx, cy);
    expect(UI.queryContextMenu()).not.toBeNull();
    assertSelectedElements([text.id]);
  });

  it("edits the text behind a transparent box on a double-click", () => {
    const { text, box, cx, cy } = boxOver();

    // A real double-click: the first click selects, then the dblclick.
    mouse.clickAt(cx, cy);
    mouse.doubleClickAt(cx, cy);

    expect(window.h.state.editingTextElement?.id).toBe(text.id);
    expect(API.getElement(box).boundElements ?? []).toEqual([]);
  });

  it("drags a selected box from its text, and a click selects the text", () => {
    const { text, box, cx, cy } = boxOver();
    mouse.clickAt(180, 110);
    assertSelectedElements([box.id]);

    mouse.downAt(cx, cy);
    mouse.moveTo(cx + 30, cy + 30);
    mouse.up();
    expect(API.getElement(box).x).toBe(50);
    assertSelectedElements([box.id]);

    mouse.clickAt(cx, cy);
    assertSelectedElements([text.id]);
  });

  it("outlines what a click would pick, and renders again only when it changes", () => {
    const { text, box, cx, cy } = boxOver();
    const app = window.h.app as unknown as {
      getSelectionHover: () => string | null;
      triggerRender: () => void;
    };
    const renders = vi.spyOn(app, "triggerRender");

    mouse.moveTo(cx, cy);
    expect(app.getSelectionHover()).toBe(text.id);
    for (let step = 0; step < 20; step++) {
      mouse.moveTo(cx + (step % 2), cy);
    }
    mouse.moveTo(180, 110);
    expect(app.getSelectionHover()).toBe(box.id);
    expect(renders).toHaveBeenCalledTimes(2);

    mouse.clickAt(180, 110);
    assertSelectedElements([box.id]);
    UI.clickTool("rectangle");
    mouse.moveTo(cx, cy);
    expect(app.getSelectionHover()).toBeNull();
  });

  it("a label does not make the rest of a transparent box count as drawn (A1)", () => {
    const { text, box, cx, cy } = boxOver({
      boundElements: [{ id: "box-label", type: "text" }],
    });
    const label = API.createElement({
      type: "text",
      id: "box-label",
      x: 70,
      y: 110,
      width: 40,
      height: 25,
      text: "Box",
      containerId: box.id,
    });
    API.setElements([text, API.getElement(box), label]);

    mouse.clickAt(cx, cy);
    assertSelectedElements([text.id]);

    mouse.clickAt(5, 5);
    mouse.clickAt(90, 122);
    assertSelectedElements([box.id]);
  });

  it("an unlocked box above a locked filled panel takes a click in its empty inside (A2)", () => {
    const panel = API.createElement({
      type: "rectangle",
      id: "panel",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      backgroundColor: "#a5d8ff",
      locked: true,
    });
    const box = API.createElement({
      type: "rectangle",
      id: "box",
      x: 60,
      y: 60,
      width: 200,
      height: 120,
      backgroundColor: "transparent",
    });
    API.setElements([panel, box]);

    mouse.clickAt(160, 120);
    assertSelectedElements([box.id]);

    mouse.clickAt(500, 500);
    mouse.clickAt(350, 250);
    assertSelectedElements([]);
  });

  it("text at opacity 0 draws nothing: the box takes the click (A9)", () => {
    const { text, box, cx, cy } = boxOver();
    API.setElements([
      { ...API.getElement(text), opacity: 0 },
      API.getElement(box),
    ]);

    mouse.clickAt(cx, cy);

    assertSelectedElements([box.id]);
  });

  it("the outline shows what a click selects, also over a selected box (A3)", () => {
    const { text, box, cx, cy } = boxOver();
    mouse.clickAt(180, 110);
    assertSelectedElements([box.id]);
    const app = window.h.app as unknown as {
      getSelectionHover: () => string | null;
    };

    mouse.moveTo(cx, cy);

    expect(app.getSelectionHover()).toBe(text.id);
  });

  it("no outline and no render in view mode (A5)", () => {
    const { cx, cy } = boxOver();
    API.setAppState({ viewModeEnabled: true });
    const app = window.h.app as unknown as {
      getSelectionHover: () => string | null;
      triggerRender: () => void;
    };
    const renders = vi.spyOn(app, "triggerRender");

    mouse.moveTo(cx, cy);
    mouse.moveTo(180, 110);

    expect(app.getSelectionHover()).toBeNull();
    expect(renders).not.toHaveBeenCalled();
  });

  it("the renderer outlines the element, its group, or nothing (A4, A7, A11)", () => {
    const { text, box } = boxOver();
    const map =
      window.h.app.scene.getNonDeletedElementsMap() as unknown as RenderableElementsMap;
    const state = window.h.state;
    const hover = (id: string) => ({
      id,
      scrollX: state.scrollX,
      scrollY: state.scrollY,
      zoom: state.zoom.value,
    });

    expect(getSelectionHoverBox(hover(box.id), map, state)).toMatchObject({
      x1: 20,
      y1: 20,
      x2: 220,
      y2: 140,
    });
    expect(
      getSelectionHoverBox(
        { ...hover(box.id), scrollX: state.scrollX + 10 },
        map,
        state,
      ),
    ).toBeNull();
    expect(
      getSelectionHoverBox(hover(box.id), map, {
        ...state,
        selectedElementIds: { [box.id]: true },
      }),
    ).toBeNull();

    API.updateElement(API.getElement(text), { groupIds: ["g"] });
    API.updateElement(API.getElement(box), { groupIds: ["g"] });
    const grouped =
      window.h.app.scene.getNonDeletedElementsMap() as unknown as RenderableElementsMap;
    expect(getSelectionHoverBox(hover(text.id), grouped, state)).toMatchObject({
      x1: 20,
      y1: 20,
      x2: 220,
      y2: 140,
    });
    expect(
      getSelectionHoverBox(hover(text.id), grouped, {
        ...state,
        editingGroupId: "g",
      }),
    ).not.toMatchObject({ x1: 20, y1: 20, x2: 220, y2: 140 });
  });

  it("selects text inside a locked transparent box", () => {
    const { text, cx, cy } = boxOver({ locked: true });

    mouse.clickAt(cx, cy);

    assertSelectedElements([text.id]);
  });

  it("selects the smallest box when only empty insides are under the pointer", () => {
    const inner = API.createElement({
      type: "rectangle",
      id: "inner",
      x: 40,
      y: 40,
      width: 60,
      height: 50,
      backgroundColor: "transparent",
    });
    const outer = API.createElement({
      type: "rectangle",
      id: "outer",
      x: 20,
      y: 20,
      width: 200,
      height: 120,
      backgroundColor: "transparent",
    });
    API.setElements([inner, outer]);

    mouse.clickAt(70, 65);
    assertSelectedElements([inner.id]);

    mouse.clickAt(5, 5);
    mouse.clickAt(180, 110);
    assertSelectedElements([outer.id]);
  });
});
