import React from "react";
import { vi, type Mock } from "vitest";

import { KEYS } from "@excalidraw/common";
import { getTextElementStyledLayout } from "@excalidraw/element";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
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
 * YAZ-4399 (1I): during an edit, ⌘← / ⌘→ go to the start and the end of
 * the line the canvas draws (after the bullet on an item's first line),
 * ⌘↑ / ⌘↓ to the start (after the marker) and the end of the caret's line
 * (D35: they never leave it; an item with children folds instead, D9).
 * ⌘⇧← / ⌘⇧→ extend; ⌘⇧↑ / ⌘⇧↓ do nothing (D37). ⇧↑ / ⇧↓ select by line as
 * a note does (D37). The keys
 * are the Mac's only, so this file runs as a Mac (⌘ is CTRL_OR_CMD).
 */
vi.hoisted(() => {
  // before any engine module reads it: `isDarwin`, ⌘ as CTRL_OR_CMD
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    get: () => "MacIntel",
  });
});

unmountComponent();

const h = window.h;

type Mounted = Parameters<HostTextEditor["mount"]>[0] & {
  input: HTMLDivElement;
  session: HostTextEditorSession & {
    setSelection: Mock<(s: HostTextSelection) => void>;
  };
};
let mounted: Mounted[] = [];

const textEditor: HostTextEditor = {
  mount: (options) => {
    const input = document.createElement("div");
    input.tabIndex = 0;
    options.root.appendChild(input);
    const session = {
      setSelection: vi.fn<(s: HostTextSelection) => void>(),
      replaceText: vi.fn(),
      clearLetterStyles: vi.fn(),
      setFolds: vi.fn(),
      focus: () => input.focus(),
      destroy: vi.fn(),
    };
    mounted.push({ ...options, input, session });
    return session;
  },
};

const last = () => mounted[mounted.length - 1];

/** A box 50 board px wide: the tests' canvas draws 10 px a letter. */
const startEdit = async (text: string, width?: number) => {
  const element = {
    ...API.createElement({
      type: "text",
      text,
      x: 30,
      y: 40,
      fontSize: 20,
      textAlign: "left",
    }),
    ...(width ? { autoResize: false, width } : {}),
  } as ExcalidrawTextElement;
  API.setElements([element]);
  API.setSelectedElements([element]);
  Keyboard.keyPress(KEYS.ENTER);
  await waitFor(() => expect(mounted.length).toBe(1));
  return h.elements[0] as ExcalidrawTextElement;
};

const caretAt = (anchor: number, head = anchor) =>
  act(() => last().onSelectionChange({ anchor, head }));

/** ⌘ + `key`; false when the engine took it (default prevented). */
const pressCmd = (key: string, shiftKey = false) =>
  fireEvent.keyDown(last().input, { key, metaKey: true, shiftKey });

