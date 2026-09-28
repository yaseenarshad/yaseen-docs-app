import { vi } from "vitest";

import { fireEvent } from "@testing-library/react";

import { LASER_HOLD_MS } from "@excalidraw/common";

import {
  clearAppStateForDatabase,
  clearAppStateForLocalStorage,
  cleanAppStateForExport,
  getDefaultAppState,
} from "../appState";
import { restoreAppState } from "../data/restore";
import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, render, unmountComponent } from "./test-utils";

import type { NormalizedZoomValue } from "../types";

const { h } = window;
const mouse = new Pointer("mouse");

const byTestId = (testId: string) =>
  document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);

/** a laser bar radio (trail mode or size), by its visible label */
const radio = (label: string) =>
  [...document.querySelectorAll(".RadioGroup__choice")]
    .find((choice) => choice.textContent === label)!
    .querySelector("input")!;

const clickClear = () => act(() => byTestId("laser-clear")!.click());

const getPaths = () =>
  [...document.querySelectorAll(".SVGLayer svg path")].filter(
    (path) => !!path.getAttribute("d"),
  ) as SVGPathElement[];

/** bounding box of all rendered laser marks (viewport == scene coords here) */
const getMarksBounds = () => {
  const numbers = getPaths()
    .flatMap((path) => path.getAttribute("d")!.match(/-?\d+(\.\d+)?/g) ?? [])
    .map(Number);
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};

/** horizontal stroke at y=100, one point every `step` px */
const drawStroke = (fromX: number, points: number, step = 10, y = 100) => {
  mouse.downAt(fromX, y);
  for (let index = 1; index < points; index++) {
    mouse.moveTo(fromX + index * step, y);
  }
  mouse.upAt(fromX + (points - 1) * step, y);
};

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

const setLaser = () => {
  act(() => {
    h.app.setActiveTool({ type: "laser" });
  });
};

describe("laser trail settings", () => {
  it("defaults to today's laser and persists only in browser storage", () => {
    const appState = getDefaultAppState();
    expect(appState.laserTrailMode).toBe("fade");
    expect(appState.laserColor).toBe("#ff0000");
    expect(appState.laserSize).toBe("S");

    const custom = {
      ...appState,
      laserTrailMode: "sticky" as const,
      laserColor: "#2979ff" as const,
      laserSize: "L" as const,
    };
    expect(clearAppStateForLocalStorage(custom)).toMatchObject({
      laserTrailMode: "sticky",
      laserColor: "#2979ff",
      laserSize: "L",
    });
    for (const filtered of [
      cleanAppStateForExport(custom),
      clearAppStateForDatabase(custom),
    ]) {
      expect(filtered).not.toHaveProperty("laserTrailMode");
      expect(filtered).not.toHaveProperty("laserColor");
      expect(filtered).not.toHaveProperty("laserSize");
    }
  });

  it("normalises invalid restored values to the defaults", () => {
    expect(
      restoreAppState(
        {
          laserTrailMode: "forever",
          laserColor: "red; background: url(x)",
          laserSize: "XL",
        } as any,
        null,
      ),
    ).toMatchObject({
      laserTrailMode: "fade",
      laserColor: "#ff0000",
      laserSize: "S",
    });

    expect(
      restoreAppState(
        { laserTrailMode: "hold", laserColor: "#00c853", laserSize: "M" },
        null,
      ),
    ).toMatchObject({
      laserTrailMode: "hold",
      laserColor: "#00c853",
      laserSize: "M",
    });

    // only the presets: a custom or upper-case hex resets
    for (const laserColor of ["#123456", "#FF0000"]) {
      expect(restoreAppState({ laserColor } as any, null).laserColor).toBe(
        "#ff0000",
      );
    }
  });
});

