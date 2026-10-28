import React from "react";

import { CODES, STROKE_WIDTH } from "@excalidraw/common";

import type {
  ExcalidrawTextElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { copiedStyles } from "../actions/actionStyles";
import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { Keyboard, Pointer, UI } from "../tests/helpers/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  togglePopover,
} from "../tests/test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

describe("actionStyles", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    // https://github.com/floating-ui/floating-ui/issues/1908#issuecomment-1301553793
    // affects node v16+
    await act(async () => {});
  });

  it("creates representative manual tools with Architect roughness", () => {
    for (const [index, tool] of (
      ["rectangle", "ellipse", "diamond", "line", "arrow"] as const
    ).entries()) {
      if (tool === "diamond") {
        act(() => h.app.setActiveTool({ type: "diamond" }));
      } else {
        UI.clickTool(tool);
      }
      mouse.down(10 + index * 30, 10);
      mouse.up(20, 20);
      mouse.reset();
    }

    expect(h.elements.map((element) => element.roughness)).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });

  it("should copy & paste styles via keyboard", async () => {
    UI.clickTool("rectangle");
    mouse.down(10, 10);
    mouse.up(20, 20);

    UI.clickTool("rectangle");
    mouse.down(10, 10);
    mouse.up(20, 20);

    // Change some styles of second rectangle
    togglePopover("Stroke");
    UI.clickOnTestId("color-red");
    togglePopover("Background");
    UI.clickOnTestId("color-blue");
    // Fill style
    fireEvent.click(screen.getByTitle("Cross-hatch"));
    // Exact vector stroke width
    const strokeWidth = screen.getByTestId("linear-stroke-width-input");
    fireEvent.change(strokeWidth, {
      target: { value: STROKE_WIDTH.bold.toString() },
    });
    fireEvent.blur(strokeWidth);
    // Stroke style
    togglePopover("More properties");
    fireEvent.click(screen.getByTitle("Dotted"));
    // Roughness
    fireEvent.click(screen.getByTitle("Cartoonist"));
    // Opacity
    fireEvent.change(screen.getByTestId("opacity"), {
      target: { value: "60" },
    });

    mouse.reset();

    API.setSelectedElements([h.elements[1]] as NonDeletedExcalidrawElement[]);

    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.codeDown(CODES.C);
    });
    const secondRect = JSON.parse(copiedStyles)[0];
    expect(secondRect.id).toBe(h.elements[1].id);

    mouse.reset();
    // Paste styles to first rectangle
    API.setSelectedElements([h.elements[0]] as NonDeletedExcalidrawElement[]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.codeDown(CODES.V);
    });

    const firstRect = API.getSelectedElement();
    expect(firstRect.id).toBe(h.elements[0].id);
    expect(firstRect.strokeColor).toBe("#e03131");
    expect(firstRect.backgroundColor).toBe("#a5d8ff");
    expect(firstRect.fillStyle).toBe("cross-hatch");
    expect(firstRect.strokeWidth).toBe(STROKE_WIDTH.bold);
    expect(firstRect.strokeStyle).toBe("dotted");
    expect(firstRect.roughness).toBe(2); // Cartoonist: 2
    expect(firstRect.opacity).toBe(60);
  });

  it("copies proportional text-fill padding only between free-text elements", () => {
    const target = {
      ...API.createElement({
        type: "text",
        text: "Target",
        backgroundColor: "#a5d8ff",
      }),
      backgroundPaddingScale: 0.5,
    } as NonDeleted<ExcalidrawTextElement>;
    const rectangle = API.createElement({
      type: "rectangle",
      backgroundColor: "#a5d8ff",
    });
    const source = {
      ...API.createElement({
        type: "text",
        text: "Source",
        backgroundColor: "#ffc9c9",
      }),
      backgroundPaddingScale: 2,
    } as NonDeleted<ExcalidrawTextElement>;
    API.setElements([target, rectangle, source]);
    API.setSelectedElements([source]);

    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.codeDown(CODES.C);
    });
    API.setSelectedElements([target, rectangle]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.codeDown(CODES.V);
    });

    expect(
      (window.h.app.scene.getElement(target.id) as ExcalidrawTextElement)
        .backgroundPaddingScale,
    ).toBe(2);
    expect(
      (window.h.app.scene.getElement(rectangle.id) as Record<string, unknown>)
        .backgroundPaddingScale,
    ).toBeUndefined();
  });
});
