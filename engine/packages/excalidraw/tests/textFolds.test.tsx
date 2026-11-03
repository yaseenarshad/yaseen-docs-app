import React from "react";

import {
  CaptureUpdateAction,
  newElementWith,
  refreshTextDimensions,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import { Excalidraw } from "../index";
import { serializeAsJSON } from "../data/json";
import { restoreElements } from "../data/restore";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, render, unmountComponent } from "./test-utils";

import type { LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawArrowElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

/**
 * YAZ-4277 D3, D6: a fold lives on the box, resizes it, moves its bound
 * arrows, is no undo step, and survives a save; restore drops a stale one.
 */

unmountComponent();

const h = window.h;

// fontSize 20, line height 1.25: 25px a line
const MOAT =
  "Our main Moat:\n• 1) Automated Pipeline\n    ○ \n• 2) Editing (Power User)\n• 3) Schedule / Posting\n• 4) Server / Rendering Scaling";

const getText = () =>
  h.elements.find(
    (element): element is ExcalidrawTextElement => element.id === "moat",
  )!;
const getArrow = () =>
  h.elements.find(
    (element): element is ExcalidrawArrowElement => element.id === "arrow",
  )!;

const createMoat = (overrides: Partial<ExcalidrawTextElement> = {}) => {
  const text = API.createElement({
    type: "text",
    id: "moat",
    text: MOAT,
    x: 0,
    y: 0,
    fontSize: 20,
    textAlign: "left",
    ...overrides,
  }) as ExcalidrawTextElement;
  return { ...text, ...refreshTextDimensions(text, null, new Map()) };
};

describe("text folds on the board (YAZ-4277 D3, D6)", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("a fold shrinks the box, an unfold grows it, and a bound arrow follows", () => {
    const text = createMoat({
      boundElements: [{ id: "arrow", type: "arrow" }],
    });
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow",
      x: 100,
      y: 300,
      width: 0,
      height: 150,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(0, -150)],
      endBinding: { elementId: "moat", fixedPoint: [0.5001, 1], mode: "orbit" },
    }) as ExcalidrawArrowElement;
    API.setElements([text, arrow]);
    expect(getText().height).toBe(150);
    const tip = () => getArrow().y + getArrow().points[1][1];
    const tipBefore = tip();

    act(() => h.app.setTextFolds("moat", [1]));
    expect(getText().foldedLines).toEqual([1]);
    expect(getText().height).toBe(125);
    expect(getText().text).toBe(MOAT);
    expect(tip()).toBeLessThan(tipBefore);

    act(() => h.app.setTextFolds("moat", []));
    expect(getText().foldedLines).toBeUndefined();
    expect(getText().height).toBe(150);
  });

  it("a fold that is no list item with children changes nothing", () => {
    API.setElements([createMoat()]);
    expect(h.app.setTextFolds("moat", [0, 3])).toBe(false);
    expect(getText().foldedLines).toBeUndefined();
  });

  it("⌘Z after a fold undoes the edit before it, not the fold", () => {
    // NEVER: the box is there before the history starts
    API.updateScene({
      elements: [createMoat()],
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    API.updateScene({
      elements: [newElementWith(getText(), { strokeColor: "#e03131" })],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    act(() => h.app.setTextFolds("moat", [1]));

    Keyboard.undo();
    expect(getText().strokeColor).toBe("#1e1e1e");
    expect(getText().foldedLines).toEqual([1]);
    expect(getText().height).toBe(125);
  });

  it("an undo of a text edit before a fold keeps the box at its visible lines", () => {
    API.updateScene({
      elements: [createMoat()],
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    const edited = `${MOAT}\n    ○ more`;
    API.updateScene({
      elements: [
        newElementWith(getText(), {
          originalText: edited,
          text: edited,
          height: 175,
        }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    act(() => h.app.setTextFolds("moat", [1]));
    expect(getText().height).toBe(150);

    Keyboard.undo();
    expect(getText().originalText).toBe(MOAT);
    expect(getText().foldedLines).toEqual([1]);
    expect(getText().height).toBe(125);
  });

  it("the file keeps the folds", () => {
    API.setElements([createMoat()]);
    act(() => h.app.setTextFolds("moat", [1]));
    const saved = JSON.parse(
      serializeAsJSON(h.elements, h.state, {}, "local"),
    ).elements;
    expect(saved[0].foldedLines).toEqual([1]);
    const [restored] = restoreElements(saved, null) as ExcalidrawTextElement[];
    expect(restored.foldedLines).toEqual([1]);
    expect(restored.height).toBe(125);
  });

  it("restore drops a stale fold, and the box measures all its lines again", () => {
    // an outside edit added a line above the fold; the saved size is folded
    const text = {
      ...createMoat(),
      foldedLines: [1],
      height: 125,
      originalText: `New\n${MOAT}`,
      text: `New\n${MOAT}`,
    };
    const [restored] = restoreElements(
      [text],
      null,
    ) as ExcalidrawTextElement[];
    expect(restored.foldedLines).toBeUndefined();
    expect(restored.height).toBe(175);
  });
});