describe("laser trail modes", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });
    setLaser();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fade: a stroke is gone about two seconds after it was drawn", () => {
    drawStroke(100, 10);
    expect(getPaths()).toHaveLength(1);

    advance(1100);
    expect(getPaths()).toHaveLength(1);

    advance(1000);
    expect(getPaths()).toHaveLength(0);
  });

  it("hold: keeps strokes at full size until LASER_HOLD_MS after the last activity", () => {
    API.setAppState({ laserTrailMode: "hold" });

    drawStroke(100, 10);
    advance(LASER_HOLD_MS - 1000);
    // full strength: outline is 2 * size (S = 2) tall
    expect(getPaths()).toHaveLength(1);
    expect(getMarksBounds().height).toBeCloseTo(4, 0);
    // held marks don't keep the render loop running; a timer wakes it
    expect(AnimationController.isIdle()).toBe(true);

    // new activity pushes the fade of all Hold strokes back
    drawStroke(100, 10, 10, 300);
    advance(LASER_HOLD_MS - 1000);
    expect(getPaths()).toHaveLength(1);
    expect(getMarksBounds().height).toBeGreaterThan(200);

    advance(1000 + 2100);
    expect(getPaths()).toHaveLength(0);
  });

  it("sticky: strokes persist and don't keep the render loop running", () => {
    API.setAppState({ laserTrailMode: "sticky" });

    drawStroke(100, 10);
    advance(60_000);
    expect(getPaths()).toHaveLength(1);
    expect(getMarksBounds().height).toBeCloseTo(4, 0);
    expect(AnimationController.isIdle()).toBe(true);

    // marks are never scene elements
    expect(h.elements).toHaveLength(0);
  });

  it("sticky: a long stroke (> 50 points) is fully visible", () => {
    API.setAppState({ laserTrailMode: "sticky" });

    drawStroke(100, 100, 5);
    advance(10_000);
    expect(getMarksBounds().minX).toBeLessThan(100);
    expect(getMarksBounds().maxX).toBeGreaterThan(550);
  });

  it("hold: a long stroke (> 100 points) stays whole while held", () => {
    API.setAppState({ laserTrailMode: "hold" });

    drawStroke(100, 150, 4);
    advance(LASER_HOLD_MS - 1000);
    expect(getMarksBounds().minX).toBeLessThan(100);
    expect(getMarksBounds().maxX).toBeGreaterThan(690);
  });

  it("sticky marks stay pinned to the canvas when the viewport scrolls", () => {
    API.setAppState({ laserTrailMode: "sticky" });

    drawStroke(100, 10);
    advance(100);
    const { minX } = getMarksBounds();

    API.setAppState({ scrollX: h.state.scrollX + 50 });
    expect(getMarksBounds().minX).toBeCloseTo(minX + 50, 0);
  });

  it("sticky marks keep their on-screen thickness when zooming", () => {
    API.setAppState({ laserTrailMode: "sticky" });

    drawStroke(100, 10);
    advance(100);
    // the stroke starts at x=100 with a 2px radius
    expect(getMarksBounds().minX).toBeCloseTo(98, 0);

    API.setAppState({ zoom: { value: 2 as NormalizedZoomValue } });
    // pinned to the canvas (x=100 is now at 200), still 2px thick on screen
    expect(getMarksBounds().minX).toBeCloseTo(198, 0);
    expect(getMarksBounds().height).toBeCloseTo(4, 0);
  });

  it("each stroke keeps the colour and size it was drawn with", () => {
    API.setAppState({ laserTrailMode: "sticky" });

    drawStroke(100, 10);
    API.setAppState({ laserColor: "#2979ff", laserSize: "L" });
    drawStroke(100, 10, 10, 300);
    advance(100);

    expect(getPaths().map((path) => path.getAttribute("fill"))).toEqual([
      "#ff0000",
      "#2979ff",
    ]);
    const [first, second] = getPaths().map((path) =>
      path
        .getAttribute("d")!
        .match(/-?\d+(\.\d+)?/g)!
        .map(Number),
    );
    const height = (numbers: number[]) => {
      const ys = numbers.filter((_, index) => index % 2 === 1);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(height(first)).toBeCloseTo(4, 0);
    expect(height(second)).toBeCloseTo(10, 0);
  });

  it("leaving the laser keeps sticky marks", () => {
    API.setAppState({ laserTrailMode: "sticky" });
    drawStroke(100, 10);

    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    advance(60_000);
    expect(getPaths()).toHaveLength(1);

    // and they stay pinned to the canvas while another tool is active
    const { minX } = getMarksBounds();
    API.setAppState({ scrollX: h.state.scrollX + 50 });
    expect(getMarksBounds().minX).toBeCloseTo(minX + 50, 0);
  });

  it("Esc clears the marks and switches to selection; ⌘Z back on the laser restores them", () => {
    API.setAppState({ laserTrailMode: "sticky" });
    drawStroke(100, 10);

    Keyboard.keyPress("Escape");
    advance(20);
    expect(h.state.activeTool.type).toBe("selection");
    expect(getPaths()).toHaveLength(0);

    setLaser();
    Keyboard.undo();
    advance(20);
    expect(getPaths()).toHaveLength(1);
  });

  it("fade and hold marks keep fading after leaving the laser", () => {
    drawStroke(100, 10);
    API.setAppState({ laserTrailMode: "hold" });
    drawStroke(100, 10, 10, 300);

    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    advance(2100);
    // the fade stroke is gone, the hold one is still held
    expect(getPaths()).toHaveLength(1);
    expect(getMarksBounds().height).toBeCloseTo(4, 0);

    advance(LASER_HOLD_MS);
    expect(getPaths()).toHaveLength(0);
  });

  it("Enter keeps the visible fading strokes as sticky marks", () => {
    drawStroke(100, 10);
    Keyboard.keyPress("Enter");

    advance(5000);
    expect(getPaths()).toHaveLength(1);
    expect(getMarksBounds().height).toBeCloseTo(4, 0);
  });

  it("Keep while Hold strokes are still held makes them sticky", () => {
    API.setAppState({ laserTrailMode: "hold" });
    drawStroke(100, 10);
    advance(1000);

    act(() => byTestId("laser-keep")!.click());
    advance(LASER_HOLD_MS * 3);
    expect(getPaths()).toHaveLength(1);
    expect(getMarksBounds().height).toBeCloseTo(4, 0);
  });

  it("the Keep and Clear buttons act on the local marks", () => {
    const keep = byTestId("laser-keep")!;
    const clear = byTestId("laser-clear")!;
    expect(keep).not.toBeNull();
    expect(keep.disabled).toBe(true);
    expect(clear.disabled).toBe(true);

    drawStroke(100, 10);
    expect(keep.disabled).toBe(false);

    act(() => keep.click());
    advance(5000);
    expect(getPaths()).toHaveLength(1);
    expect(keep.disabled).toBe(true);
    expect(clear.disabled).toBe(false);

    act(() => clear.click());
    advance(20);
    expect(getPaths()).toHaveLength(0);
    expect(clear.disabled).toBe(true);
  });

  it("the mode, colour and size controls write the app state", () => {
    act(() => radio("Hold").click());
    act(() => byTestId("laser-color-#d500f9")!.click());
    act(() => radio("M").click());

    expect(h.state.laserTrailMode).toBe("hold");
    expect(h.state.laserColor).toBe("#d500f9");
    expect(h.state.laserSize).toBe("M");
  });

  it("⌘Z restores sticky marks after Clear and ⇧⌘Z clears them again", () => {
    API.setAppState({ laserTrailMode: "sticky" });
    drawStroke(100, 10);
    drawStroke(100, 10, 10, 300);

    clickClear();
    advance(20);
    expect(getPaths()).toHaveLength(0);

    Keyboard.undo();
    advance(20);
    expect(getPaths()).toHaveLength(1);
    expect(getMarksBounds().height).toBeGreaterThan(200);

    // steps back through the strokes one at a time
    Keyboard.undo();
    advance(20);
    expect(getMarksBounds().height).toBeCloseTo(4, 0);

    Keyboard.redo();
    Keyboard.redo();
    advance(20);
    expect(getPaths()).toHaveLength(0);
  });

  it("Clear, then another tool and back to the laser: ⌘Z restores", () => {
    API.setAppState({ laserTrailMode: "sticky" });
    drawStroke(100, 10);
    clickClear();

    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    setLaser();
    Keyboard.undo();
    advance(20);
    expect(getPaths()).toHaveLength(1);
  });

  it("⌘Z while another tool is active undoes the board, not the marks", () => {
    API.setAppState({ laserTrailMode: "sticky" });
    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    UI.createElement("rectangle", { x: 400, y: 400 });
    setLaser();
    drawStroke(100, 10);
    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });

    const undoSteps = h.history.undoStack.length;
    Keyboard.undo();
    advance(20);
    expect(h.history.undoStack.length).toBe(undoSteps - 1);
    expect(getPaths()).toHaveLength(1);
    setLaser();
    expect(byTestId("laser-button-undo")!.disabled).toBe(false);
  });

  it("⌘Z while the laser is active never touches the board history", () => {
    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    const rectangle = UI.createElement("rectangle", { x: 400, y: 400 });
    expect(h.history.isUndoStackEmpty).toBe(false);
    setLaser();

    API.setAppState({ laserTrailMode: "sticky" });
    drawStroke(100, 10);

    Keyboard.undo();
    advance(20);
    expect(getPaths()).toHaveLength(0);
    // nothing left to undo on the laser: still a no-op for the board
    Keyboard.undo();
    Keyboard.undo();

    expect(h.elements).toHaveLength(1);
    expect(h.elements[0].id).toBe(rectangle.id);
    expect(h.elements[0].isDeleted).toBe(false);
    expect(h.history.isUndoStackEmpty).toBe(false);
  });

  it("⇧Enter turns the visible marks into grouped freedraw elements", () => {
    API.setAppState({ laserTrailMode: "sticky" });
    drawStroke(100, 10);
    API.setAppState({ laserTrailMode: "fade", laserColor: "#2979ff" });
    drawStroke(100, 10, 10, 300);
    // a fully faded stroke isn't visible any more, so it isn't converted
    API.setAppState({ laserColor: "#00c853" });
    drawStroke(100, 10, 10, 500);
    advance(2100);
    drawStroke(100, 10, 10, 400);

    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress("Enter");
    });

    const elements = h.elements.filter((element) => !element.isDeleted);
    expect(elements).toHaveLength(2);
    expect(elements.every((element) => element.type === "freedraw")).toBe(true);
    expect(elements.map((element) => element.strokeColor)).toEqual([
      "#ff0000",
      "#00c853",
    ]);
    expect(elements[0].groupIds).toHaveLength(1);
    expect(elements[1].groupIds).toEqual(elements[0].groupIds);
    expect(elements[0]).toMatchObject({
      roughness: 0,
      simulatePressure: false,
      strokeOptions: { variability: "constant" },
      x: 100,
      y: 100,
    });

    // ends on the selection tool with the new strokes selected
    expect(h.state.activeTool.type).toBe("selection");
    expect(Object.keys(h.state.selectedElementIds).sort()).toEqual(
      elements.map((element) => element.id).sort(),
    );

    // the marks left the laser, and laser undo can't bring them back
    advance(20);
    expect(getPaths()).toHaveLength(0);
    setLaser();
    Keyboard.undo();
    advance(20);
    expect(getPaths()).toHaveLength(0);
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(2);

    // one board undo removes them all
    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    Keyboard.undo();
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(0);
  });

  it("⇧Enter does nothing without visible marks", () => {
    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress("Enter");
    });
    expect(h.elements).toHaveLength(0);
    expect(h.state.activeTool.type).toBe("laser");
    expect(byTestId("laser-make-permanent")!.disabled).toBe(true);
  });

  it("⇧Enter sizes the strokes to how thick the marks look on screen", () => {
    API.setAppState({ laserTrailMode: "sticky", laserSize: "L" });
    API.setAppState({ zoom: { value: 2 as NormalizedZoomValue } });
    drawStroke(100, 10);

    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress("Enter");
    });
    // L = 5px on screen at zoom 2 → 2.5 scene px, drawn at strokeWidth * 1.4
    expect(h.elements[0].strokeWidth).toBeCloseTo(5 / 2 / 1.4);
  });

  it("⇧Enter does nothing in view mode", () => {
    API.setAppState({ laserTrailMode: "sticky" });
    drawStroke(100, 10);
    API.setAppState({ viewModeEnabled: true });
    setLaser();

    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress("Enter");
    });
    expect(h.elements).toHaveLength(0);
    advance(20);
    expect(getPaths()).toHaveLength(1);
  });

  it("⌘Enter and ⌥Enter don't keep the marks", () => {
    drawStroke(100, 10);
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress("Enter");
    });
    Keyboard.withModifierKeys({ alt: true }, () => {
      Keyboard.keyPress("Enter");
    });
    advance(5000);
    expect(getPaths()).toHaveLength(0);
  });

  it("Enter and Esc leave the marks alone while another tool is active", () => {
    API.setAppState({ laserTrailMode: "sticky" });
    drawStroke(100, 10);
    API.setAppState({ laserTrailMode: "fade" });
    drawStroke(100, 10, 10, 300);
    act(() => {
      h.app.setActiveTool({ type: "rectangle" });
    });

    Keyboard.keyPress("Enter");
    Keyboard.keyPress("Escape");
    advance(5000);
    // the fade stroke wasn't kept, the sticky one wasn't cleared
    expect(getPaths()).toHaveLength(1);
    expect(getMarksBounds().height).toBeCloseTo(4, 0);
  });

  it("a focused control keeps its own Enter and Esc", () => {
    drawStroke(100, 10);
    const clear = byTestId("laser-clear")!;
    clear.focus();

    // Enter is left to the browser to press the button: no Keep
    expect(fireEvent.keyDown(clear, { key: "Enter" })).toBe(true);
    advance(5000);
    expect(getPaths()).toHaveLength(0);

    // Esc doesn't clear the marks
    API.setAppState({ laserTrailMode: "sticky" });
    drawStroke(100, 10);
    clear.focus();
    fireEvent.keyDown(clear, { key: "Escape" });
    advance(20);
    expect(getPaths()).toHaveLength(1);
  });

  it("resetScene drops the marks and their history", () => {
    API.setAppState({ laserTrailMode: "sticky" });
    drawStroke(100, 10);
    clickClear();

    act(() => h.app.api.resetScene());
    setLaser();
    expect(byTestId("laser-button-undo")!.disabled).toBe(true);
    Keyboard.undo();
    advance(20);
    expect(getPaths()).toHaveLength(0);
  });

  it("the Make permanent button converts the marks", () => {
    drawStroke(100, 10);
    const button = byTestId("laser-make-permanent")!;
    expect(button.disabled).toBe(false);

    act(() => button.click());
    expect(h.elements).toHaveLength(1);
    expect(h.elements[0].type).toBe("freedraw");
    expect(h.state.activeTool.type).toBe("selection");
  });
});

