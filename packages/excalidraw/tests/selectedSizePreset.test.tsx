import React from "react";

import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@excalidraw/common";
import { getCommonBoundingBox } from "@excalidraw/element";

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

    Keyboard.keyPress("1");
    const resized = h.app.scene.getElement(rectangle.id)!;
    expect(Math.max(resized.width, resized.height)).toBeCloseTo(48);

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
