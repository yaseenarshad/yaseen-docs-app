import React from "react";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { setNewTextWrapMargin } from "../textCreation";

import { Pointer, UI } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { render } from "./test-utils";

import type { NormalizedZoomValue } from "../types";

const { h } = window;

// YAZ-4247: a new text shows at the app's screen size (16px) at every zoom, and
// a click-started text wraps at the right edge of the visible canvas.
describe("new text size on screen and wrap", () => {
  it.each([
    [0.5, 32],
    [1, 16],
    [2, 8],
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
