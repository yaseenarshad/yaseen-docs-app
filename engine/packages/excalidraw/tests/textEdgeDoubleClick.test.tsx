import React from "react";

import { SIDE_RESIZING_THRESHOLD } from "@excalidraw/common";
import { getTextElementStyledLayout } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, render, unmountComponent } from "./test-utils";

import type { ExcalidrawProps } from "../types";

/**
 * YAZ-5771: a double click on the left or right edge of a selected free text
 * snaps its width, like a column edge in a spreadsheet. "shrink" (the
 * default) keeps the line breaks and only gets narrower; "fit" unwraps.
 */

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

const renderBoard = (props: Partial<ExcalidrawProps> = {}) =>
  render(<Excalidraw handleKeyboardGlobally={true} {...props} />);

const PARAGRAPHS =
  "a short one\nthis paragraph is long enough to wrap onto lines";

/** A fixed-width text laid out as the canvas lays it out at `width`. */
const fixedText = (
  overrides: Partial<ExcalidrawTextElement> = {},
  width = 400,
): ExcalidrawTextElement => {
  const base = {
    ...API.createElement({
      type: "text",
      id: "text",
      x: 100,
      y: 100,
      text: PARAGRAPHS,
      textAlign: "left",
    }),
    originalText: PARAGRAPHS,
    autoResize: false,
    width,
    ...overrides,
  } as ExcalidrawTextElement;
  const layout = getTextElementStyledLayout(base, width);
  return { ...base, text: layout.text, height: layout.height };
};

const text = () =>
  h.elements.find((e) => e.id === "text") as ExcalidrawTextElement;

const lineBreaks = (t: ExcalidrawTextElement) =>
  getTextElementStyledLayout(t, t.autoResize ? Infinity : t.width).text;

const setUp = (elements: ExcalidrawElement[]) => {
  API.setElements(elements);
  API.setAppState({ selectedElementIds: { text: true } });
  UI.clickTool("selection");
};

/** Two clicks then the double click, as a person does, at a scene point. */
const doubleClickAtScene = (
  x: number,
  y: number,
  beforeDoubleClick?: () => void,
) => {
  const { zoom, scrollX, scrollY } = h.state;
  const cx = (x + scrollX) * zoom.value;
  const cy = (y + scrollY) * zoom.value;
  mouse.reset();
  mouse.clickAt(cx, cy);
  mouse.clickAt(cx, cy);
  beforeDoubleClick?.();
  mouse.doubleClickAt(cx, cy);
};

/** The selection border a drag resizes from, just outside the box. */
const gap = () => SIDE_RESIZING_THRESHOLD / h.state.zoom.value;
const rightEdge = (t: ExcalidrawTextElement) =>
  [t.x + t.width + gap(), t.y + t.height / 2] as const;
const leftEdge = (t: ExcalidrawTextElement) =>
  [t.x - gap(), t.y + t.height / 2] as const;

