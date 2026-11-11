import React from "react";
import { vi, type Mock } from "vitest";

import { KEYS, sceneCoordsToViewportCoords } from "@excalidraw/common";

import type {
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { restoreElements } from "../data/restore";
import { Excalidraw } from "../index";
import { setKeyBindings } from "../keyRemap";
import { CARET_SCREEN_PX, getCaretWidth } from "../wysiwyg/hostTextWysiwyg";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import {
  act,
  createEvent,
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

import type { KeyChord } from "../keyRemap";
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
    clearLetterStyles: Mock<() => void>;
    setFolds: Mock<(lines: readonly number[]) => void>;
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
      clearLetterStyles: vi.fn<() => void>(),
      setFolds: vi.fn<(lines: readonly number[]) => void>(),
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

/**
 * YAZ-4396 (1F): the board-px rectangle an overlay node is placed on, read
 * back from its `transform: translate() scale()` (a 1 px node).
 */
const overlayRect = (node: HTMLElement) => {
  const match =
    /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\((-?[\d.e-]+), (-?[\d.e-]+)\)/.exec(
      node.style.transform,
    );
  if (!match) {
    throw new Error(`not placed by a transform: "${node.style.transform}"`);
  }
  const [left, top, width, height] = match.slice(1).map(Number);
  return { left, top, width, height };
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
    // YAZ-4396 (1F): the root is fixed, so it sits at the box's place in the
    // window; the browser's caret reveal then scrolls none of the board's layers
    expect(root.style.position).toBe("fixed");
    expect(root.style.left).toBe(`${x}px`);
    expect(root.style.top).toBe(`${y}px`);
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

  // YAZ-4346 (4F): the color letters are for a selection; in edit they are typed letters
  it("leaves letters typed in the editor to the editor: no color letter, no tool key", async () => {
    await startEdit();
    const before = { ...box() };
    for (const key of ["r", "R", "g", "b", "t"]) {
      fireEvent.keyDown(last().input, { key, code: `Key${key.toUpperCase()}` });
    }
    expect(box().strokeColor).toBe(before.strokeColor);
    expect(box().backgroundColor).toBe(before.backgroundColor);
    expect(h.state.activeTool.type).toBe("selection");
    expect(h.state.editingTextElement).not.toBe(null);
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

  it.each([0.1, 1, 16.93, 100])(
    "draws the caret 1.5 px on screen at zoom %s",
    async (zoom) => {
      API.setAppState({ zoom: { value: zoom as any } });
      await startEdit();
      act(() => last().onSelectionChange({ anchor: 3, head: 3 }));
      const caret = last().root.parentElement!.querySelector<HTMLElement>(
        ".excalidraw-host-text-editor-overlay .excalidraw-wysiwyg-caret",
      )!;
      // YAZ-4396 (1F): a 1 px node scaled by a transform: layout would snap
      // a 0.05 px width to 0 or to 1 board px (30 px on screen at 3000%)
      expect(caret.style.width).toBe("1px");
      expect(overlayRect(caret).width).toBeCloseTo(CARET_SCREEN_PX / zoom, 10);
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

/** YAZ-4345 (D15): ⌘\ in edit resets the selected letters, the box editor's job. */
describe("⌘\\ in edit (YAZ-4345, the in-edit half)", () => {
  beforeEach(async () => {
    mounted = [];
    await render(
      <Excalidraw handleKeyboardGlobally={true} textEditor={textEditor} />,
    );
  });

  it("asks the editor to clear the letter styles, and the board sees no key", async () => {
    await startEdit();
    const event = fireEvent.keyDown(last().input, {
      key: "\\",
      code: "Backslash",
      ctrlKey: true,
    });
    expect(event).toBe(false);
    expect(last().session.clearLetterStyles).toHaveBeenCalledTimes(1);
    // the edit stays open
    expect(h.state.editingTextElement).not.toBe(null);
  });

  it("takes the user's key for it from Settings › Hotkeys, and ⌘\\ then does nothing", async () => {
    const chord = (code: string, key: string, mods: Partial<KeyChord>) => ({
      code,
      key,
      name: key.toUpperCase(),
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    });
    setKeyBindings([
      {
        name: "clearSelectedTextFormatting",
        defaults: [chord("Backslash", "\\", { ctrlKey: true })],
        keys: [chord("KeyK", "k", { ctrlKey: true, altKey: true })],
      },
    ]);
    try {
      await startEdit();
      fireEvent.keyDown(last().input, {
        key: "\\",
        code: "Backslash",
        ctrlKey: true,
      });
      expect(last().session.clearLetterStyles).not.toHaveBeenCalled();
      fireEvent.keyDown(last().input, {
        key: "k",
        code: "KeyK",
        ctrlKey: true,
        altKey: true,
      });
      expect(last().session.clearLetterStyles).toHaveBeenCalledTimes(1);
    } finally {
      setKeyBindings([]);
    }
  });
});

/** YAZ-4306: folds in edit. The editor keeps the folds; the engine writes them and keeps the caret out. */
describe("folds in edit (YAZ-4306)", () => {
  beforeEach(async () => {
    mounted = [];
    await render(
      <Excalidraw handleKeyboardGlobally={true} textEditor={textEditor} />,
    );
  });

  const FOLDED = "• a\n    ○ b\n    ○ c\n• d";

  const editFolded = async () => {
    const element = {
      ...API.createElement({ type: "text", text: FOLDED, x: 30, y: 40 }),
      foldedLines: [0],
    } as NonDeleted<ExcalidrawTextElement>;
    API.setElements([element]);
    API.setSelectedElements([element]);
    Keyboard.keyPress(KEYS.ENTER);
    await waitFor(() => expect(mounted.length).toBe(1));
    return element;
  };

  it("gives the editor the box's folds, and writes the folds it reports, as no undo step", async () => {
    await editFolded();
    expect(last().foldedLines).toEqual([0]);
    act(() => last().onFoldsChange([]));
    expect(box().foldedLines).toBeUndefined();
    act(() => last().onFoldsChange([0]));
    expect(box().foldedLines).toEqual([0]);
    // a fold is no undo step: ⌘Z after the edit takes nothing back
    fireEvent.keyDown(last().input, { key: KEYS.ESCAPE });
    Keyboard.undo();
    expect(box().foldedLines).toEqual([0]);
  });

  /** YAZ-4434 (D31): an edit in the app keeps each fold's anchor on its line's text. */
  it("a renamed folded bullet keeps its anchor, so it stays folded after a reload", async () => {
    await editFolded();
    act(() =>
      last().onChange(FOLDED.replace("• a", "• a renamed"), undefined, {
        anchor: 11,
        head: 11,
      }),
    );
    expect(box().foldedLines).toEqual([0]);
    expect(box().foldedLineTexts).toEqual(["a renamed"]);
    const [restored] = restoreElements(
      [box()],
      null,
    ) as ExcalidrawTextElement[];
    expect(restored.foldedLines).toEqual([0]);
  });

  it("Enter above a fold: the editor's report moves the fold and its anchor", async () => {
    await editFolded();
    const next = `• new\n    ○ n\n${FOLDED}`;
    // the editor reports the text, then the fold it moved, in one update
    act(() => {
      last().onChange(next, undefined, { anchor: 5, head: 5 });
      last().onFoldsChange([2]);
    });
    expect(box().foldedLines).toEqual([2]);
    expect(box().foldedLineTexts).toEqual(["a"]);
    // "• new" has a child too, but the reload folds "• a"
    const [restored] = restoreElements(
      [{ ...box(), foldedLines: [0] }],
      null,
    ) as ExcalidrawTextElement[];
    expect(restored.foldedLines).toEqual([2]);
  });

  it("moves a caret out of a hidden line, the way it moved", async () => {
    await editFolded();
    // "• a" is 0..3; the hidden lines are 4..18; "• d" starts at 20
    act(() => last().onSelectionChange({ anchor: 3, head: 3 }));
    act(() => last().onSelectionChange({ anchor: 5, head: 5 }));
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 20,
      head: 20,
    });
    act(() => last().onSelectionChange({ anchor: 20, head: 20 }));
    act(() => last().onSelectionChange({ anchor: 18, head: 18 }));
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 3,
      head: 3,
    });
  });

  /**
   * YAZ-4429: the editor's own list label and fold chevron (Crepe's label
   * stops the pointerdown; the note's zoom puts the caret at the item's start
   * on a click) sit under the press, at a size of their own. The canvas
   * layout places the caret; the editor's own nodes never see the press.
   */
  it("places the caret from the canvas on a press over the editor's own list label, and the label never sees it", async () => {
    await editFolded();
    const label = document.createElement("div");
    label.className = "label-wrapper";
    last().input.appendChild(label);
    const labelPress = vi.fn((event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    const labelClick = vi.fn();
    label.addEventListener("pointerdown", labelPress);
    label.addEventListener("click", labelClick);
    const element = box();
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: element.x, sceneY: element.y },
      h.state,
    );
    // "• a" is the folded item's line, "• d" the drawn line below it
    fireEvent.pointerDown(label, {
      button: 0,
      clientX: x + 31,
      clientY: y + 5,
    });
    fireEvent.pointerUp(window);
    fireEvent.click(label, { button: 0, clientX: x + 31, clientY: y + 5 });
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 3,
      head: 3,
    });
    await nextFrame();
    fireEvent.pointerDown(label, {
      button: 0,
      clientX: x + 31,
      clientY: y + 30,
    });
    fireEvent.pointerUp(window);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 23,
      head: 23,
    });
    expect(labelPress).not.toHaveBeenCalled();
    expect(labelClick).not.toHaveBeenCalled();
  });

  it("folds on a fold arrow click in edit, keeps the edit, and tells the editor", async () => {
    const element = await editFolded();
    const hit = vi.spyOn(h.app, "getFoldArrowTargetAt").mockReturnValue({
      elementId: element.id,
      line: 0,
      onArrow: true,
    } as any);
    try {
      fireEvent.pointerDown(last().root, { button: 0, clientX: 1, clientY: 1 });
      expect(box().foldedLines).toBeUndefined();
      expect(last().session.setFolds).toHaveBeenLastCalledWith([]);
      expect(last().session.setSelection).not.toHaveBeenCalled();
      expect(h.state.editingTextElement).not.toBe(null);
    } finally {
      hit.mockRestore();
    }
  });
});

