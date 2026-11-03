import React from "react";
import { vi, type Mock } from "vitest";

import { KEYS, sceneCoordsToViewportCoords } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { CARET_SCREEN_PX, getCaretWidth } from "../wysiwyg/hostTextWysiwyg";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import {
  act,
  fireEvent,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

import type {
  HostTextEditor,
  HostTextEditorSession,
  HostTextSelection,
} from "../types";

/**
 * YAZ-4277 D1, D10: a text box edits in the host's editor. The engine places
 * the root, keeps drawing the box, draws the caret 1.5 px on screen, and ends
 * the edit on Escape, ⌘Enter and a click outside.
 */

unmountComponent();

const h = window.h;
const mouse = new Pointer("mouse");

type Mounted = Parameters<HostTextEditor["mount"]>[0] & {
  input: HTMLDivElement;
  session: HostTextEditorSession & {
    setSelection: Mock<(s: HostTextSelection) => void>;
    destroy: Mock<() => void>;
  };
};
let mounted: Mounted[] = [];

/** A host editor with no engine of its own: the test types through `onChange`. */
const textEditor: HostTextEditor = {
  mount: (options) => {
    const input = document.createElement("div");
    input.tabIndex = 0;
    input.className = "fake-host-editor";
    options.root.appendChild(input);
    const session = {
      setSelection: vi.fn<(s: HostTextSelection) => void>(),
      replaceText: vi.fn<(start: number, end: number, text: string) => void>(),
      focus: () => input.focus(),
      destroy: vi.fn<() => void>(),
    };
    mounted.push({ ...options, input, session });
    return session;
  },
};

const last = () => mounted[mounted.length - 1];
const box = () => h.elements[0] as ExcalidrawTextElement;

const startEdit = async (text = "Our main Moat:\n• one") => {
  const element = API.createElement({
    type: "text",
    text,
    x: 30,
    y: 40,
    fontSize: 20,
  });
  API.setElements([element]);
  API.setSelectedElements([element]);
  Keyboard.keyPress(KEYS.ENTER);
  await waitFor(() => expect(mounted.length).toBe(1));
  return element;
};

/** The blur that ends the edit is armed a task after the edit starts, the click outside a frame after. */
const nextFrame = () => act(() => new Promise((r) => setTimeout(r, 20)));

describe("the host text editor (textEditor)", () => {
  beforeEach(async () => {
    mounted = [];
    mouse.reset();
    await render(
      <Excalidraw handleKeyboardGlobally={true} textEditor={textEditor} />,
    );
  });

  it("opens the box in the host editor with its text, and the canvas keeps drawing it", async () => {
    const element = await startEdit();
    const { root, text, selection } = last();
    expect(text).toBe("Our main Moat:\n• one");
    // Enter selects the whole text, as the textarea
    expect(selection).toEqual({ anchor: 0, head: text.length });
    expect(root.closest(".excalidraw-textEditorContainer")).not.toBe(null);
    expect(document.querySelector(".excalidraw-wysiwyg")).toBe(null);
    expect(h.state.editingTextElement?.id).toBe(element.id);
    // the renderer does not hide the box in edit: it is the only element
    expect(
      (h.app as unknown as { hasRenderableElements: boolean })
        .hasRenderableElements,
    ).toBe(true);
  });

  it("puts the root on the box: its place, size and zoom", async () => {
    API.setAppState({ zoom: { value: 2 as any } });
    await startEdit();
    const { root } = last();
    const element = box();
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: element.x, sceneY: element.y },
      h.state,
    );
    expect(root.style.left).toBe(`${x - h.state.offsetLeft}px`);
    expect(root.style.top).toBe(`${y - h.state.offsetTop}px`);
    expect(root.style.height).toBe(`${element.height}px`);
    expect(root.style.transform).toContain("scale(2)");
    expect(root.style.whiteSpace).toBe("pre");
  });

  it("edits the box and keeps the text when Escape ends the edit", async () => {
    await startEdit();
    act(() =>
      last().onChange("Our main Moat:\n• one\n• two", undefined, {
        anchor: 0,
        head: 0,
      }),
    );
    expect(box().originalText).toBe("Our main Moat:\n• one\n• two");

    fireEvent.keyDown(last().input, { key: KEYS.ESCAPE });

    expect(h.state.editingTextElement).toBe(null);
    expect(box().originalText).toBe("Our main Moat:\n• one\n• two");
    expect(box().isDeleted).toBe(false);
    expect(last().session.destroy).toHaveBeenCalledTimes(1);
    expect(last().root.isConnected).toBe(false);
    // Escape keeps the box selected
    expect(h.state.selectedElementIds[box().id]).toBe(true);
  });

  it("gives the box the letter styles the host sends, and the host the box's", async () => {
    const element = {
      ...API.createElement({
        type: "text",
        text: "bold here",
        x: 30,
        y: 40,
        fontSize: 20,
      }),
      textRuns: [{ start: 0, end: 4, bold: true as const }],
    };
    API.setElements([element]);
    API.setSelectedElements([element]);
    Keyboard.keyPress(KEYS.ENTER);
    await waitFor(() => expect(mounted.length).toBe(1));
    expect(last().textRuns).toEqual([{ start: 0, end: 4, bold: true }]);
    act(() =>
      last().onChange("bold here", [{ start: 5, end: 9, italic: true }], {
        anchor: 9,
        head: 9,
      }),
    );
    expect(box().textRuns).toEqual([{ start: 5, end: 9, italic: true }]);
  });

  it("ends the edit on ⌘Enter", async () => {
    await startEdit();
    fireEvent.keyDown(last().input, { key: KEYS.ENTER, ctrlKey: true });
    expect(h.state.editingTextElement).toBe(null);
  });

  it("ends the edit when the focus goes out of the editor (a click outside)", async () => {
    await startEdit();
    await nextFrame();
    expect(document.activeElement).toBe(last().input);
    act(() => last().onChange("changed", undefined, { anchor: 0, head: 0 }));

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => outside.focus());

    expect(h.state.editingTextElement).toBe(null);
    expect(box().originalText).toBe("changed");
    outside.remove();
  });

  it("keeps the edit while the toolbar takes the focus", async () => {
    await startEdit();
    await nextFrame();
    const trigger = document.createElement("button");
    trigger.className = "properties-trigger";
    document.body.appendChild(trigger);
    fireEvent.pointerDown(trigger);
    act(() => trigger.focus());
    expect(h.state.editingTextElement).not.toBe(null);
    trigger.remove();
  });

  it("deletes an empty box when the edit ends", async () => {
    await startEdit("x");
    act(() => last().onChange("", undefined, { anchor: 0, head: 0 }));
    fireEvent.keyDown(last().input, { key: KEYS.ESCAPE });
    expect(box().isDeleted).toBe(true);
  });

  it.each([0.1, 1, 16.93])(
    "draws the caret 1.5 px on screen at zoom %s",
    async (zoom) => {
      API.setAppState({ zoom: { value: zoom as any } });
      await startEdit();
      act(() => last().onSelectionChange({ anchor: 3, head: 3 }));
      const caret = last().root.parentElement!.querySelector<HTMLElement>(
        ".excalidraw-host-text-editor-overlay .excalidraw-wysiwyg-caret",
      )!;
      expect(caret.style.width).toBe(`${CARET_SCREEN_PX / zoom}px`);
      expect(getCaretWidth(zoom) * zoom).toBeCloseTo(1.5, 10);
    },
  );

  it("draws a selection with no caret, and a caret with no selection", async () => {
    await startEdit();
    const overlay = last().root.parentElement!.querySelector(
      ".excalidraw-host-text-editor-overlay",
    )!;
    expect(overlay.querySelector(".excalidraw-wysiwyg-caret")).toBe(null);
    expect(
      overlay.querySelectorAll(".excalidraw-wysiwyg-selection").length,
    ).toBe(2);

    act(() => last().onSelectionChange({ anchor: 5, head: 5 }));
    expect(overlay.querySelector(".excalidraw-wysiwyg-selection")).toBe(null);
    expect(overlay.querySelectorAll(".excalidraw-wysiwyg-caret").length).toBe(
      1,
    );
  });

  it("puts the caret where a click on the box lands, from the canvas layout", async () => {
    await startEdit("abcdef");
    const element = box();
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: element.x, sceneY: element.y },
      h.state,
    );
    // 10 px a letter in the test env: 31 px from the start is after "abc"
    fireEvent.pointerDown(last().root, {
      button: 0,
      clientX: x + 31,
      clientY: y + 5,
    });
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 3,
      head: 3,
    });
  });
});
