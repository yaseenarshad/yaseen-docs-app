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
 * ⌘↑ / ⌘↓ to the start and the end of the text, and ⇧ extends. The keys
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

  it("⌘↑ and ⌘↓ go to the start and the end of the text, and ⇧ extends", async () => {
    await startEdit("one\ntwo\nthree");
    caretAt(5);
    expect(pressCmd(KEYS.ARROW_UP)).toBe(false);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 0,
      head: 0,
    });
    expect(pressCmd(KEYS.ARROW_DOWN)).toBe(false);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 13,
      head: 13,
    });
    caretAt(5);
    pressCmd(KEYS.ARROW_DOWN, true);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 5,
      head: 13,
    });
    pressCmd(KEYS.ARROW_UP, true);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 5,
      head: 0,
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
    // a line with no children: the engine's ⌘↑
    caretAt(14);
    pressCmd(KEYS.ARROW_UP);
    expect(last().session.setSelection).toHaveBeenLastCalledWith({
      anchor: 0,
      head: 0,
    });
  });
});
