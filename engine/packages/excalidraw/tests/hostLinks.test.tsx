import React from "react";
import { vi } from "vitest";

import { registerHostLinkResolver } from "@excalidraw/element";

import { exportToSvg } from "../scene/export";
import { Excalidraw } from "../index";

import { KEYS } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  getStyledVisualLines,
  setCustomTextMetricsProvider,
} from "@excalidraw/element";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import {
  act,
  fireEvent,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

import type {
  ExcalidrawTextElement,
  FontString,
} from "@excalidraw/element/types";

import type { HostLinkHit, HostTextEditor } from "../types";

/**
 * YAZ-4039 D7, D11: `[[inner]]` in a text box is a pill. Hover reports it,
 * a plain click selects the box, the host takes its open gestures, and a
 * right-click on it gives the host's link menu.
 */

unmountComponent();

const mouse = new Pointer("mouse");
const h = window.h;

let labels: Record<string, string> = {};
let notify = () => {};
const hostLinks = {
  resolve: (inner: string) =>
    labels[inner] ? { label: labels[inner] } : { label: inner, missing: true },
  subscribe: (listener: () => void) => {
    notify = listener;
    return () => {};
  },
  onHover: vi.fn<(hit: HostLinkHit | null) => void>(),
  onPointerDown: vi.fn<(hit: HostLinkHit, event: PointerEvent) => boolean>(),
  onContextMenu: vi.fn<(hit: HostLinkHit, event: MouseEvent) => boolean>(),
  pasteLink: (text: string) =>
    text === "/vault/Growth plan.md" ? "[[YAS-1]]" : null,
  onEditorChange: vi.fn<(editor: HostTextEditor | null) => void>(),
  onEditorKeyDown: vi.fn<(event: KeyboardEvent) => boolean>(),
};

// fontSize 20 in the test env: 10px a letter; the pill "Growth plan" is
// 5 + 15 + 4 + 110 + 5 = 139px, from x 40 to 179 on the first line
const PILL = { x: 100, y: 10 };
const WORD = { x: 20, y: 10 };

const addText = () => {
  const text = API.createElement({
    type: "text",
    text: "see [[YAS-1]] now",
    x: 0,
    y: 0,
    width: 219,
    height: 25,
    fontSize: 20,
    textAlign: "left",
  });
  API.setElements([text]);
  return text;
};

describe("link pills on the canvas", () => {
  beforeEach(async () => {
    labels = { "YAS-1": "Growth plan" };
    hostLinks.onHover.mockReset();
    hostLinks.onPointerDown.mockReset().mockReturnValue(false);
    hostLinks.onContextMenu.mockReset().mockReturnValue(true);
    mouse.reset();
    await render(
      <Excalidraw handleKeyboardGlobally={true} hostLinks={hostLinks} />,
    );
  });

  it("reports hover enter and leave once each", () => {
    const text = addText();
    mouse.moveTo(PILL.x, PILL.y);
    mouse.moveTo(PILL.x + 10, PILL.y + 2);
    mouse.moveTo(WORD.x, WORD.y);
    expect(hostLinks.onHover).toHaveBeenCalledTimes(2);
    expect(hostLinks.onHover.mock.calls[0][0]).toMatchObject({
      elementId: text.id,
      inner: "YAS-1",
      start: 4,
      end: 13,
      rect: { left: 40, right: 179 },
    });
    expect(hostLinks.onHover.mock.calls[1][0]).toBeNull();
  });

  it("selects the box on a plain click", () => {
    const text = addText();
    mouse.clickAt(PILL.x, PILL.y);
    expect(hostLinks.onPointerDown).toHaveBeenCalledTimes(1);
    expect(API.getSelectedElements().map((element) => element.id)).toEqual([
      text.id,
    ]);
  });

  it("leaves a press the host takes to the host: no selection", () => {
    addText();
    hostLinks.onPointerDown.mockReturnValue(true);
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      mouse.clickAt(PILL.x, PILL.y);
    });
    expect(hostLinks.onPointerDown.mock.calls[0][0].inner).toBe("YAS-1");
    expect(hostLinks.onPointerDown.mock.calls[0][1].ctrlKey).toBe(true);
    expect(API.getSelectedElements()).toEqual([]);
  });

  it("asks nothing of the host for a click beside the pill", () => {
    addText();
    mouse.clickAt(WORD.x, WORD.y);
    expect(hostLinks.onPointerDown).not.toHaveBeenCalled();
  });

  it("gives the link menu on a pill and the shape menu elsewhere", () => {
    addText();
    mouse.rightClickAt(PILL.x, PILL.y);
    expect(hostLinks.onContextMenu).toHaveBeenCalledTimes(1);
    expect(hostLinks.onContextMenu.mock.calls[0][0].inner).toBe("YAS-1");
    expect(h.state.contextMenu).toBeNull();

    mouse.rightClickAt(WORD.x, WORD.y);
    expect(hostLinks.onContextMenu).toHaveBeenCalledTimes(1);
    expect(h.state.contextMenu).not.toBeNull();
  });

  it("draws the new label when the host says the labels changed", () => {
    addText();
    labels = { "YAS-1": "Plan" };
    notify();
    mouse.moveTo(PILL.x, PILL.y);
    // "Plan": 5 + 15 + 4 + 40 + 5 = 69px
    expect(hostLinks.onHover.mock.calls[0][0]?.rect).toMatchObject({
      left: 40,
      right: 109,
    });
  });
});

