import React from "react";

import { KEYS } from "@excalidraw/common";
import { vi } from "vitest";

import {
  CaptureUpdateAction,
  getHiddenLines,
  newElementWith,
  refreshTextDimensions,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import { Excalidraw } from "../index";
import { serializeAsJSON } from "../data/json";
import { restoreElements } from "../data/restore";

import { exportToSvg } from "../scene/export";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import { act, render, unmountComponent, waitFor } from "./test-utils";

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
const mouse = new Pointer("mouse");

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

  it("restore sets the height again when an outside edit changed the lines inside a fold", () => {
    // an agent added two lines under the folded item and wrote the open height
    const edited = MOAT.replace("    ○ ", "    ○ a\n    ○ b\n        ▪ c");
    const text = {
      ...createMoat(),
      foldedLines: [1],
      height: 200,
      originalText: edited,
      text: edited,
    };
    const [restored] = restoreElements([text], null) as ExcalidrawTextElement[];
    expect(restored.foldedLines).toEqual([1]);
    // the four lines outside the fold and the folded item: 5 × 25
    expect(restored.height).toBe(125);
    // a box with no fold is left as it was saved
    const [plain] = restoreElements(
      [{ ...text, foldedLines: undefined, height: 200 }],
      null,
    ) as ExcalidrawTextElement[];
    expect(plain.height).toBe(200);
  });

  it("a folded fixed-width box with a wrong saved height is measured again once the fonts load", async () => {
    const fixed = {
      ...createMoat(),
      autoResize: false,
      width: 600,
      foldedLines: [1],
      height: 400,
    };
    await render(<Excalidraw initialData={{ elements: [fixed] }} />);
    await waitFor(() => expect(getText().height).toBe(125));
    // no undo step
    expect(h.history.isUndoStackEmpty).toBe(true);
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
    const [restored] = restoreElements([text], null) as ExcalidrawTextElement[];
    expect(restored.foldedLines).toBeUndefined();
    expect(restored.height).toBe(175);
  });
});

/**
 * YAZ-4434 (D31): each fold saves its bullet's text too. After an outside
 * edit, restore finds the same bullet by its text (the nearest match), or the
 * fold opens. A wrong bullet never folds.
 */
