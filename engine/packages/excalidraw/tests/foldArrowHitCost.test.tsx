import React from "react";

import {
  CaptureUpdateAction,
  refreshTextDimensions,
} from "@excalidraw/element";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render, unmountComponent } from "./test-utils";

/**
 * YAZ-4312 N4: each pointer move asks for the fold arrow under the pointer.
 * The app looks only at text boxes with list lines (a list kept for each
 * scene change), not at every element of the board.
 */

unmountComponent();

const h = window.h;

// the Moat box at (100, 100): its first item's arrow is at (88, 137.5)
const MOAT =
  "Our main Moat:\n• 1) Automated Pipeline\n    ○ \n• 2) Editing (Power User)";
const ARROW = { x: 88, y: 137.5 };

const textBox = (id: string, text: string, x: number, y: number) => {
  const element = API.createElement({
    type: "text",
    id,
    text,
    x,
    y,
    fontSize: 20,
    textAlign: "left",
  }) as ExcalidrawTextElement;
  return { ...element, ...refreshTextDimensions(element, null, new Map()) };
};

/** `element` with a count of each read of its `angle`. */
const counted = <T extends object>(element: T, reads: { count: number }) => {
  let angle = (element as any).angle;
  return Object.defineProperty({ ...element }, "angle", {
    enumerable: true,
    configurable: true,
    get: () => {
      reads.count++;
      return angle;
    },
    set: (value) => {
      angle = value;
    },
  }) as T;
};

describe("the fold arrow hit on a large board (YAZ-4312 N4)", () => {
  const BOXES = 2000;
  const MOVES = 50;

  it("a pointer move looks at no text box without a list", async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    const reads = { count: 0 };
    const plain = Array.from({ length: BOXES }, (_, index) =>
      counted(
        textBox(`plain-${index}`, `plain text ${index}`, 0, 400 + index * 30),
        reads,
      ),
    );
    API.setElements([textBox("moat", MOAT, 100, 100), ...plain]);

    reads.count = 0;
    for (let move = 0; move < MOVES; move++) {
      h.app.getFoldArrowTargetAt({ x: 500 + move, y: 300 });
    }
    // before: each move read each box (BOXES × MOVES reads)
    expect(reads.count).toBe(0);
    expect(h.app.getFoldArrowTargetAt(ARROW)).toMatchObject({
      elementId: "moat",
      line: 1,
      onArrow: true,
    });
  });

  it("finds a list added after the last move, and none after it is removed", async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    const box = textBox("moat", "plain", 100, 100);
    API.setElements([box]);
    expect(h.app.getFoldArrowTargetAt(ARROW)).toBeNull();

    act(() =>
      API.updateScene({
        elements: [textBox("moat", MOAT, 100, 100)],
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    );
    expect(h.app.getFoldArrowTargetAt(ARROW)).toMatchObject({
      elementId: "moat",
      onArrow: true,
    });

    act(() =>
      API.updateScene({
        elements: [textBox("moat", "plain", 100, 100)],
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    );
    expect(h.app.getFoldArrowTargetAt(ARROW)).toBeNull();
  });
});