describe("link pills in an SVG", () => {
  it("draws a pill with its page's name, and a missing page dim with no pill", async () => {
    const unregister = registerHostLinkResolver((inner) =>
      inner === "YAS-1"
        ? { label: "Growth plan" }
        : { label: inner, missing: true },
    );
    try {
      const text = API.createElement({
        type: "text",
        text: "[[YAS-1]] [[Gone]]",
        fontSize: 20,
      });
      const svg = await exportToSvg(
        [text],
        { exportBackground: false, viewBackgroundColor: "#ffffff" },
        null,
      );
      const tspans = [...svg.querySelectorAll("tspan")];
      expect(tspans.map((tspan) => tspan.textContent)).toEqual([
        "Growth plan",
        " ",
        "Gone",
      ]);
      expect(tspans[0].getAttribute("fill")).toBe("#5b6cff");
      expect(tspans[2].getAttribute("fill")).toBe("#7a7a7a");
      // one pill background (the found page), two icons
      expect(svg.querySelectorAll("g rect[rx]")).toHaveLength(1);
      expect(svg.querySelectorAll("g path[fill='none']")).toHaveLength(2);
    } finally {
      unregister();
    }
  });
});

/** YAZ-4039 D12, D15: make and edit a link in the text editor. */
describe("links in the text editor", () => {
  beforeEach(async () => {
    labels = { "YAS-1": "Growth plan" };
    hostLinks.onEditorChange.mockReset();
    hostLinks.onEditorKeyDown.mockReset().mockReturnValue(false);
    hostLinks.onContextMenu.mockReset().mockReturnValue(true);
    mouse.reset();
    await render(
      <Excalidraw handleKeyboardGlobally={true} hostLinks={hostLinks} />,
    );
  });

  const edit = async () => {
    const text = addText();
    API.setSelectedElements([text]);
    Keyboard.keyPress(KEYS.ENTER);
    return { text, editor: await getTextEditor() };
  };
  const textOf = (id: string) =>
    (h.elements.find((element) => element.id === id) as ExcalidrawTextElement)
      .originalText;
  const moveCaret = (editor: HTMLTextAreaElement, offset: number) => {
    editor.setSelectionRange(offset, offset);
    fireEvent(document, new Event("selectionchange"));
  };

  it("reports `[[` to the host's picker, and a pick writes `[[ID]]`", async () => {
    const { text, editor } = await edit();
    updateTextEditor(editor, "see [[Gro");
    const typed = hostLinks.onEditorChange.mock.calls
      .map(([state]) => state)
      .filter((state) => state?.typed)
      .at(-1)!;
    expect(typed).toMatchObject({ text: "see [[Gro", caret: 9 });
    typed.replace(4, 9, "[[YAS-1]]");
    expect(editor.value).toBe("see [[YAS-1]]");
    expect(editor.selectionStart).toBe(13);
    expect(textOf(text.id)).toBe("see [[YAS-1]]");
  });

  it("puts a new page's ID in the link, in the open editor and in the saved box", async () => {
    const { text, editor } = await edit();
    moveCaret(editor, 2);
    const state = hostLinks.onEditorChange.mock.calls.at(-1)![0]!;
    expect(state.replaceLink("[[YAS-1]]", "[[Notes]]")).toBe(true);
    expect(editor.value).toBe("see [[Notes]] now");
    // the caret stays where the user left it
    expect(editor.selectionStart).toBe(2);
    Keyboard.exitTextEditor(editor);
    expect(state.replaceLink("[[Notes]]", "[[YAS-1]]")).toBe(true);
    expect(textOf(text.id)).toBe("see [[YAS-1]] now");
    expect(state.replaceLink("[[Gone]]", "[[X]]")).toBe(false);
  });

  it("lets the host's open picker take its keys", async () => {
    const { editor } = await edit();
    hostLinks.onEditorKeyDown.mockReturnValue(true);
    expect(fireEvent.keyDown(editor, { key: KEYS.ESCAPE })).toBe(false);
    // the editor stayed open: Esc was the picker's
    expect(await getTextEditor({ waitForEditor: false })).not.toBeNull();
  });

  it("turns a pasted page path into a link", async () => {
    const { text, editor } = await edit();
    moveCaret(editor, 0);
    document.elementFromPoint = () => editor;
    fireEvent.paste(editor, {
      clipboardData: {
        items: [{ kind: "string", type: "text/plain" }],
        getData: () => "/vault/Growth plan.md",
      },
    });
    expect(editor.value).toBe("[[YAS-1]]see [[YAS-1]] now");
    expect(textOf(text.id)).toBe("[[YAS-1]]see [[YAS-1]] now");
  });

  it("jumps the caret over the pill, both ways", async () => {
    const { editor } = await edit();
    moveCaret(editor, 4);
    // → from the pill's start lands one letter in: it goes to the end
    moveCaret(editor, 5);
    expect(editor.selectionStart).toBe(13);
    // ← from the end
    moveCaret(editor, 12);
    expect(editor.selectionStart).toBe(4);
    // a caret dropped in the middle goes to the nearer edge
    moveCaret(editor, 7);
    moveCaret(editor, 7);
    expect(editor.selectionStart).toBe(4);
  });

  it("deletes the pill as one unit with Backspace after it or Delete before it", async () => {
    const { editor } = await edit();
    moveCaret(editor, 13);
    // the key selects the whole pill; the browser's own delete removes the selection
    expect(fireEvent.keyDown(editor, { key: KEYS.BACKSPACE })).toBe(true);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([4, 13]);
    moveCaret(editor, 4);
    fireEvent.keyDown(editor, { key: KEYS.DELETE });
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([4, 13]);
    updateTextEditor(editor, "see  now");
    expect(editor.value).toBe("see  now");
  });

  it("lays out a box with a pill once for a keystroke", async () => {
    const { editor } = await edit();
    let measures = 0;
    setCustomTextMetricsProvider({
      getLineWidth: (text) => {
        measures++;
        return text.length * 10;
      },
    });
    try {
      updateTextEditor(editor, "see [[YAS-1]] nowx");
      const keystroke = measures;
      // one more layout of the same text, without the memo
      measures = 0;
      getStyledVisualLines({
        originalText: "see [[YAS-1]] nowx",
        getFont: () => "20px Excalifont" as FontString,
        maxWidth: Infinity,
        textRuns: undefined,
        wholeElementBold: false,
        wholeElementItalic: false,
        wholeElementUnderlined: false,
        wholeElementStrikethrough: false,
      });
      expect(measures).toBeGreaterThan(0);
      expect(keystroke).toBe(measures);
    } finally {
      setCustomTextMetricsProvider({
        getLineWidth: (text) => text.length * 10,
      });
    }
  });

  it("draws the pill in the editor", async () => {
    await edit();
    const pill = document.querySelector(".excalidraw-wysiwyg-link-pill");
    expect(pill?.textContent).toBe("Growth plan");
  });
});