describe("⌘ and the arrow keys in edit (YAZ-4399)", () => {
  beforeEach(async () => {
    mounted = [];
    await render(
      <Excalidraw handleKeyboardGlobally={true} textEditor={textEditor} />,
    );
  });

  it("⌘← and ⌘→ go to the start and the end of the drawn line, not of the text line", async () => {
    const box = await startEdit("aaaa bbbb cccc", 50);
    const { lines } = getTextElementStyledLayout(box, box.width);
    expect(lines.length).toBeGreaterThan(2);
    const middle = lines[1];
    caretAt(middle.start + 2);

    expect(pressCmd(KEYS.ARROW_LEFT)).toBe(false);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: middle.start,
      head: middle.start,
    });
    expect(pressCmd(KEYS.ARROW_RIGHT)).toBe(false);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: middle.end,
      head: middle.end,
    });
  });

  it("⌘⇧← and ⌘⇧→ extend the selection from its anchor", async () => {
    const box = await startEdit("aaaa bbbb cccc", 50);
    const middle = getTextElementStyledLayout(box, box.width).lines[1];
    caretAt(middle.start + 2);
    pressCmd(KEYS.ARROW_LEFT, true);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: middle.start + 2,
      head: middle.start,
    });
    pressCmd(KEYS.ARROW_RIGHT, true);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: middle.start + 2,
      head: middle.end,
    });
  });

  it("⌘↑ and ⌘↓ stay in the caret's line: its start and its end (D35)", async () => {
    await startEdit("one\ntwo\nthree");
    caretAt(5);
    expect(pressCmd(KEYS.ARROW_UP)).toBe(false);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 4,
      head: 4,
    });
    expect(pressCmd(KEYS.ARROW_DOWN)).toBe(false);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 7,
      head: 7,
    });
    // at the end of the line already: ⌘↓ does not go on to the next line
    caretAt(7);
    pressCmd(KEYS.ARROW_DOWN);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 7,
      head: 7,
    });
    // at the start already: ⌘↑ does not go back to the line before
    caretAt(4);
    pressCmd(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 4,
      head: 4,
    });
  });

  it("⌘↑ and ⌘↓ on a wrapped line go to the start and the end of the whole line, not of the drawn line (D35)", async () => {
    const box = await startEdit("aaaa bbbb cccc\nnext", 50);
    const { lines } = getTextElementStyledLayout(box, box.width);
    // "aaaa bbbb cccc" draws as three lines
    expect(lines.filter((line) => line.logicalLine === 0).length).toBe(3);
    const middle = lines[1];
    caretAt(middle.start + 2);
    pressCmd(KEYS.ARROW_DOWN);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 14,
      head: 14,
    });
    caretAt(middle.start + 2);
    pressCmd(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 0,
      head: 0,
    });
  });

  it("⌘↑ on a list item with no children goes to just after its marker; ⌘↓ to its end (D35)", async () => {
    await startEdit("• one\n    ○ three\n• two words\n1. four");
    // in "two"
    caretAt(22);
    pressCmd(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 20,
      head: 20,
    });
    pressCmd(KEYS.ARROW_DOWN);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 29,
      head: 29,
    });
    // a nested item: after its indent and its marker
    caretAt(15);
    pressCmd(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 12,
      head: 12,
    });
    // a numbered item
    caretAt(35);
    pressCmd(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 33,
      head: 33,
    });
  });

  it("⌘← on a bullet's first line goes to just after the bullet", async () => {
    await startEdit("• first item\n    ○ next");
    caretAt(8);
    pressCmd(KEYS.ARROW_LEFT);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 2,
      head: 2,
    });
    // a nested item: after its indent and its marker
    caretAt(22);
    pressCmd(KEYS.ARROW_LEFT);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 19,
      head: 19,
    });
  });

  it("leaves ⌘↑ and ⌘↓ on an item with children to the editor's fold keys (D9)", async () => {
    await startEdit("• parent\n    ○ child");
    caretAt(3);
    pressCmd(KEYS.ARROW_UP);
    pressCmd(KEYS.ARROW_DOWN);
    // the engine moves no caret: the editor folds and unfolds
    expect(last().session.setSelection).not.toHaveBeenCalled();
    // a line with no children: the engine's ⌘↑ and ⌘↓, in that line (D35)
    caretAt(17);
    pressCmd(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 15,
      head: 15,
    });
    pressCmd(KEYS.ARROW_DOWN);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 20,
      head: 20,
    });
  });
});

/**
 * `key` with ⇧ only; false when the engine took it (default prevented). The
 * selection the engine sets comes back, as the real editor reports it.
 */
const pressShift = (key: string) => {
  const { setSelection } = last().session;
  const calls = setSelection.mock.calls.length;
  const result = fireEvent.keyDown(last().input, { key, shiftKey: true });
  if (setSelection.mock.calls.length > calls) {
    const { anchor, head } = setSelection.mock.lastCall![0];
    caretAt(anchor, head);
  }
  return result;
};

