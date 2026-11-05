import React from "react";

import { KEYS } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { getTextEditor } from "./queries/dom";
import {
  act,
  exactFontSizeInput,
  fireEvent,
  render,
  unmountComponent,
} from "./test-utils";

unmountComponent();

const { h } = window;

/** The controls of the text toolbar, each by its name. */
const controls = () => {
  const bar = document.querySelector(".contextual-properties-toolbar");
  return [...(bar?.querySelectorAll<HTMLElement>("button, input") ?? [])].map(
    (control) =>
      control.getAttribute("aria-label") ?? control.getAttribute("title"),
  );
};

/** YAZ-4277 1E, D8: in edit the top bar keeps the whole-box controls. */
describe("the top bar in edit", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  const edit = async () => {
    const text = API.createElement({
      type: "text",
      text: "Hello",
      fontSize: 20,
    });
    API.setElements([text]);
    API.setSelectedElements([text]);
    Keyboard.keyPress(KEYS.ENTER);
    return { text, editor: await getTextEditor() };
  };

  it("shows exactly font, size, align, line spacing and Background in edit", async () => {
    await edit();
    expect(controls()).toEqual([
      "Show font picker: Excalifont",
      "Font size 20",
      "Text align",
      "Line spacing 1.25",
      "Background",
    ]);
  });

  it("shows today's set for a selected box, not in edit", () => {
    const text = API.createElement({ type: "text", text: "Hello" });
    API.setElements([text]);
    API.setSelectedElements([text]);
    // YAZ-4403 (4G, D20): lettered text swatches name their job, and the
    // box fill is on the main bar after the highlight
    expect(controls()).toEqual([
      "Show font picker: Excalifont",
      "Font size 20",
      "Text black",
      "Text red",
      "Text blue",
      "Stroke: more",
      "Highlight yellow",
      "Highlight green",
      "Highlight blue",
      "Highlight: more",
      "Fill yellow",
      "Fill blue",
      "Fill black",
      "Background: more",
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "List",
      "Text align",
      "Line spacing 1.25",
      "More properties",
    ]);
  });

  it("a font size change in edit resizes the box and places the editor on it again", async () => {
    const { text, editor } = await edit();
    const root = editor.closest<HTMLElement>(".excalidraw-host-text-editor")!;
    const before = { rootHeight: root.style.height };
    const input = exactFontSizeInput();
    act(() => {
      fireEvent.change(input, { target: { value: "40" } });
      fireEvent.keyDown(input, { key: KEYS.ENTER });
    });
    const box = h.elements[0] as ExcalidrawTextElement;
    expect(box.fontSize).toBe(40);
    // 40 px × line height 1.25
    expect(box.height).toBe(50);
    expect(root.style.height).toBe(`${box.height}px`);
    expect(root.style.height).not.toBe(before.rootHeight);
    // the edit stays open
    expect(h.state.editingTextElement?.id).toBe(text.id);
  });
});