describe("double-click a text box edge (YAZ-5771)", () => {
  describe("only shrink (default)", () => {
    beforeEach(async () => {
      await renderBoard();
    });

    it.each([
      ["right", rightEdge],
      ["left", leftEdge],
    ] as const)(
      "the %s edge cuts the empty space and keeps the line breaks",
      (_, edge) => {
        const before = fixedText({}, 400);
        setUp([before]);
        const breaksBefore = lineBreaks(before);
        // the long paragraph wraps: more lines than paragraphs
        expect(breaksBefore.split("\n").length).toBeGreaterThan(2);

        doubleClickAtScene(...edge(before));

        const after = text();
        expect(h.state.editingTextElement).toBe(null);
        expect(after.autoResize).toBe(false);
        expect(after.width).toBeLessThan(before.width);
        expect(after.width).toBeCloseTo(
          getTextElementStyledLayout(before, before.width).width,
          1,
        );
        expect(lineBreaks(after)).toBe(breaksBefore);
        expect(after.text).toBe(before.text);
        expect(after.height).toBe(before.height);
        // left-aligned: the left side stays put
        expect(after.x).toBe(before.x);
      },
    );

    it("never gets wider: a box with nothing to cut does not change and adds no history step", () => {
      const wide = fixedText({}, 400);
      const tight = fixedText(
        {},
        getTextElementStyledLayout(wide, wide.width).width,
      );
      setUp([tight]);
      const before = text();
      let undoSteps = -1;

      doubleClickAtScene(...rightEdge(before), () => {
        undoSteps = (h.history as any).undoStack.length;
      });

      expect(text()).toBe(before);
      expect((h.history as any).undoStack.length).toBe(undoSteps);
      expect(h.state.editingTextElement).toBe(null);
    });

    it("a centered text stays centered", () => {
      const before = fixedText({ textAlign: "center" }, 400);
      setUp([before]);

      doubleClickAtScene(...rightEdge(before));

      const after = text();
      expect(after.width).toBeLessThan(before.width);
      expect(after.x + after.width / 2).toBeCloseTo(
        before.x + before.width / 2,
        4,
      );
    });

    it("works zoomed out: the edge is found at the current zoom", () => {
      const before = fixedText({}, 400);
      setUp([before]);
      API.setAppState({ zoom: { value: 0.25 as any } });

      doubleClickAtScene(...rightEdge(before));

      expect(h.state.editingTextElement).toBe(null);
      expect(text().width).toBeLessThan(400);
      expect(lineBreaks(text())).toBe(lineBreaks(before));
    });

    it("one undo restores the width", () => {
      const before = fixedText({}, 400);
      setUp([before]);

      doubleClickAtScene(...rightEdge(before));
      expect(text().width).toBeLessThan(400);

      Keyboard.undo();

      expect(text().width).toBe(400);
      expect(text().x).toBe(before.x);
      expect(text().autoResize).toBe(false);
    });
  });

  it("fit the text: the right edge unwraps each paragraph", async () => {
    await renderBoard({ textEdgeDoubleClick: "fit" });
    const before = fixedText({}, 120);
    setUp([before]);

    doubleClickAtScene(...rightEdge(before));

    const after = text();
    expect(h.state.editingTextElement).toBe(null);
    expect(after.autoResize).toBe(true);
    expect(after.text).toBe(PARAGRAPHS);
    expect(after.width).toBeGreaterThan(before.width);
  });

  it("fit the text: the left edge does it too, and one undo restores", async () => {
    await renderBoard({ textEdgeDoubleClick: "fit" });
    const before = fixedText({}, 120);
    setUp([before]);

    doubleClickAtScene(...leftEdge(before));
    expect(text().autoResize).toBe(true);

    Keyboard.undo();
    expect(text().autoResize).toBe(false);
    expect(text().width).toBe(120);
  });

  it("a double click inside the box still opens it for typing", async () => {
    await renderBoard();
    const before = fixedText({}, 400);
    setUp([before]);

    doubleClickAtScene(before.x + 20, before.y + before.height / 2);

    await act(async () => {});
    expect(h.state.editingTextElement?.id).toBe("text");
    expect(text().width).toBe(400);
  });

  it("a text inside a shape is not affected", async () => {
    await renderBoard();
    const container = API.createElement({
      type: "rectangle",
      id: "box",
      x: 100,
      y: 100,
      width: 400,
      height: 200,
    });
    const bound = {
      ...fixedText({ containerId: "box" }, 380),
      x: 110,
      y: 150,
    } as ExcalidrawTextElement;
    API.setElements([
      { ...container, boundElements: [{ type: "text", id: "text" }] },
      bound,
    ]);
    API.setAppState({ selectedElementIds: { text: true } });
    UI.clickTool("selection");

    doubleClickAtScene(...rightEdge(bound));

    expect(text().width).toBe(380);
  });
});