/** The box's top left on screen (the tests' canvas: 10 px a letter, 25 px a line). */
const boxOnScreen = () =>
  sceneCoordsToViewportCoords({ sceneX: box().x, sceneY: box().y }, h.state);

/** A press at a set time (Chromium's pointerdown has `detail: 0`: the engine counts). */
const pressAt = (
  target: Element,
  clientX: number,
  clientY: number,
  timeStamp: number,
  init: Record<string, unknown> = {},
) => {
  const event = createEvent.pointerDown(target, {
    button: 0,
    clientX,
    clientY,
    ...init,
  });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  fireEvent(target, event);
};
const release = () => fireEvent.pointerUp(window);
const lastSelectionSet = () =>
  last().session.setSelection.mock.calls.at(-1)?.[0];

/** YAZ-4396 (1F): edit a text box at any zoom: the caret, no jump. */
describe("the caret, the selection and the board at any zoom (YAZ-4396)", () => {
  beforeEach(async () => {
    mounted = [];
    await render(
      <Excalidraw handleKeyboardGlobally={true} textEditor={textEditor} />,
    );
  });

  it("places each selection rectangle by a transform, at the canvas geometry", async () => {
    API.setAppState({ zoom: { value: 30 as any } });
    await startEdit("abcdef");
    act(() => last().onSelectionChange({ anchor: 1, head: 4 }));
    const [span] = last().root.parentElement!.querySelectorAll<HTMLElement>(
      ".excalidraw-wysiwyg-selection",
    );
    expect(span.style.width).toBe("1px");
    expect(span.style.height).toBe("1px");
    expect(span.style.transformOrigin).toBe("0 0");
    // "bcd": from 10 to 40 board px, the whole line high
    const rect = overlayRect(span);
    expect(rect.left).toBeCloseTo(10, 6);
    expect(rect.width).toBeCloseTo(30, 6);
    expect(rect.height).toBeCloseTo(25, 6);
  });

  it("YAZ-4902: a colour-run line selected whole is one rect as wide as its drawn letters, at a zoom", async () => {
    API.setAppState({ zoom: { value: 1.25 as any } });
    // the real shape: a 24-letter first line under one colour run, a longer second line
    const text = "(Harbor Lts Proj - #125)\n(Quiet Field Again - #131)";
    const plain = API.createElement({
      type: "text",
      text,
      x: 30,
      y: 40,
      fontSize: 12,
      textAlign: "left",
    });
    const element = {
      ...plain,
      textRuns: [{ start: 0, end: 24, color: "#1971c2" }],
    } as NonDeleted<ExcalidrawTextElement>;
    API.setElements([element]);
    API.setSelectedElements([element]);
    Keyboard.keyPress(KEYS.ENTER);
    await waitFor(() => expect(mounted.length).toBe(1));
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: element.x, sceneY: element.y },
      h.state,
    );
    // a drag from the first letter to past the line's end, and a triple
    // click, both select the whole line from the canvas layout
    fireEvent.pointerDown(last().root, {
      button: 0,
      clientX: x + 1,
      clientY: y + 5,
    });
    fireEvent.pointerMove(window, { clientX: x + 500, clientY: y + 5 });
    fireEvent.pointerUp(window, { clientX: x + 500, clientY: y + 5 });
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 0,
      head: 24,
    });
    for (let press = 0; press < 3; press++) {
      fireEvent.pointerDown(last().root, {
        button: 0,
        clientX: x + 40,
        clientY: y + 5,
        timeStamp: 1000 + press,
      });
      fireEvent.pointerUp(window, { clientX: x + 40, clientY: y + 5 });
    }
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 0,
      head: 24,
    });
    // the highlight: one rect over the first line, 24 letters of 10 px
    act(() => last().onSelectionChange({ anchor: 0, head: 24 }));
    const spans = last().root.parentElement!.querySelectorAll<HTMLElement>(
      ".excalidraw-wysiwyg-selection",
    );
    expect(spans.length).toBe(1);
    const rect = overlayRect(spans[0]);
    expect(rect.left).toBeCloseTo(0, 6);
    expect(rect.width).toBeCloseTo(240, 6);
    expect(rect.top).toBeCloseTo(0, 1);
  });

  it("puts a board layer that scrolls during the edit back, and lets it go after", async () => {
    const layer = document.querySelector<HTMLElement>(".excalidraw-container")!;
    // the app's stylesheet gives it `overflow: hidden`
    layer.style.overflowX = "hidden";
    layer.style.overflowY = "hidden";
    let scrollTop = 0;
    Object.defineProperty(layer, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    await startEdit("abcdef");
    expect(layer.contains(last().root)).toBe(true);

    // the browser reveals the hidden editor's caret: 493 px on a key
    scrollTop = 493;
    fireEvent.scroll(layer);
    expect(layer.scrollTop).toBe(0);

    fireEvent.keyDown(last().input, { key: KEYS.ESCAPE });
    scrollTop = 120;
    fireEvent.scroll(layer);
    expect(layer.scrollTop).toBe(120);
  });
});

