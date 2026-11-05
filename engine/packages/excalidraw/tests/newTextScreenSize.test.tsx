import React from "react";

import { KEYS } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { setNewTextWrapMargin } from "../textCreation";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { fireEvent, render } from "./test-utils";

import type { NormalizedZoomValue } from "../types";

const { h } = window;

// YAZ-4247: a new text shows at the app's screen size (14px by default,
// YAZ-4265) at every zoom, and a click-started text wraps at the right edge of
// the visible canvas.
describe("new text size on screen and wrap", () => {
  it.each([
    [0.5, 28],
    [1, 14],
    [2, 7],
  ])("at zoom %s a new text is %spx", async (zoom, fontSize) => {
    await render(
      <Excalidraw
        initialData={{
          appState: { zoom: { value: zoom as NormalizedZoomValue } },
        }}
      />,
    );
    UI.clickTool("text");
    new Pointer("mouse").clickAt(100, 100);
    expect((h.elements[0] as ExcalidrawTextElement).fontSize).toBe(fontSize);
  });

  it("a click-started text that passes the right edge wraps there", async () => {
    await render(<Excalidraw />);
    UI.clickTool("text");
    new Pointer("mouse").clickAt(h.state.width - 200, 100);
    const editor = await getTextEditor();
    updateTextEditor(editor, "word ".repeat(100));
    const text = h.elements[0] as ExcalidrawTextElement;
    expect(text.autoResize).toBe(false);
    expect(text.x + text.width).toBeLessThanOrEqual(
      h.state.width / h.state.zoom.value - h.state.scrollX + 1,
    );
    expect(text.text).toContain("\n");
  });

  // YAZ-4277: a box that was there keeps its lines when its edit starts and ends
  it("a box that was there and passes the right edge does not wrap", async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    const box = API.createElement({
      type: "text",
      text: "word ".repeat(100),
      x: h.state.width - 200,
      y: 100,
    });
    API.setElements([box]);
    API.setSelectedElements([box]);
    Keyboard.keyPress(KEYS.ENTER);
    const editor = await getTextEditor();
    updateTextEditor(editor, `${"word ".repeat(100)}more`);
    fireEvent.keyDown(editor, { key: KEYS.ESCAPE });
    expect(h.state.editingTextElement).toBe(null);
    const text = h.elements[0] as ExcalidrawTextElement;
    expect(text.autoResize).toBe(true);
    expect(text.text).not.toContain("\n");
  });

  it("the app's margin starts the wrap that far before the edge", async () => {
    setNewTextWrapMargin(120);
    try {
      await render(<Excalidraw />);
      UI.clickTool("text");
      new Pointer("mouse").clickAt(h.state.width - 400, 100);
      const editor = await getTextEditor();
      updateTextEditor(editor, "word ".repeat(100));
      const text = h.elements[0] as ExcalidrawTextElement;
      expect(text.autoResize).toBe(false);
      expect(text.x + text.width).toBeLessThanOrEqual(
        (h.state.width - 120) / h.state.zoom.value - h.state.scrollX + 1,
      );
    } finally {
      setNewTextWrapMargin(0);
    }
  });
});