describe("fold anchors after an outside edit (YAZ-4434, D31)", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  const BOARD = ["• A", "    ○ a1", "• B", "    ○ b1"].join("\n");

  /** Folds "B" on the board and returns the box as the file saves it. */
  const saveWithBFolded = () => {
    API.setElements([createMoat({ text: BOARD })]);
    act(() => h.app.setTextFolds("moat", [2]));
    return JSON.parse(serializeAsJSON(h.elements, h.state, {}, "local"))
      .elements[0];
  };
  const hiddenText = (element: ExcalidrawTextElement) => {
    const hidden = getHiddenLines(element);
    const lines = element.originalText.split("\n");
    return hidden ? [...hidden].map((line) => lines[line]) : [];
  };

  it("the file saves the folded bullet's text beside its line number", () => {
    const saved = saveWithBFolded();
    expect(saved.foldedLines).toEqual([2]);
    expect(saved.foldedLineTexts).toEqual(["B"]);
  });

  it("checker repro: a bullet with a child added above the folded B keeps B folded, not A", () => {
    const saved = saveWithBFolded();
    const edited = `• Z\n    ○ z1\n${BOARD}`;
    const [restored] = restoreElements(
      [{ ...saved, originalText: edited, text: edited }],
      null,
    ) as ExcalidrawTextElement[];
    expect(restored.foldedLines).toEqual([4]);
    expect(restored.foldedLineTexts).toEqual(["B"]);
    expect(hiddenText(restored)).toEqual(["    ○ b1"]);
    // the box measures again: 5 of its 6 lines show
    expect(restored.height).toBe(125);
  });

  it("an outside edit of the folded bullet's own text opens the fold; no other bullet folds", () => {
    const saved = saveWithBFolded();
    const edited = BOARD.replace("• B", "• B renamed");
    const [restored] = restoreElements(
      [{ ...saved, originalText: edited, text: edited }],
      null,
    ) as ExcalidrawTextElement[];
    expect(restored.foldedLines).toBeUndefined();
    expect("foldedLineTexts" in restored).toBe(false);
    expect(hiddenText(restored)).toEqual([]);
    expect(restored.height).toBe(100);
  });

  it("an old file with no anchors keeps the line-number guard", () => {
    const saved = saveWithBFolded();
    delete saved.foldedLineTexts;
    const [restored] = restoreElements(
      [saved],
      null,
    ) as ExcalidrawTextElement[];
    expect(restored.foldedLines).toEqual([2]);
    expect("foldedLineTexts" in restored).toBe(false);
  });

  // YAZ-4439: a text write in the app, from any path, keeps each anchor on
  // its line's text, so the fold stays after a reload
  describe("Edit link and Remove link on the folded bullet's own line (YAZ-4439)", () => {
    const LINKED = ["• A", "    ○ a1", "• See [[Old]]", "    ○ b1"].join("\n");
    const replaceLink = (text: string) => {
      API.setElements([createMoat({ text: LINKED })]);
      act(() => h.app.setTextFolds("moat", [2]));
      const start = LINKED.indexOf("[[Old]]");
      act(() => {
        h.app.replaceHostLinkText("moat", start, start + 7, "[[Old]]", text);
      });
      const saved = JSON.parse(
        serializeAsJSON(h.elements, h.state, {}, "local"),
      ).elements[0];
      return restoreElements([saved], null)[0] as ExcalidrawTextElement;
    };

    it("Edit link: the fold survives a reload", () => {
      const restored = replaceLink("[[New]]");
      expect(restored.foldedLines).toEqual([2]);
      expect(restored.foldedLineTexts).toEqual(["See [[New]]"]);
      expect(hiddenText(restored)).toEqual(["    ○ b1"]);
    });

    it("Remove link: the fold survives a reload", () => {
      const restored = replaceLink("Old");
      expect(restored.foldedLines).toEqual([2]);
      expect(restored.foldedLineTexts).toEqual(["See Old"]);
      expect(hiddenText(restored)).toEqual(["    ○ b1"]);
    });
  });
});

// The Moat box at (100, 100): "• 1) Automated Pipeline" is the line from
// y 125 to 150. Its arrow box is the text size (20) and ends 2 (0.1 × 20)
// left of the bullet: x 78 to 98, y 127.5 to 147.5.
const ARROW = { x: 88, y: 137.5 };

const svgOf = () =>
  exportToSvg(
    h.app.scene.getNonDeletedElements(),
    { exportBackground: false, viewBackgroundColor: "#ffffff" },
    null,
  );
const LINE = { x: 200, y: 137.5 };

