import React from "react";

import {
  COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_COLOR_INDEX,
  THEME,
} from "@excalidraw/common";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  screen,
  togglePopover,
} from "../../tests/test-utils";

import { SEMANTIC_COLOR_HOTKEYS } from "./colorPickerUtils";

const h = window.h;

describe("semantic color-picker hotkeys", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    await act(async () => {});
  });

  it("renders the semantic label and consumes R to apply red", () => {
    const rectangle = API.createElement({ type: "rectangle" });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    togglePopover("Stroke");

    const redSwatch = screen.getByTestId("color-red");
    expect(redSwatch).toHaveAttribute("aria-label", "Red — r");

    fireEvent.keyDown(
      document.querySelector(".color-picker-content") as HTMLElement,
      { key: "r", code: "KeyR" },
    );

    expect(API.getSelectedElement().strokeColor).toBe(
      COLOR_PALETTE.red[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
    );
    expect(h.state.activeTool.type).toBe("selection");
  });

  it("uses the same case-insensitive mapping for background without leaking T", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      backgroundColor: COLOR_PALETTE.red[1],
    });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    togglePopover("Background");

    const transparentSwatch = screen.getByTestId("color-transparent");
    expect(transparentSwatch).toHaveAttribute("aria-label", "Transparent — t");

    fireEvent.keyDown(
      document.querySelector(".color-picker-content") as HTMLElement,
      { key: "T", code: "KeyT" },
    );

    expect(API.getSelectedElement().backgroundColor).toBe(
      COLOR_PALETTE.transparent,
    );
    expect(h.state.editingTextElement).toBe(null);
    expect(h.state.activeTool.type).toBe("selection");
  });

  it.each(Object.entries(SEMANTIC_COLOR_HOTKEYS))(
    "shows and executes the approved %s = %s mapping",
    (colorName, hotkey) => {
      const rectangle = API.createElement({ type: "rectangle" });
      API.setElements([rectangle]);
      API.setSelectedElements([rectangle]);
      togglePopover("Stroke");

      const paletteValue =
        COLOR_PALETTE[colorName as keyof typeof COLOR_PALETTE];
      const expectedColor =
        typeof paletteValue === "string"
          ? paletteValue
          : paletteValue[DEFAULT_ELEMENT_STROKE_COLOR_INDEX];
      const label = screen
        .getByTestId(`color-${colorName}`)
        .getAttribute("aria-label");

      expect(label).toMatch(new RegExp(` — ${hotkey}$`));
      fireEvent.keyDown(
        document.querySelector(".color-picker-content") as HTMLElement,
        { key: hotkey.toUpperCase(), code: `Key${hotkey.toUpperCase()}` },
      );
      expect(API.getSelectedElement().strokeColor).toBe(expectedColor);
    },
  );

  it("preserves shade navigation and Escape behavior", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      strokeColor: COLOR_PALETTE.red[4],
    });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    togglePopover("Stroke");
    const picker = document.querySelector(
      ".color-picker-content",
    ) as HTMLElement;

    fireEvent.keyDown(picker, {
      key: "!",
      code: "Digit1",
      shiftKey: true,
    });
    expect(API.getSelectedElement().strokeColor).toBe(COLOR_PALETTE.red[0]);

    fireEvent.keyDown(picker, { key: "ArrowRight" });
    expect(API.getSelectedElement().strokeColor).toBe(COLOR_PALETTE.red[1]);

    fireEvent.keyDown(picker, { key: "Escape" });
    expect(document.querySelector(".color-picker-content")).toBe(null);
  });

  it("preserves custom-color number shortcuts", () => {
    const selected = API.createElement({ type: "rectangle" });
    const custom = API.createElement({
      type: "rectangle",
      strokeColor: "#123456",
    });
    API.setElements([selected, custom]);
    API.setSelectedElements([selected]);
    togglePopover("Stroke");

    fireEvent.keyDown(
      document.querySelector(".color-picker-content") as HTMLElement,
      { key: "1", code: "Digit1" },
    );

    expect(API.getSelectedElement().strokeColor).toBe("#123456");
  });

  it("keeps semantic labels available in dark theme", () => {
    API.setAppState({ theme: THEME.DARK });
    const rectangle = API.createElement({ type: "rectangle" });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    togglePopover("Stroke");

    expect(screen.getByTestId("color-blue")).toHaveAttribute(
      "aria-label",
      "Blue — u",
    );
    expect(screen.getByTestId("color-blue")).toBeVisible();
  });
});
