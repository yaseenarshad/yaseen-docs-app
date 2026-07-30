import React from "react";

import {
  COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX,
  DEFAULT_ELEMENT_STROKE_COLOR_INDEX,
  KEYS,
} from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { fireEvent, render, togglePopover } from "./test-utils";

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
  });

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
});