describe("fold arrows (YAZ-4277 D5)", () => {
  const renderBoard = async (
    foldArrows?: React.ComponentProps<typeof Excalidraw>["foldArrows"],
  ) => {
    mouse.reset();
    await render(
      <Excalidraw handleKeyboardGlobally={true} foldArrows={foldArrows} />,
    );
    API.setElements([createMoat({ x: 100, y: 100 })]);
  };

  it("a click on the arrow folds and unfolds, with no selection and no edit", async () => {
    await renderBoard();
    mouse.clickAt(ARROW.x, ARROW.y);
    expect(getText().foldedLines).toEqual([1]);
    expect(API.getSelectedElements()).toEqual([]);
    expect(h.state.editingTextElement).toBeNull();

    mouse.clickAt(ARROW.x, ARROW.y);
    expect(getText().foldedLines).toBeUndefined();
    mouse.doubleClickAt(ARROW.x, ARROW.y);
    expect(h.state.editingTextElement).toBeNull();
  });

  it("a click on the line selects the box and does not fold", async () => {
    await renderBoard();
    mouse.clickAt(LINE.x, LINE.y);
    expect(getText().foldedLines).toBeUndefined();
    expect(API.getSelectedElements().map((element) => element.id)).toEqual([
      "moat",
    ]);
  });

  it("hover marks the open item once; a move inside it renders nothing", async () => {
    await renderBoard();
    const renders = vi.spyOn(h.app, "triggerRender");
    mouse.moveTo(LINE.x, LINE.y);
    expect(h.app.getFoldArrowHover()).toEqual({ elementId: "moat", line: 1 });
    mouse.moveTo(LINE.x + 40, LINE.y + 5);
    mouse.moveTo(ARROW.x, ARROW.y);
    expect(renders).toHaveBeenCalledTimes(1);
    mouse.moveTo(LINE.x, 112);
    expect(h.app.getFoldArrowHover()).toBeNull();
    expect(renders).toHaveBeenCalledTimes(2);
  });

  it("no hover mark in Always mode, or on a folded item", async () => {
    await renderBoard({
      openArrows: "always",
      size: 100,
      thickness: "thick",
      minScreenSize: 14,
    });
    mouse.moveTo(LINE.x, LINE.y);
    expect(h.app.getFoldArrowHover()).toBeNull();
    // the arrow still takes the click
    mouse.clickAt(ARROW.x, ARROW.y);
    expect(getText().foldedLines).toEqual([1]);
  });

  it("the SVG export draws ▸ for a folded item and no ▾", async () => {
    await renderBoard();
    const open = await svgOf();
    expect(open.querySelectorAll("path.fold-arrow")).toHaveLength(0);

    act(() => h.app.setTextFolds("moat", [1]));
    const folded = await svgOf();
    const arrows = folded.querySelectorAll("path.fold-arrow");
    expect(arrows).toHaveLength(1);
    // ▸ in its box (x −22 to −2 of the box, centred on line 2's bullet): top left, right point, bottom left
    expect(arrows[0].getAttribute("d")).toBe(
      "M-14.8 31.22 L-9.2 36.22 L-14.8 41.22",
    );
    // the export grows to the left to hold the arrow
    expect(Number(folded.getAttribute("width"))).toBe(
      Number(open.getAttribute("width")) + 22,
    );
  });
});

// "Tasks:" then two items at fontSize 20: line 1 (y 125 to 150) and line 2
// (y 150 to 175). The box (12.4 wide) is centred on the 10 px marker letter:
// x 98.8 to 111.2, y 131.3 to 143.7 on line 1.
const LIST = "Tasks:\n☐ open item\n☑ done item\n    ☑ sub";
const BOX = { x: 105, y: 137.5 };