/** YAZ-4397 (1G, D25): double and triple click, counted on the press. */
describe("double and triple click in edit (YAZ-4397)", () => {
  beforeEach(async () => {
    mounted = [];
    await render(
      <Excalidraw handleKeyboardGlobally={true} textEditor={textEditor} />,
    );
  });

  it("selects the word on the second press, with no click event", async () => {
    await startEdit("one two three");
    const { x, y } = boxOnScreen();
    pressAt(last().root, x + 52, y + 5, 1000);
    release();
    expect(lastSelectionSet()).toEqual({ anchor: 5, head: 5 });
    pressAt(last().root, x + 52, y + 5, 1200);
    expect(lastSelectionSet()).toEqual({ anchor: 4, head: 7 });
  });

  it("selects the item's text without its indent and bullet on the third press", async () => {
    await startEdit("• one\n    ○ two");
    const { x, y } = boxOnScreen();
    for (const time of [1000, 1100, 1200]) {
      pressAt(last().root, x + 70, y + 30, time);
      release();
    }
    // "    ○ two" starts at 6; its text "two" is 12..15
    expect(lastSelectionSet()).toEqual({ anchor: 12, head: 15 });
  });

  it("selects a plain line without its newline on the third press", async () => {
    await startEdit("one two\nthree");
    const { x, y } = boxOnScreen();
    for (const time of [1000, 1100, 1200]) {
      pressAt(last().root, x + 12, y + 5, time);
      release();
    }
    expect(lastSelectionSet()).toEqual({ anchor: 0, head: 7 });
  });

  it("counts a press 4 px away as the same click, and one 6 px away or 600 ms later as a new click", async () => {
    await startEdit("one two three");
    const { x, y } = boxOnScreen();
    pressAt(last().root, x + 52, y + 5, 1000);
    release();
    pressAt(last().root, x + 54, y + 8, 1100);
    release();
    // 3.6 px away: a double click
    expect(lastSelectionSet()).toEqual({ anchor: 4, head: 7 });

    pressAt(last().root, x + 52, y + 5, 3000);
    release();
    pressAt(last().root, x + 58, y + 5, 3100);
    release();
    // 6 px away: a caret
    expect(lastSelectionSet()).toEqual({ anchor: 6, head: 6 });

    pressAt(last().root, x + 52, y + 5, 5000);
    release();
    pressAt(last().root, x + 52, y + 5, 5600);
    // 600 ms later: a caret
    expect(lastSelectionSet()).toEqual({ anchor: 5, head: 5 });
  });

  it("a drag after a double click grows by whole words, both ways", async () => {
    await startEdit("one two three");
    const { x, y } = boxOnScreen();
    pressAt(last().root, x + 52, y + 5, 1000);
    release();
    pressAt(last().root, x + 52, y + 5, 1100);
    // a small move inside "two" keeps the word
    fireEvent.pointerMove(window, { clientX: x + 61, clientY: y + 6 });
    expect(lastSelectionSet()).toEqual({ anchor: 4, head: 7 });
    // into "three": up to its end
    fireEvent.pointerMove(window, { clientX: x + 101, clientY: y + 5 });
    expect(lastSelectionSet()).toEqual({ anchor: 4, head: 13 });
    // back into "one": from the end of "two" to the start of "one"
    fireEvent.pointerMove(window, { clientX: x + 12, clientY: y + 5 });
    expect(lastSelectionSet()).toEqual({ anchor: 7, head: 0 });
    release();
  });

  it("a drag after a triple click grows by whole lines", async () => {
    await startEdit("one\ntwo\nthree");
    const { x, y } = boxOnScreen();
    for (const time of [1000, 1100, 1200]) {
      pressAt(last().root, x + 12, y + 5, time);
      if (time < 1200) {
        release();
      }
    }
    expect(lastSelectionSet()).toEqual({ anchor: 0, head: 3 });
    fireEvent.pointerMove(window, { clientX: x + 5, clientY: y + 55 });
    expect(lastSelectionSet()).toEqual({ anchor: 0, head: 13 });
    release();
  });

  it("a press on the board within 8 screen px of the box goes to the edit", async () => {
    API.setAppState({ zoom: { value: 0.5 as any } });
    await startEdit("abcdef");
    // the board press listener is armed a frame after the edit starts
    await nextFrame();
    const { x, y } = boxOnScreen();
    const canvas = GlobalTestState.interactiveCanvas;
    // the box is 60 × 25 board px: 30 × 12.5 on screen
    pressAt(canvas, x + 30 + 6, y + 5, 1000);
    release();
    expect(lastSelectionSet()).toEqual({ anchor: 6, head: 6 });
    expect(h.state.editingTextElement).not.toBe(null);

    last().session.setSelection.mockClear();
    pressAt(canvas, x + 30 + 12, y + 5, 3000);
    release();
    expect(last().session.setSelection).not.toHaveBeenCalled();
  });
});