describe("Edit link and Remove link", () => {
  beforeEach(async () => {
    labels = { "YAS-1": "Growth plan" };
    hostLinks.onContextMenu.mockReset().mockReturnValue(true);
    mouse.reset();
    await render(
      <Excalidraw handleKeyboardGlobally={true} hostLinks={hostLinks} />,
    );
  });

  const textOf = (id: string) =>
    (h.elements.find((element) => element.id === id) as ExcalidrawTextElement)
      .originalText;

  it("Edit link puts the new link in place, as one undo step", () => {
    const text = API.createElement({
      type: "text",
      text: "see [[YAS-1]] now",
      width: 219,
      height: 25,
      fontSize: 20,
      textAlign: "left",
    });
    act(() =>
      API.updateScene({
        elements: [text],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );
    mouse.rightClickAt(PILL.x, PILL.y);
    const hit = hostLinks.onContextMenu.mock.calls[0][0];
    act(() => hit.replace!("[[Notes]]"));
    expect(textOf(text.id)).toBe("see [[Notes]] now");
    Keyboard.undo();
    expect(textOf(text.id)).toBe("see [[YAS-1]] now");
  });

  it("Remove link leaves the page's name as plain text, and the box fits it", () => {
    const text = addText();
    mouse.rightClickAt(PILL.x, PILL.y);
    hostLinks.onContextMenu.mock.calls[0][0].replace!("Growth plan");
    const next = h.elements.find(
      (element) => element.id === text.id,
    ) as ExcalidrawTextElement;
    expect(next.originalText).toBe("see Growth plan now");
    // 19 letters at 10px: the text is plain again
    expect(next.width).toBe(190);
  });

  it("gives no Edit or Remove on a read-only board", async () => {
    await render(
      <Excalidraw
        handleKeyboardGlobally={true}
        hostLinks={hostLinks}
        viewModeEnabled={true}
      />,
    );
    addText();
    mouse.rightClickAt(PILL.x, PILL.y);
    expect(hostLinks.onContextMenu.mock.calls.at(-1)![0].replace).toBe(
      undefined,
    );
  });
});

describe("the link box (⌘K)", () => {
  it("turns a pasted page path into the page's `[[ID]]`", async () => {
    await render(
      <Excalidraw handleKeyboardGlobally={true} hostLinks={hostLinks} />,
    );
    const rectangle = API.createElement({ type: "rectangle", width: 100 });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    API.setAppState({ showHyperlinkPopup: "editor" });
    const input = await waitFor(() => {
      const found = document.querySelector<HTMLInputElement>(
        ".excalidraw-hyperlinkContainer-input",
      );
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.change(input, { target: { value: "/vault/Growth plan.md" } });
    fireEvent.keyDown(input, { key: KEYS.ENTER });
    expect(h.elements[0].link).toBe("[[YAS-1]]");
  });
});