describe("checklists on the canvas (YAZ-4277 D4)", () => {
  beforeEach(async () => {
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    act(() =>
      API.updateScene({
        elements: [createMoat({ text: LIST, x: 100, y: 100 })],
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    );
  });

  it("a click on the box ticks only that line, as one undo step, with no edit", () => {
    mouse.clickAt(BOX.x, BOX.y);
    expect(getText().originalText).toBe(
      "Tasks:\n☑ open item\n☑ done item\n    ☑ sub",
    );
    expect(h.state.editingTextElement).toBeNull();
    expect(API.getSelectedElements()).toEqual([]);

    mouse.clickAt(BOX.x, BOX.y + 25);
    expect(getText().originalText).toBe(
      "Tasks:\n☑ open item\n☐ done item\n    ☑ sub",
    );

    Keyboard.undo();
    expect(getText().originalText).toBe(
      "Tasks:\n☑ open item\n☑ done item\n    ☑ sub",
    );
    Keyboard.undo();
    expect(getText().originalText).toBe(LIST);
  });

  it("a click on the item's words selects the box and ticks nothing", () => {
    // just right of the box: the test canvas measures a styled line's
    // letters 1 px wide, so the box's hit area ends near x 121
    mouse.clickAt(116, BOX.y);
    expect(getText().originalText).toBe(LIST);
    expect(API.getSelectedElements().map((element) => element.id)).toEqual([
      "moat",
    ]);
  });

  it("the SVG export draws the boxes, a tick on the done one, and the done look", async () => {
    const svg = await svgOf();
    expect(svg.querySelectorAll("rect.checkbox")).toHaveLength(3);
    expect(svg.querySelectorAll("path.checkbox-tick")).toHaveLength(2);
    const words = [...svg.querySelectorAll("tspan")].map((tspan) => [
      tspan.textContent,
      tspan.getAttribute("text-decoration"),
      tspan.getAttribute("fill-opacity"),
    ]);
    // no marker letter is drawn; the done items are struck and dimmed, but
    // not the indent before a nested item's box
    expect(words).toEqual([
      ["open item", null, null],
      ["done item", "line-through", "0.55"],
      ["    ", null, null],
      ["sub", "line-through", "0.55"],
    ]);
  });
});

// LEVELS has two items with children: lines 0 and 1
const LEVELS = "• a\n    ○ a1\n        ▪ a1x\n• b";

describe("⌘↑ / ⌘↓ on selected text boxes (YAZ-4277 D9)", () => {
  const press = (key: string, mods: { shift?: boolean; alt?: boolean } = {}) =>
    Keyboard.withModifierKeys({ ctrl: true, ...mods }, () => {
      Keyboard.keyPress(key);
    });

  const renderWith = async (
    keyBindings?: React.ComponentProps<typeof Excalidraw>["keyBindings"],
  ) => {
    await render(
      <Excalidraw handleKeyboardGlobally={true} keyBindings={keyBindings} />,
    );
    const second = { ...createMoat({ text: LEVELS, y: 300 }), id: "levels" };
    const rect = API.createElement({
      type: "rectangle",
      id: "rect",
      x: 600,
      y: 0,
      width: 100,
      height: 100,
    });
    act(() =>
      API.updateScene({
        elements: [createMoat(), second, rect],
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    );
  };
  const folds = (id: string) =>
    (h.elements.find((element) => element.id === id) as ExcalidrawTextElement)
      .foldedLines;

  it("⌘↑ folds all and ⌘↓ unfolds all in every selected box, as no undo step", async () => {
    await renderWith();
    API.setAppState({ selectedElementIds: { moat: true, levels: true } });
    press(KEYS.ARROW_UP);
    expect(folds("moat")).toEqual([1]);
    expect(folds("levels")).toEqual([0, 1]);
    expect(h.history.isUndoStackEmpty).toBe(true);
    press(KEYS.ARROW_DOWN);
    expect(folds("moat")).toBeUndefined();
    expect(folds("levels")).toBeUndefined();
  });

  it("a mixed selection folds the text boxes, and no flowchart shape is made", async () => {
    await renderWith();
    API.setAppState({ selectedElementIds: { moat: true, rect: true } });
    press(KEYS.ARROW_UP);
    expect(folds("moat")).toEqual([1]);
    expect(h.app.flowchart.pendingNodes).toBeNull();
    expect(h.elements).toHaveLength(3);
  });

  it("a rectangle alone keeps the flowchart key; ⌘⇧↑ aligns and folds nothing", async () => {
    await renderWith();
    API.setAppState({ selectedElementIds: { rect: true } });
    press(KEYS.ARROW_UP);
    expect(h.app.flowchart.pendingNodes?.length).toBeGreaterThan(0);
    expect(folds("moat")).toBeUndefined();

    API.setAppState({ selectedElementIds: { moat: true, levels: true } });
    press(KEYS.ARROW_UP, { shift: true });
    expect(folds("moat")).toBeUndefined();
  });

  it("a rebinding of the notes' fold key applies: the new key folds, the old key no longer does", async () => {
    const chord = (code: string, key: string, alt = false) => ({
      code,
      key,
      name: key,
      metaKey: false,
      ctrlKey: true,
      altKey: alt,
      shiftKey: false,
    });
    await renderWith([
      {
        name: "foldTextBoxes",
        defaults: [chord("ArrowUp", "ArrowUp")],
        keys: [chord("KeyF", "f", true)],
      },
    ]);
    API.setAppState({ selectedElementIds: { moat: true } });
    press(KEYS.ARROW_UP);
    expect(folds("moat")).toBeUndefined();
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.keyPress("f");
    });
    expect(folds("moat")).toEqual([1]);
  });
});

describe("box fill of a fixed-width box (YAZ-4284, YAZ-4277 D11)", () => {
  it("the SVG fill covers the whole box plus its padding, and shrinks with a fold", async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    const fixed = {
      ...createMoat({ backgroundColor: "#ffec99" }),
      autoResize: false,
      width: 600,
    };
    API.setElements([fixed]);
    const fill = async () =>
      (await svgOf()).querySelector("g rect:not(.checkbox)")!;
    // 600 × 150 plus 0.26em (5.2) across and 0.23em (4.6) up and down
    expect((await fill()).getAttribute("width")).toBe("610.4");
    expect((await fill()).getAttribute("height")).toBe("159.2");

    act(() => h.app.setTextFolds("moat", [1]));
    expect((await fill()).getAttribute("height")).toBe("134.2");
    expect((await fill()).getAttribute("width")).toBe("610.4");
  });
});

/**
 * YAZ-4400 (2D, D17): in view mode (Read only, the share viewer) a press
 * pans, so a fold arrow takes its click first. The fold is no undo step and
 * nothing else changes. Checkboxes stay locked.
 */
describe("fold arrows in view mode (YAZ-4400)", () => {
  const renderViewMode = async (text = MOAT) => {
    mouse.reset();
    await render(
      <Excalidraw handleKeyboardGlobally={true} viewModeEnabled={true} />,
    );
    act(() =>
      API.updateScene({
        elements: [createMoat({ text, x: 100, y: 100 })],
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    );
  };

  it("a click on the arrow folds and unfolds, with no selection and no undo step", async () => {
    await renderViewMode();
    const { scrollX, scrollY } = h.state;
    mouse.clickAt(ARROW.x, ARROW.y);
    expect(getText().foldedLines).toEqual([1]);
    expect(API.getSelectedElements()).toEqual([]);
    expect(h.history.isUndoStackEmpty).toBe(true);
    // the press on the arrow did not pan
    expect([h.state.scrollX, h.state.scrollY]).toEqual([scrollX, scrollY]);

    mouse.clickAt(ARROW.x, ARROW.y);
    expect(getText().foldedLines).toBeUndefined();
  });

  it("a press away from an arrow still pans and folds nothing", async () => {
    await renderViewMode();
    const { scrollX, scrollY } = h.state;
    mouse.downAt(LINE.x, LINE.y);
    mouse.moveTo(LINE.x + 40, LINE.y + 30);
    mouse.up();
    expect(h.state.scrollX).toBeCloseTo(scrollX + 40);
    expect(h.state.scrollY).toBeCloseTo(scrollY + 30);
    expect(getText().foldedLines).toBeUndefined();
  });

  it("the hover ▾ shows in view mode", async () => {
    await renderViewMode();
    mouse.moveTo(LINE.x, LINE.y);
    expect(h.app.getFoldArrowHover()).toEqual({ elementId: "moat", line: 1 });
  });

  it("a click on a checkbox ticks nothing", async () => {
    await renderViewMode(LIST);
    mouse.clickAt(BOX.x, BOX.y);
    expect(getText().originalText).toBe(LIST);
  });
});

/**
 * YAZ-4401 (2E, D18): folding off. No arrow takes a click, no fold can be
 * set, and the fold keys do nothing. A box can still open.
 */
describe("folding off (YAZ-4401)", () => {
  const OFF = {
    openArrows: "off",
    size: 100,
    thickness: "thick",
    minScreenSize: 14,
  } as const;

  beforeEach(async () => {
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} foldArrows={OFF} />);
    act(() =>
      API.updateScene({
        elements: [createMoat({ x: 100, y: 100 })],
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    );
  });

  it("says folding is off, and an arrow is no hit", () => {
    expect(h.app.isFoldingOff()).toBe(true);
    expect(h.app.getFoldArrowTargetAt(ARROW)).toBeNull();
    mouse.clickAt(ARROW.x, ARROW.y);
    expect(getText().foldedLines).toBeUndefined();
    mouse.moveTo(LINE.x, LINE.y);
    expect(h.app.getFoldArrowHover()).toBeNull();
  });

  it("setTextFolds refuses a fold, and still opens a box", () => {
    let result: boolean | undefined;
    act(() => {
      result = h.app.setTextFolds("moat", [1]);
    });
    expect(result).toBe(false);
    expect(getText().foldedLines).toBeUndefined();
    // a box folded before folding went off can open
    act(() =>
      API.updateScene({
        elements: [{ ...getText(), foldedLines: [1] }],
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    );
    act(() => {
      h.app.setTextFolds("moat", []);
    });
    expect(getText().foldedLines).toBeUndefined();
  });

  it("the fold keys do nothing", () => {
    API.setAppState({ selectedElementIds: { moat: true } });
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.ARROW_UP);
    });
    expect(getText().foldedLines).toBeUndefined();
  });
});