/** YAZ-4398 (1H): the host's pop-up toolbar anchors on the canvas caret. */
describe("clientRectAt on the mount seam (YAZ-4398)", () => {
  beforeEach(async () => {
    mounted = [];
    await render(
      <Excalidraw handleKeyboardGlobally={true} textEditor={textEditor} />,
    );
  });

  it("gives the screen box of the canvas caret at an offset, and leaves no node behind", async () => {
    API.setAppState({ zoom: { value: 30 as any } });
    await startEdit("abcdef");
    // the tests' DOM has no layout: a placed node's box is its transform's
    const rects = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const { left, top, width, height } = overlayRect(this);
        return {
          left,
          top,
          right: left + width,
          bottom: top + height,
        } as DOMRect;
      });
    try {
      act(() => last().onSelectionChange({ anchor: 3, head: 3 }));
      const overlay = last().root.parentElement!.querySelector(
        ".excalidraw-host-text-editor-overlay",
      )!;
      const caret = overlay.querySelector<HTMLElement>(
        ".excalidraw-wysiwyg-caret",
      )!;
      const drawn = overlayRect(caret);
      const at3 = last().clientRectAt(3)!;
      expect(at3).toEqual({
        left: drawn.left,
        top: drawn.top,
        right: drawn.left + drawn.width,
        bottom: drawn.top + drawn.height,
      });
      expect(last().clientRectAt(6)!.left - at3.left).toBeCloseTo(30, 6);
      // the probe is gone; the drawn caret stays
      expect(overlay.children).toHaveLength(1);
      expect(overlay.firstElementChild).toBe(caret);
    } finally {
      rects.mockRestore();
    }
  });
});

