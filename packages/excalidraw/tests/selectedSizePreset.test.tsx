import React from "react";

import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@excalidraw/common";
import { getCommonBoundingBox } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import {
  getSelectionSizePreset,
  SELECTION_SIZE_PRESETS,
} from "../selectionSizePresets";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { act, fireEvent, render } from "./test-utils";

const h = window.h;

describe("selected-element size presets", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  it("maps every digit to the approved screen-size tables and zoom conversion", () => {
    expect(SELECTION_SIZE_PRESETS).toEqual({
      text: {
        "1": 12,
        "2": 16,
        "3": 20,
        "4": 24,
        "5": 32,
        "6": 40,
        "7": 56,
        "8": 72,
        "9": 96,
        "0": 128,
      },
      visual: {
        "1": 48,
        "2": 64,
        "3": 96,
        "4": 128,
        "5": 192,
        "6": 256,
        "7": 384,
        "8": 512,
        "9": 768,
        "0": 1024,
      },
    });
    expect(getSelectionSizePreset("4", "visual", 2)).toBe(64);
    expect(getSelectionSizePreset("2", "text", 0.5)).toBe(32);
  });

  it("resizes a visual selection to an absolute zoom-normalized longest edge", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      x: 20,
      y: 40,
      width: 240,
      height: 120,
      roundness: { type: 3, value: 8 },
    });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    API.setAppState({ zoom: { value: 2 as any } });
    const before = getCommonBoundingBox([rectangle]);

    Keyboard.keyPress("4");

    const resized = h.app.scene.getElement(rectangle.id)!;
    const after = getCommonBoundingBox([resized]);
    expect(Math.max(after.width, after.height)).toBeCloseTo(64);
    expect([after.midX, after.midY]).toEqual([before.midX, before.midY]);
    expect(resized.roundness).toEqual({ type: 3, value: 2 });

    Keyboard.keyPress("4");
    const repeated = getCommonBoundingBox([
      h.app.scene.getElement(rectangle.id)!,
    ]);
    expect(repeated).toMatchObject(after);
  });

  it("uses zoom-normalized font-size semantics for a lone text selection", () => {
    const text = API.createElement({
      type: "text",
      text: "content length does not define the preset",
      x: 100,
      y: 100,
      fontSize: 20,
    });
    API.setElements([text]);
    API.setSelectedElements([text]);
    API.setAppState({ zoom: { value: 0.5 as any } });

    Keyboard.keyPress("2");

    expect(h.app.scene.getElement(text.id)).toMatchObject({
      fontSize: 32,
    });
  });

  it("scales a multi-selection as one centered proportional unit", () => {
    const left = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      groupIds: ["pair"],
    });
    const right = API.createElement({
      type: "ellipse",
      x: 200,
      y: 100,
      width: 100,
      height: 50,
      groupIds: ["pair"],
    });
    API.setElements([left, right]);
    API.setSelectedElements([left, right]);
    const before = getCommonBoundingBox([left, right]);

    Keyboard.keyPress("3");

    const afterElements = [
      h.app.scene.getElement(left.id)!,
      h.app.scene.getElement(right.id)!,
    ];
    const after = getCommonBoundingBox(afterElements);
    expect(Math.max(after.width, after.height)).toBeCloseTo(96);
    expect([after.midX, after.midY]).toEqual([before.midX, before.midY]);
    expect(afterElements.map((element) => element.groupIds)).toEqual([
      ["pair"],
      ["pair"],
    ]);
  });

  it.each([
    { zoom: 0.25, label: "25%" },
    { zoom: 1, label: "100%" },
    { zoom: 2, label: "200%" },
    { zoom: 4, label: "400%" },
  ])(
    "preserves rotation and hidden Diamond geometry at $label zoom",
    ({ zoom }) => {
      const diamond = API.createElement({
        type: "diamond",
        x: 100,
        y: 80,
        width: 240,
        height: 120,
        angle: Math.PI / 6,
      });
      API.setElements([diamond]);
      API.setSelectedElements([diamond]);
      API.setAppState({ zoom: { value: zoom as any } });

      Keyboard.keyPress("4");

      const resized = h.app.scene.getElement(diamond.id)!;
      const bounds = getCommonBoundingBox([resized]);
      expect(Math.max(bounds.width, bounds.height)).toBeCloseTo(128 / zoom, 4);
      expect(resized.angle).toBeCloseTo(Math.PI / 6);
      expect(resized.type).toBe("diamond");
    },
  );

  it("scales strokes with the selection (rect by its side, arrow by the group factor)", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeWidth: 2,
    });
    const arrow = API.createElement({
      type: "arrow",
      x: 0,
      y: 150,
      width: 100,
      height: 50,
      strokeWidth: 4,
      points: [pointFrom(0, 0), pointFrom(50, 50), pointFrom(100, 0)],
    });
    API.setElements([rectangle, arrow]);
    API.setSelectedElements([rectangle, arrow]);

    // selection longest edge 200 -> preset "7" = 384, factor 1.92
    Keyboard.keyPress("7");

    const resizedRect = h.app.scene.getElement(rectangle.id)!;
    const resizedArrow = h.app.scene.getElement(arrow.id)!;
    expect(resizedRect.width).toBeCloseTo(192);
    expect(resizedRect.strokeWidth).toBeCloseTo(3.8);
    expect(resizedArrow.width).toBeCloseTo(192);
    expect(resizedArrow.strokeWidth).toBeCloseTo(7.7);
  });

  it("scales a lone arrow's stroke (presets always resize as a group unit)", () => {
    const arrow = API.createElement({
      type: "arrow",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      strokeWidth: 2,
      points: [pointFrom(0, 0), pointFrom(50, 50), pointFrom(100, 0)],
    });
    API.setElements([arrow]);
    API.setSelectedElements([arrow]);

    // longest edge 100 -> preset "5" = 192, factor 1.92
    Keyboard.keyPress("5");

    const resized = h.app.scene.getElement(arrow.id)!;
    expect(resized.width).toBeCloseTo(192);
    // presets go through resizeMultipleElements (group semantics), so the
    // arrow's stroke follows the uniform factor unlike a handle resize
    expect(resized.strokeWidth).toBeCloseTo(3.8);
  });

  it("preserves line/arrow point geometry and bindings while scaling their unit", () => {
    const start = API.createElement({
      type: "rectangle",
      id: "start",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      boundElements: [{ id: "arrow", type: "arrow" }],
    });
    const end = API.createElement({
      type: "ellipse",
      id: "end",
      x: 300,
      y: 100,
      width: 100,
      height: 100,
      boundElements: [{ id: "arrow", type: "arrow" }],
    });
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow",
      x: 100,
      y: 50,
      width: 200,
      height: 100,
      points: [pointFrom(0, 0), pointFrom(100, 100), pointFrom(200, 0)],
      startBinding: {
        elementId: start.id,
        fixedPoint: [1, 0.5],
        mode: "orbit",
      },
      endBinding: {
        elementId: end.id,
        fixedPoint: [0, 0.5],
        mode: "orbit",
      },
    });
    const line = API.createElement({
      type: "line",
      x: 100,
      y: 220,
      width: 200,
      height: 80,
      points: [pointFrom(0, 0), pointFrom(80, 80), pointFrom(200, 20)],
    });
    const elements = [start, arrow, end, line];
    const pointRatios = (element: typeof arrow | typeof line) =>
      element.points.map(([x, y]) => [
        element.width ? x / element.width : 0,
        element.height ? y / element.height : 0,
      ]);
    const arrowRatios = pointRatios(arrow);
    const lineRatios = pointRatios(line);
    const startBinding = arrow.startBinding;
    const endBinding = arrow.endBinding;
    API.setElements(elements);
    API.setSelectedElements(elements);

    Keyboard.keyPress("4");

    const resizedElements = elements.map(
      (element) => h.app.scene.getElement(element.id)!,
    );
    expect(
      Math.max(
        getCommonBoundingBox(resizedElements).width,
        getCommonBoundingBox(resizedElements).height,
      ),
    ).toBeCloseTo(128);
    const resizedArrow = h.app.scene.getElement(arrow.id)! as typeof arrow;
    const resizedLine = h.app.scene.getElement(line.id)! as typeof line;
    pointRatios(resizedArrow).forEach((point, index) => {
      expect(point[0]).toBeCloseTo(arrowRatios[index][0]);
      expect(point[1]).toBeCloseTo(arrowRatios[index][1]);
    });
    pointRatios(resizedLine).forEach((point, index) => {
      expect(point[0]).toBeCloseTo(lineRatios[index][0]);
      expect(point[1]).toBeCloseTo(lineRatios[index][1]);
    });
    expect(resizedArrow.startBinding).toEqual(startBinding);
    expect(resizedArrow.endBinding).toEqual(endBinding);
    expect(h.app.scene.getElement(start.id)?.boundElements).toEqual([
      { id: arrow.id, type: "arrow" },
    ]);
    expect(h.app.scene.getElement(end.id)?.boundElements).toEqual([
      { id: arrow.id, type: "arrow" },
    ]);
  });

  it("preserves a bound container/text relationship through native scaling", () => {
    const [container, text] = API.createTextContainer();
    if (container.type !== "rectangle" || text.type !== "text") {
      throw new Error("expected a rectangle with bound text");
    }
    API.setElements([container, text]);
    API.setSelectedElements([container]);
    const beforeFontSize = text.fontSize;
    const expectedScale = 96 / Math.max(container.width, container.height);

    Keyboard.keyPress("3");

    const resizedContainer = h.app.scene.getElement(container.id)!;
    const resizedText = h.app.scene.getElement(text.id)!;
    if (resizedText.type !== "text") {
      throw new Error("expected bound text to remain text");
    }
    const resizedBounds = getCommonBoundingBox([resizedContainer, resizedText]);
    expect(Math.max(resizedBounds.width, resizedBounds.height)).toBeCloseTo(96);
    expect(resizedContainer.boundElements).toEqual([
      { type: "text", id: text.id },
    ]);
    expect(resizedText.containerId).toBe(container.id);
    expect(resizedText.fontSize).toBeCloseTo(beforeFontSize * expectedScale);
  });

  it("preserves image crop metadata and aspect ratio through native scaling", () => {
    const baseImage = API.createElement({
      type: "image",
      x: 20,
      y: 30,
      width: 200,
      height: 100,
    });
    const image = {
      ...baseImage,
      crop: {
        x: 20,
        y: 10,
        width: 160,
        height: 80,
        naturalWidth: 400,
        naturalHeight: 200,
      },
    } as typeof baseImage;
    const crop = image.crop;
    const aspectRatio = image.width / image.height;
    API.setElements([image]);
    API.setSelectedElements([image]);

    Keyboard.keyPress("3");

    const resized = h.app.scene.getElement(image.id)!;
    expect(Math.max(resized.width, resized.height)).toBeCloseTo(96);
    expect(resized.width / resized.height).toBeCloseTo(aspectRatio);
    expect((resized as typeof image).crop).toEqual(crop);
  });

  it("resizes frame contents and embeds while preserving frame membership", () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    const embed = API.createElement({
      type: "embeddable",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      frameId: frame.id,
    });
    API.setElements([frame, embed]);
    API.setSelectedElements([frame]);
    const embedAspectRatio = embed.width / embed.height;

    Keyboard.keyPress("3");

    const resizedFrame = h.app.scene.getElement(frame.id)!;
    const resizedEmbed = h.app.scene.getElement(embed.id)!;
    const resizedBounds = getCommonBoundingBox([resizedFrame, resizedEmbed]);
    expect(Math.max(resizedBounds.width, resizedBounds.height)).toBeCloseTo(96);
    expect(resizedEmbed.frameId).toBe(frame.id);
    expect(resizedEmbed.type).toBe("embeddable");
    expect(resizedEmbed.width / resizedEmbed.height).toBeCloseTo(
      embedAspectRatio,
    );
  });

  it("does nothing without a selection and ignores modified digits", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 200,
      height: 100,
    });
    API.setElements([rectangle]);

    Keyboard.keyPress("1");
    expect(h.state.activeTool.type).toBe("selection");
    expect(h.app.scene.getElement(rectangle.id)).toMatchObject(rectangle);

    API.setSelectedElements([rectangle]);
    ["1", "2", "3"].forEach((key) => {
      Keyboard.withModifierKeys({ shift: true }, () => Keyboard.keyPress(key));
    });
    Keyboard.withModifierKeys({ ctrl: true }, () => Keyboard.keyPress("2"));
    Keyboard.withModifierKeys({ alt: true }, () => Keyboard.keyPress("2"));
    expect(h.app.scene.getElement(rectangle.id)).toMatchObject(rectangle);
  });

  it("protects locked selections", () => {
    const locked = API.createElement({
      type: "rectangle",
      width: 200,
      height: 100,
      locked: true,
    });
    API.setElements([locked]);
    API.setSelectedElements([locked]);

    Keyboard.keyPress("1");

    expect(h.app.scene.getElement(locked.id)).toMatchObject(locked);
  });

  it("protects the whole resize unit when a selected frame contains a locked member", () => {
    const frame = API.createElement({
      type: "frame",
      width: 300,
      height: 200,
    });
    const lockedChild = API.createElement({
      type: "rectangle",
      x: 50,
      y: 50,
      width: 100,
      height: 60,
      frameId: frame.id,
      locked: true,
    });
    API.setElements([frame, lockedChild]);
    API.setSelectedElements([frame]);
    const undoEntriesBefore = API.getUndoStack().length;
    const before = {
      frame: {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      },
      lockedChild: {
        x: lockedChild.x,
        y: lockedChild.y,
        width: lockedChild.width,
        height: lockedChild.height,
      },
    };

    Keyboard.keyPress("1");

    expect(h.app.scene.getElement(frame.id)).toMatchObject(before.frame);
    expect(h.app.scene.getElement(lockedChild.id)).toMatchObject(
      before.lockedChild,
    );
    expect(API.getUndoStack()).toHaveLength(undoEntriesBefore);
  });

  it("requires canvas keyboard ownership and respects search", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 200,
      height: 100,
    });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    const externalButton = document.createElement("button");
    document.body.appendChild(externalButton);
    externalButton.focus();

    fireEvent.keyDown(document, { key: "1" });
    expect(h.app.scene.getElement(rectangle.id)).toMatchObject(rectangle);

    externalButton.remove();
    API.setAppState({
      openSidebar: { name: DEFAULT_SIDEBAR.name, tab: CANVAS_SEARCH_TAB },
    });
    Keyboard.keyPress("1");
    expect(h.app.scene.getElement(rectangle.id)).toMatchObject(rectangle);
  });

  it("commits a preset as one undoable and redoable history action", async () => {
    const rectangle = UI.createElement("rectangle", {
      position: 10,
      size: 200,
    });
    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    API.setSelectedElements([rectangle.get() as any]);
    const before = {
      x: rectangle.get().x,
      y: rectangle.get().y,
      width: rectangle.get().width,
      height: rectangle.get().height,
    };
    const undoEntriesBefore = API.getUndoStack().length;

    Keyboard.keyPress("1");
    const resized = h.app.scene.getElement(rectangle.id)!;
    expect(Math.max(resized.width, resized.height)).toBeCloseTo(48);
    expect(API.getUndoStack()).toHaveLength(undoEntriesBefore + 1);

    Keyboard.keyPress("1");
    expect(API.getUndoStack()).toHaveLength(undoEntriesBefore + 1);

    Keyboard.undo();
    await act(async () => {});
    expect(h.app.scene.getElement(rectangle.id)).toMatchObject(before);

    Keyboard.redo();
    await act(async () => {});
    expect(
      Math.max(
        h.app.scene.getElement(rectangle.id)!.width,
        h.app.scene.getElement(rectangle.id)!.height,
      ),
    ).toBeCloseTo(48);
  });
});