describe("⇧↑ and ⇧↓ select by line, to a line's end or its text start (YAZ-4399, D37 as amended in demo round 2)", () => {
  beforeEach(async () => {
    mounted = [];
    await render(
      <Excalidraw handleKeyboardGlobally={true} textEditor={textEditor} />,
    );
  });

  it("from mid-line: first the rest of the line, then each next line's end; back by text starts, never past the anchor", async () => {
    await startEdit("hidden 1\nhidden 2\nhidden 3");
    // "hidd|en 1"
    caretAt(4);
    expect(pressShift(KEYS.ARROW_DOWN)).toBe(false);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 4,
      head: 8,
    });
    pressShift(KEYS.ARROW_DOWN);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 4,
      head: 17,
    });
    // ⇧↑ stops at the start of "hidden 2", never at a line's end
    pressShift(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 4,
      head: 9,
    });
    // no line before: back to the anchor, not past it
    pressShift(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 4,
      head: 4,
    });
    pressShift(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 4,
      head: 0,
    });
  });

  it("from a line's start: that line's end, then the next line's end, never a line's start", async () => {
    await startEdit("one\ntwo\nthree");
    caretAt(0);
    pressShift(KEYS.ARROW_DOWN);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 0,
      head: 3,
    });
    pressShift(KEYS.ARROW_DOWN);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 0,
      head: 7,
    });
  });

  it("at the last line's end ⇧↓ changes nothing", async () => {
    await startEdit("one\ntwo");
    caretAt(2, 7);
    expect(pressShift(KEYS.ARROW_DOWN)).toBe(false);
    expect(last().session.setSelection).not.toHaveBeenCalled();
  });

  it("goes by the whole line, not by the drawn line, on a wrapped line", async () => {
    const box = await startEdit("aaaa bbbb cccc\nnext", 50);
    const { lines } = getTextElementStyledLayout(box, box.width);
    expect(lines.filter((line) => line.logicalLine === 0).length).toBe(3);
    caretAt(lines[1].start + 2);
    pressShift(KEYS.ARROW_DOWN);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: lines[1].start + 2,
      head: 14,
    });
    // plain ↓ still goes by the drawn line
    caretAt(lines[1].start + 2);
    fireEvent.keyDown(last().input, { key: KEYS.ARROW_DOWN });
    const { anchor, head } = last().session.setSelection.mock.lastCall![0];
    expect(anchor).toBe(head);
    expect(head).toBeGreaterThanOrEqual(lines[2].start);
    expect(head).toBeLessThanOrEqual(lines[2].end);
  });

  it("a list item's line starts after its marker", async () => {
    // "• one" 0-5, "• two" 6-11, "    ○ three" 12-23
    await startEdit("• one\n• two\n    ○ three");
    caretAt(2);
    pressShift(KEYS.ARROW_DOWN);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 2,
      head: 5,
    });
    pressShift(KEYS.ARROW_DOWN);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 2,
      head: 11,
    });
    // ⇧↑ from mid "two": to just after its marker
    caretAt(9);
    pressShift(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 9,
      head: 8,
    });
  });

  it("the highlight covers letters only: never an item's indent or marker", async () => {
    await startEdit("• one\n• two\n    ○ three");
    act(() => last().onSelectionChange({ anchor: 2, head: 23 }));
    const spans = Array.from(
      last().root.parentElement!.querySelectorAll<HTMLElement>(
        ".excalidraw-wysiwyg-selection",
      ),
    );
    const left = (span: HTMLElement) =>
      parseFloat(/translate\(([-\d.]+)px/.exec(span.style.transform)![1]);
    expect(spans).toHaveLength(3);
    // "two" starts after its "• " exactly as "one" does; "three" further in
    expect(left(spans[1])).toBeCloseTo(left(spans[0]), 6);
    expect(left(spans[2])).toBeGreaterThan(left(spans[0]));
  });

  it("⌘⇧↑ and ⌘⇧↓ do nothing (they belong to another app)", async () => {
    await startEdit("one\ntwo\nthree");
    caretAt(5);
    expect(pressCmd(KEYS.ARROW_UP, true)).toBe(false);
    expect(pressCmd(KEYS.ARROW_DOWN, true)).toBe(false);
    expect(last().session.setSelection).not.toHaveBeenCalled();
  });
});