/** YAZ-4401 (2E, D18): folding off: the note's ⌘↑ in the box folds nothing. */
describe("folding off in edit (YAZ-4401)", () => {
  const OFF = {
    openArrows: "off",
    size: 100,
    thickness: "thick",
    minScreenSize: 14,
  } as const;

  it.each([
    { state: "off", result: "undone", foldArrows: OFF, written: undefined },
    { state: "on", result: "written", foldArrows: undefined, written: [0] },
  ] as const)(
    "folding $state: a fold the editor reports is $result",
    async ({ foldArrows, written }) => {
      mounted = [];
      await render(
        <Excalidraw
          handleKeyboardGlobally={true}
          textEditor={textEditor}
          foldArrows={foldArrows}
        />,
      );
      await startEdit("• a\n    ○ b");
      act(() => last().onFoldsChange([0]));
      expect(box().foldedLines).toEqual(written);
      if (!written) {
        // the editor's fold is undone
        expect(last().session.setFolds).toHaveBeenLastCalledWith([]);
      }
    },
  );
});

/**
 * YAZ-4430: a board that closes during an edit (a reload, a tab switch) ends
 * the edit. Its window listener went on: a press near the old box on the next
 * board was the old edit's, and the new board never saw it.
 */
describe("an edit open when its board closes (YAZ-4430)", () => {
  it("ends the edit, and a press on the next board near the old box is the new board's", async () => {
    mounted = [];
    const first = await render(
      <Excalidraw handleKeyboardGlobally={true} textEditor={textEditor} />,
    );
    await startEdit("abcdef");
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: box().x, sceneY: box().y },
      h.state,
    );
    // the window listener is armed a frame after the edit starts
    await nextFrame();
    const old = last();
    first.unmount();
    expect(old.session.destroy).toHaveBeenCalledTimes(1);

    await render(<Excalidraw handleKeyboardGlobally={true} />);
    const seen = vi.fn();
    const canvas = GlobalTestState.interactiveCanvas;
    canvas.addEventListener("pointerdown", seen);
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: x + 5,
      clientY: y + 5,
    });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(old.session.setSelection).not.toHaveBeenCalled();
  });

  it("takes a press near the box only on its own board", async () => {
    mounted = [];
    await render(
      <Excalidraw handleKeyboardGlobally={true} textEditor={textEditor} />,
    );
    await startEdit("abcdef");
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: box().x, sceneY: box().y },
      h.state,
    );
    await nextFrame();
    // a canvas of another board on the same page, under the box
    const other = document.createElement("canvas");
    document.body.appendChild(other);
    try {
      const seen = vi.fn();
      other.addEventListener("pointerdown", seen);
      fireEvent.pointerDown(other, {
        button: 0,
        clientX: x + 5,
        clientY: y + 5,
      });
      expect(seen).toHaveBeenCalledTimes(1);
      expect(last().session.setSelection).not.toHaveBeenCalled();
      // a press on this board's own canvas just past the box is still the edit's
      fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
        button: 0,
        clientX: x + 5,
        clientY: y + 5,
      });
      expect(last().session.setSelection).toHaveBeenCalledTimes(1);
    } finally {
      other.remove();
    }
  });
});
