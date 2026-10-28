import React from "react";

import {
  COLOR_PALETTE,
  CANVAS_SEARCH_TAB,
  DEFAULT_SIDEBAR,
  DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX,
  DEFAULT_ELEMENT_STROKE_COLOR_INDEX,
  KEYS,
  ROUNDNESS,
} from "@excalidraw/common";
import { newElementWith } from "@excalidraw/element";

import { Excalidraw } from "../index";
import { SEMANTIC_COLOR_HOTKEYS } from "../components/ColorPicker/colorPickerUtils";
import { getTextBackgroundRadiusForFontSize } from "../textCreation";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { act, fireEvent, render, togglePopover } from "./test-utils";

const h = window.h;

describe("selected-element semantic color hotkeys", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("gives R priority over Rectangle for a selected closed shape", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      strokeColor: COLOR_PALETTE.black,
      backgroundColor: COLOR_PALETTE.transparent,
    });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    Keyboard.keyPress(KEYS.R);

    expect(h.app.scene.getElement(rectangle.id)).toMatchObject({
      strokeColor: COLOR_PALETTE.black,
      backgroundColor:
        COLOR_PALETTE.red[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX],
    });
    expect(h.state.activeTool.type).toBe("selection");
  });

  it("gives T priority over Text for selected text", () => {
    const text = API.createElement({
      type: "text",
      text: "Selected",
      strokeColor: COLOR_PALETTE.black,
    });
    API.setElements([text]);
    API.setSelectedElements([text]);

    Keyboard.keyPress(KEYS.T);

    expect(h.app.scene.getElement(text.id)?.strokeColor).toBe(
      COLOR_PALETTE.transparent,
    );
    expect(h.state.editingTextElement).toBe(null);
    expect(h.state.activeTool.type).toBe("selection");
  });

  it("gives A priority over Arrow for a selected arrow", () => {
    const arrow = API.createElement({
      type: "arrow",
      strokeColor: COLOR_PALETTE.black,
    });
    API.setElements([arrow]);
    API.setSelectedElements([arrow]);

    Keyboard.keyPress("A");

    expect(h.app.scene.getElement(arrow.id)?.strokeColor).toBe(
      COLOR_PALETTE.grape[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
    );
    expect(h.state.activeTool.type).toBe("selection");
  });

  it("retains drawing-tool shortcuts when there is no selection", () => {
    Keyboard.keyPress(KEYS.R);
    expect(h.state.activeTool.type).toBe("rectangle");

    Keyboard.keyPress(KEYS.A);
    expect(h.state.activeTool.type).toBe("arrow");

    Keyboard.keyPress(KEYS.D);
    expect(h.state.activeTool.type).toBe("line");
  });

  it.each(Object.entries(SEMANTIC_COLOR_HOTKEYS))(
    "applies the approved selected-text %s = %s shortcut",
    (colorName, hotkey) => {
      const text = API.createElement({
        type: "text",
        text: colorName,
        strokeColor: "#123456",
      });
      API.setElements([text]);
      API.setSelectedElements([text]);
      const paletteValue =
        COLOR_PALETTE[colorName as keyof typeof COLOR_PALETTE];
      const expectedColor =
        typeof paletteValue === "string"
          ? paletteValue
          : paletteValue[DEFAULT_ELEMENT_STROKE_COLOR_INDEX];

      Keyboard.keyPress(hotkey.toUpperCase());

      expect(h.app.scene.getElement(text.id)?.strokeColor).toBe(expectedColor);
      expect(h.state.activeTool.type).toBe("selection");
    },
  );

  it.each(Object.entries(SEMANTIC_COLOR_HOTKEYS))(
    "applies Shift+%s = %s to stroke while preserving fill",
    (colorName, hotkey) => {
      const rectangle = API.createElement({
        type: "rectangle",
        strokeColor: "#123456",
        backgroundColor: "#abcdef",
      });
      API.setElements([rectangle]);
      API.setSelectedElements([rectangle]);
      const paletteValue =
        COLOR_PALETTE[colorName as keyof typeof COLOR_PALETTE];
      const expectedColor =
        typeof paletteValue === "string"
          ? paletteValue
          : paletteValue[DEFAULT_ELEMENT_STROKE_COLOR_INDEX];

      Keyboard.withModifierKeys({ shift: true }, () => {
        Keyboard.keyPress(hotkey.toUpperCase());
      });

      expect(h.app.scene.getElement(rectangle.id)).toMatchObject({
        strokeColor: expectedColor,
        backgroundColor: "#abcdef",
      });
      expect(h.state.activeTool.type).toBe("selection");
    },
  );

  it.each(Object.entries(SEMANTIC_COLOR_HOTKEYS))(
    "applies Shift+%s = %s to a free-text background while preserving glyph color",
    (colorName, hotkey) => {
      const text = API.createElement({
        type: "text",
        text: colorName,
        strokeColor: "#123456",
        backgroundColor: COLOR_PALETTE.transparent,
      });
      API.setElements([text]);
      API.setSelectedElements([text]);
      const paletteValue =
        COLOR_PALETTE[colorName as keyof typeof COLOR_PALETTE];
      const expectedColor =
        typeof paletteValue === "string"
          ? paletteValue
          : paletteValue[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX];

      Keyboard.withModifierKeys({ shift: true }, () => {
        Keyboard.keyPress(hotkey.toUpperCase());
      });

      const updatedText = h.app.scene.getElement(text.id)!;
      expect(updatedText).toMatchObject({
        strokeColor: "#123456",
        backgroundColor: expectedColor,
      });
      expect(updatedText.roundness).toEqual(
        expectedColor === COLOR_PALETTE.transparent
          ? null
          : {
              type: ROUNDNESS.ADAPTIVE_RADIUS,
              value: getTextBackgroundRadiusForFontSize(text.fontSize),
            },
      );
    },
  );

  it("applies Shift color type-aware across free text and outlined elements", () => {
    const text = API.createElement({
      type: "text",
      text: "Background",
      strokeColor: "#111111",
      backgroundColor: COLOR_PALETTE.transparent,
    });
    const rectangle = API.createElement({
      type: "rectangle",
      strokeColor: "#222222",
      backgroundColor: "#abcdef",
    });
    API.setElements([text, rectangle]);
    API.setSelectedElements([text, rectangle]);

    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress(KEYS.G);
    });

    expect(h.app.scene.getElement(text.id)).toMatchObject({
      strokeColor: "#111111",
      backgroundColor:
        COLOR_PALETTE.green[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX],
    });
    expect(h.app.scene.getElement(rectangle.id)).toMatchObject({
      strokeColor: COLOR_PALETTE.green[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
      backgroundColor: "#abcdef",
    });
  });

  it("uses Shift+T to clear a free-text background without clearing glyphs", () => {
    const text = API.createElement({
      type: "text",
      text: "Clear background",
      strokeColor: "#123456",
      backgroundColor: "#abcdef",
    });
    API.setElements([text]);
    API.setSelectedElements([text]);

    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress(KEYS.T);
    });

    expect(h.app.scene.getElement(text.id)).toMatchObject({
      strokeColor: "#123456",
      backgroundColor: COLOR_PALETTE.transparent,
    });
  });

  it("applies Shift stroke to supported mixed members and skips unsupported members", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      strokeColor: "#111111",
      backgroundColor: "#aaaaaa",
    });
    const image = API.createElement({
      type: "image",
      strokeColor: "#222222",
      backgroundColor: "#bbbbbb",
    });
    const iframe = API.createElement({ type: "iframe" });
    API.setElements([rectangle, image, iframe]);
    API.setSelectedElements([rectangle, image, iframe]);

    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress(KEYS.G);
    });

    [rectangle, image].forEach((element) => {
      expect(h.app.scene.getElement(element.id)).toMatchObject({
        strokeColor: COLOR_PALETTE.green[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
        backgroundColor: element.backgroundColor,
      });
    });
    expect(h.app.scene.getElement(iframe.id)).toMatchObject(iframe);
    expect(h.state.selectedElementIds).toEqual({
      [rectangle.id]: true,
      [image.id]: true,
      [iframe.id]: true,
    });
  });

  it("changes only a selected container stroke and not its bound text", () => {
    const [container, text] = API.createTextContainer();
    API.setElements([container, text]);
    API.setSelectedElements([container]);

    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress(KEYS.G.toUpperCase());
    });

    expect(h.app.scene.getElement(container.id)).toMatchObject({
      strokeColor: COLOR_PALETTE.green[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
      backgroundColor: container.backgroundColor,
      boundElements: container.boundElements,
    });
    expect(h.app.scene.getElement(text.id)).toMatchObject({
      strokeColor: text.strokeColor,
      containerId: container.id,
    });
  });

  it("consumes unsupported-only Shift colors with stroke-specific feedback", () => {
    const iframe = API.createElement({ type: "iframe" });
    API.setElements([iframe]);
    API.setSelectedElements([iframe]);

    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress(KEYS.E);
    });

    expect(h.state.activeTool.type).toBe("selection");
    expect(h.state.toast?.message).toBe(
      "The selected elements do not support alternate color shortcuts.",
    );
  });

  it("does not use Shift color aliases as drawing tools without a selection", () => {
    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress(KEYS.E);
    });

    expect(h.state.activeTool.type).toBe("selection");
    expect(h.state.currentItemStrokeColor).toBe(COLOR_PALETTE.black);
  });

  it.each(Object.entries(SEMANTIC_COLOR_HOTKEYS))(
    "applies the approved selected-image outline %s = %s shortcut",
    (colorName, hotkey) => {
      const image = API.createElement({
        type: "image",
        strokeColor: "#123456",
        strokeWidth: 0,
        strokeStyle: "dashed",
        x: 40,
        y: 50,
        width: 160,
        height: 90,
        angle: 0.25,
        opacity: 35,
        scale: [-1, 1],
        groupIds: ["image-group"],
      });
      API.setElements([image]);
      API.setSelectedElements([image]);
      const paletteValue =
        COLOR_PALETTE[colorName as keyof typeof COLOR_PALETTE];
      const expectedColor =
        typeof paletteValue === "string"
          ? paletteValue
          : paletteValue[DEFAULT_ELEMENT_STROKE_COLOR_INDEX];

      Keyboard.keyPress(hotkey.toUpperCase());

      expect(h.app.scene.getElement(image.id)).toMatchObject({
        strokeColor: expectedColor,
        strokeWidth: 0,
        strokeStyle: "dashed",
        x: 40,
        y: 50,
        width: 160,
        height: 90,
        angle: 0.25,
        opacity: 35,
        scale: [-1, 1],
        groupIds: ["image-group"],
      });
      expect(h.state.selectedElementIds).toEqual({ [image.id]: true });
      expect(h.state.toast).toBe(null);
      expect(h.state.activeTool.type).toBe("selection");
    },
  );

  it("suppresses selected-color routing in guarded contexts", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      backgroundColor: COLOR_PALETTE.transparent,
    });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    API.setAppState({ openDialog: { name: "help" } });
    Keyboard.keyPress(KEYS.R);
    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );

    API.setAppState({ openDialog: null });
    togglePopover("Stroke");
    Keyboard.keyPress(KEYS.R);
    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );

    API.setAppState({ openPopup: null, viewModeEnabled: true });
    Keyboard.keyPress(KEYS.R);
    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );
  });

  it("suppresses routing during text editing, search, and active transforms", () => {
    const text = API.createElement({
      type: "text",
      text: "Editing",
      strokeColor: COLOR_PALETTE.black,
    });
    API.setElements([text]);
    API.setSelectedElements([text]);

    API.setAppState({ editingTextElement: text });
    Keyboard.keyPress(KEYS.R);
    expect(h.app.scene.getElement(text.id)?.strokeColor).toBe(
      COLOR_PALETTE.black,
    );

    API.setAppState({
      editingTextElement: null,
      openSidebar: { name: DEFAULT_SIDEBAR.name, tab: CANVAS_SEARCH_TAB },
    });
    Keyboard.keyPress(KEYS.R);
    expect(h.app.scene.getElement(text.id)?.strokeColor).toBe(
      COLOR_PALETTE.black,
    );

    API.setAppState({
      openSidebar: null,
      selectedElementsAreBeingDragged: true,
    });
    Keyboard.keyPress(KEYS.R);
    expect(h.app.scene.getElement(text.id)?.strokeColor).toBe(
      COLOR_PALETTE.black,
    );

    API.setAppState({
      selectedElementsAreBeingDragged: false,
      isResizing: true,
    });
    Keyboard.keyPress(KEYS.R);
    expect(h.app.scene.getElement(text.id)?.strokeColor).toBe(
      COLOR_PALETTE.black,
    );

    API.setAppState({ isResizing: false, isRotating: true });
    Keyboard.keyPress(KEYS.R);
    expect(h.app.scene.getElement(text.id)?.strokeColor).toBe(
      COLOR_PALETTE.black,
    );
  });

  it("requires canvas keyboard ownership", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      backgroundColor: COLOR_PALETTE.transparent,
    });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    const externalButton = document.createElement("button");
    document.body.appendChild(externalButton);
    externalButton.focus();

    fireEvent.keyDown(document, { key: KEYS.R });

    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );
    externalButton.remove();
  });

  it("ignores modified keys and writable targets", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      backgroundColor: COLOR_PALETTE.transparent,
    });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(input);
    document.body.appendChild(editable);

    fireEvent.keyDown(document, { key: KEYS.R, ctrlKey: true });
    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );
    fireEvent.keyDown(document, { key: KEYS.R, altKey: true });
    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );
    fireEvent.keyDown(document, { key: KEYS.R, metaKey: true });
    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );
    fireEvent.keyDown(input, { key: KEYS.R });
    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );
    fireEvent.keyDown(editable, { key: KEYS.R });

    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );
    input.remove();
    editable.remove();
  });

  it("applies the type-aware primary property across a mixed selection", () => {
    const shapeTypes = ["rectangle", "ellipse", "diamond", "frame"] as const;
    const strokeTypes = ["text", "line", "arrow", "freedraw"] as const;
    const shapes = shapeTypes.map((type) =>
      API.createElement({
        type,
        strokeColor: "#123456",
        backgroundColor: COLOR_PALETTE.transparent,
      }),
    );
    const strokeTargets = strokeTypes.map((type) =>
      API.createElement({
        type,
        strokeColor: COLOR_PALETTE.black,
        backgroundColor: "#abcdef",
      }),
    );
    const elements = [...shapes, ...strokeTargets];
    API.setElements(elements);
    API.setSelectedElements(elements);

    Keyboard.keyPress(KEYS.R);

    shapes.forEach((element) => {
      expect(h.app.scene.getElement(element.id)).toMatchObject({
        strokeColor: "#123456",
        backgroundColor:
          COLOR_PALETTE.red[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX],
      });
    });
    strokeTargets.forEach((element) => {
      expect(h.app.scene.getElement(element.id)).toMatchObject({
        strokeColor: COLOR_PALETTE.red[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
        backgroundColor: "#abcdef",
      });
    });
    expect(h.elements.map((element) => element.id)).toEqual(
      elements.map((element) => element.id),
    );
    expect(Object.keys(h.state.selectedElementIds)).toEqual(
      elements.map((element) => element.id),
    );
  });

  it("changes a selected container without recoloring its bound text", () => {
    const [container, text] = API.createTextContainer();
    API.setElements([container, text]);
    API.setSelectedElements([container]);

    Keyboard.keyPress("u");

    expect(h.app.scene.getElement(container.id)).toMatchObject({
      backgroundColor:
        COLOR_PALETTE.blue[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX],
      boundElements: container.boundElements,
    });
    expect(h.app.scene.getElement(text.id)).toMatchObject({
      strokeColor: text.strokeColor,
      containerId: container.id,
    });
  });

  it("applies transparent to each target's primary property", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      strokeColor: "#123456",
      backgroundColor: "#abcdef",
    });
    const text = API.createElement({
      type: "text",
      text: "Transparent",
      strokeColor: "#123456",
      backgroundColor: "#abcdef",
    });
    API.setElements([rectangle, text]);
    API.setSelectedElements([rectangle, text]);

    Keyboard.keyPress(KEYS.T);

    expect(h.app.scene.getElement(rectangle.id)).toMatchObject({
      strokeColor: "#123456",
      backgroundColor: COLOR_PALETTE.transparent,
    });
    expect(h.app.scene.getElement(text.id)).toMatchObject({
      strokeColor: COLOR_PALETTE.transparent,
      backgroundColor: "#abcdef",
    });
  });

  it("preserves groups and frame relationships", () => {
    const frame = API.createElement({
      type: "frame",
      backgroundColor: COLOR_PALETTE.transparent,
      groupIds: ["group-1"],
    });
    const child = API.createElement({
      type: "rectangle",
      frameId: frame.id,
      groupIds: ["group-1"],
      backgroundColor: "#abcdef",
    });
    API.setElements([frame, child]);
    API.setSelectedElements([frame]);

    Keyboard.keyPress(KEYS.P);

    expect(h.app.scene.getElement(frame.id)).toMatchObject({
      backgroundColor:
        COLOR_PALETTE.pink[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX],
      groupIds: ["group-1"],
    });
    expect(h.app.scene.getElement(child.id)).toMatchObject({
      frameId: frame.id,
      groupIds: ["group-1"],
      backgroundColor: "#abcdef",
    });
  });

  it("updates images and supported elements while skipping embeds", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      backgroundColor: COLOR_PALETTE.transparent,
    });
    const image = API.createElement({ type: "image" });
    const iframe = API.createElement({ type: "iframe" });
    const embeddable = API.createElement({ type: "embeddable" });
    API.setElements([rectangle, image, iframe, embeddable]);
    API.setSelectedElements([rectangle, image, iframe, embeddable]);

    Keyboard.keyPress(KEYS.G);

    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.green[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX],
    );
    expect(h.app.scene.getElement(image.id)?.strokeColor).toBe(
      COLOR_PALETTE.green[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
    );
    [iframe, embeddable].forEach((element) => {
      expect(h.app.scene.getElement(element.id)).toMatchObject(element);
    });
  });

  it("consumes unsupported-only semantic keys and provides feedback", () => {
    const iframe = API.createElement({ type: "iframe" });
    const embeddable = API.createElement({ type: "embeddable" });
    API.setElements([iframe, embeddable]);
    API.setSelectedElements([iframe, embeddable]);
    const before = h.elements;

    Keyboard.keyPress(KEYS.R);

    expect(h.elements).toBe(before);
    expect(h.state.activeTool.type).toBe("selection");
    expect(h.state.toast?.message).toBe(
      "The selected elements do not support direct color shortcuts.",
    );
  });

  it("applies a mixed color change as one undoable operation", async () => {
    const imageTemplate = API.createElement({
      type: "image",
      x: 200,
      strokeWidth: 6.5,
      fileId: "history-image",
      status: "saved",
    });
    act(() => {
      h.app.insertElements([
        newElementWith(imageTemplate, { strokeColor: "#123456" }),
      ]);
    });
    await act(async () => {});
    const image = h.elements.find((element) => element.type === "image")!;
    const rectangle = UI.createElement("rectangle");
    const text = UI.createElement("text", { position: 100 });
    await UI.editText(text, "History");
    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    API.setSelectedElements([rectangle.get() as any, text.get() as any, image]);
    const selectedIds = h.state.selectedElementIds;
    expect(h.app.scene.getSelectedElements(h.state)).toHaveLength(3);
    expect(h.state).toMatchObject({
      newElement: null,
      selectionElement: null,
      selectedElementsAreBeingDragged: false,
      isResizing: false,
      isRotating: false,
    });
    expect(h.app.scene.getElement(image.id)?.strokeColor).toBe("#123456");
    expect(
      API.getSnapshot().find((element) => element.id === image.id)?.strokeColor,
    ).toBe("#123456");

    Keyboard.keyPress(KEYS.R);
    await act(async () => {});

    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.red[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX],
    );
    expect(h.app.scene.getElement(text.id)?.strokeColor).toBe(
      COLOR_PALETTE.red[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
    );
    expect(h.app.scene.getElement(image.id)).toMatchObject({
      strokeColor: COLOR_PALETTE.red[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
      strokeWidth: 6.5,
    });
    expect(h.state.selectedElementIds).toEqual(selectedIds);

    Keyboard.undo();
    await act(async () => {});
    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );
    expect(h.app.scene.getElement(text.id)?.strokeColor).toBe(
      COLOR_PALETTE.black,
    );
    expect(h.app.scene.getElement(image.id)).toMatchObject({
      strokeColor: "#123456",
      strokeWidth: 6.5,
    });

    Keyboard.redo();
    await act(async () => {});
    expect(h.app.scene.getElement(rectangle.id)?.backgroundColor).toBe(
      COLOR_PALETTE.red[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX],
    );
    expect(h.app.scene.getElement(text.id)?.strokeColor).toBe(
      COLOR_PALETTE.red[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
    );
    expect(h.app.scene.getElement(image.id)).toMatchObject({
      strokeColor: COLOR_PALETTE.red[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
      strokeWidth: 6.5,
    });
  });

  it("commits a type-aware Shift color change as one undoable operation", async () => {
    const rectangle = UI.createElement("rectangle");
    const text = UI.createElement("text", { position: 100 });
    await UI.editText(text, "Background history");
    const originalFill = rectangle.get().backgroundColor;
    const originalStroke = rectangle.get().strokeColor;
    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    API.setSelectedElements([rectangle.get() as any, text.get() as any]);

    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress(KEYS.R.toUpperCase());
    });
    expect(h.app.scene.getElement(rectangle.id)).toMatchObject({
      backgroundColor: originalFill,
      strokeColor: COLOR_PALETTE.red[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
    });
    expect(h.app.scene.getElement(text.id)).toMatchObject({
      strokeColor: COLOR_PALETTE.black,
      backgroundColor:
        COLOR_PALETTE.red[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX],
    });

    Keyboard.undo();
    await act(async () => {});
    expect(h.app.scene.getElement(rectangle.id)).toMatchObject({
      backgroundColor: originalFill,
      strokeColor: originalStroke,
    });
    expect(h.app.scene.getElement(text.id)).toMatchObject({
      strokeColor: COLOR_PALETTE.black,
      backgroundColor: COLOR_PALETTE.transparent,
    });
  });

  it("keeps unrelated selected-element commands available", () => {
    const first = API.createElement({ type: "rectangle", x: 0 });
    const second = API.createElement({ type: "ellipse", x: 20 });
    API.setElements([first, second]);
    API.setSelectedElements([first, second]);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.G);
    });
    expect(h.app.scene.getElement(first.id)?.groupIds).toHaveLength(1);
    expect(h.app.scene.getElement(second.id)?.groupIds).toEqual(
      h.app.scene.getElement(first.id)?.groupIds,
    );

    const xBefore = h.app.scene.getElement(first.id)!.x;
    Keyboard.keyPress(KEYS.ARROW_RIGHT);
    expect(h.app.scene.getElement(first.id)!.x).toBeGreaterThan(xBefore);

    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.state.selectedElementIds).toEqual({});
  });
});