describe("laser undo rule", () => {
  const footerButton = (testId: string) =>
    document.querySelector<HTMLButtonElement>(
      `.layer-ui__wrapper__footer [data-testid="${testId}"]`,
    )!;
  const barButton = (testId: string) =>
    document.querySelector<HTMLButtonElement>(
      `.contextual-properties-toolbar [data-testid="${testId}"]`,
    )!;

  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });
    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });
    API.setAppState({ laserTrailMode: "sticky" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the laser bar's undo/redo don't reuse the footer's test ids", () => {
    expect(barButton("laser-button-undo")).not.toBeNull();
    expect(
      document.querySelectorAll('[data-testid="button-undo"]'),
    ).toHaveLength(1);
  });

  it("the footer undo/redo buttons step the laser history while the laser is active", () => {
    drawStroke(100, 10);
    clickClear();
    advance(20);
    expect(getPaths()).toHaveLength(0);

    expect(footerButton("button-undo").disabled).toBe(false);
    act(() => footerButton("button-undo").click());
    advance(20);
    expect(getPaths()).toHaveLength(1);

    act(() => footerButton("button-redo").click());
    advance(20);
    expect(getPaths()).toHaveLength(0);
  });

  it("the laser bar's undo/redo buttons step the laser history", () => {
    expect(barButton("laser-button-undo").disabled).toBe(true);
    drawStroke(100, 10);
    expect(barButton("laser-button-undo").disabled).toBe(false);
    expect(barButton("laser-button-undo").title).toMatch(/^Undo laser marks/);

    act(() => barButton("laser-button-undo").click());
    advance(20);
    expect(getPaths()).toHaveLength(0);
    expect(barButton("laser-button-redo").disabled).toBe(false);

    act(() => barButton("laser-button-redo").click());
    advance(20);
    expect(getPaths()).toHaveLength(1);
  });

  it("⌘Z with an empty laser history is a no-op for the board", () => {
    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    UI.createElement("rectangle", { x: 400, y: 400 });
    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });

    // the footer shows the laser's (empty) history, not the board's
    expect(footerButton("button-undo").disabled).toBe(true);
    Keyboard.undo();
    act(() => footerButton("button-undo").click());

    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(1);
    expect(h.history.isUndoStackEmpty).toBe(false);
  });

  it("after leaving the laser, the footer undo and ⌘Z act on the board again", () => {
    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });
    UI.createElement("rectangle", { x: 400, y: 400 });
    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });
    drawStroke(100, 10);
    act(() => {
      h.app.setActiveTool({ type: "selection" });
    });

    const undoSteps = h.history.undoStack.length;
    expect(footerButton("button-undo").disabled).toBe(false);
    act(() => footerButton("button-undo").click());
    expect(h.history.undoStack.length).toBe(undoSteps - 1);
    Keyboard.undo();
    expect(h.history.undoStack.length).toBe(undoSteps - 2);
    // the laser history is untouched
    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });
    expect(barButton("laser-button-undo").disabled).toBe(false);
  });

  it("laser undo works in view mode", () => {
    drawStroke(100, 10);
    API.setAppState({ viewModeEnabled: true });
    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });
    Keyboard.keyPress("Escape");
    advance(20);
    expect(getPaths()).toHaveLength(0);

    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });
    Keyboard.undo();
    advance(20);
    expect(getPaths()).toHaveLength(1);
  });

  it("unmounting drops the laser history", () => {
    drawStroke(100, 10);
    const { laserTrails } = h.app;
    expect(laserTrails.getSnapshot().canUndo).toBe(true);

    unmountComponent();
    expect(laserTrails.getSnapshot().canUndo).toBe(false);
  });
});
