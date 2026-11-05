import React from "react";

import { CODES, MAX_ZOOM, MIN_ZOOM } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { actionZoomIn, actionZoomOut } from "../actions/actionCanvas";
import { getNormalizedZoom, getSteppedZoom, getWheelZoom } from "../scene";
import { zoomToFitBounds } from "../viewport";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, fireEvent, GlobalTestState, render } from "./test-utils";

import type { AppState, NormalizedZoomValue } from "../types";

/**
 * YAZ-4405 (4I, D23, D27): the zoom goes from 1% to 10,000%, and each step
 * multiplies it, so a step moves the same amount on screen at any zoom.
 */

const { h } = window;

describe("the zoom range (YAZ-4405)", () => {
  it("is 1% to 10,000%", () => {
    expect(MIN_ZOOM).toBe(0.01);
    expect(MAX_ZOOM).toBe(100);
    expect(getNormalizedZoom(1000)).toBe(100);
    expect(getNormalizedZoom(50)).toBe(50);
    expect(getNormalizedZoom(0.001)).toBe(0.01);
    expect(getNormalizedZoom(0.05)).toBe(0.05);
  });
});

describe("even zoom steps (YAZ-4405)", () => {
  it("multiplies by 1.1 for each button step, and clamps", () => {
    expect(getSteppedZoom(1, 1)).toBeCloseTo(1.1, 6);
    expect(getSteppedZoom(1, -1)).toBeCloseTo(1 / 1.1, 6);
    expect(getSteppedZoom(50, 1)).toBeCloseTo(55, 6);
    expect(getSteppedZoom(0.02, 1)).toBeCloseTo(0.022, 6);
    expect(getSteppedZoom(2, 3)).toBeCloseTo(2 * 1.1 ** 3, 6);
    expect(getSteppedZoom(99, 1)).toBe(100);
    expect(getSteppedZoom(0.0105, -1)).toBe(0.01);
  });

  it("multiplies by exp(-0.01 × deltaY) for a wheel or a pinch, with deltaY clamped to ±10", () => {
    expect(getWheelZoom(1, -10)).toBeCloseTo(Math.exp(0.1), 10);
    expect(getWheelZoom(50, -10)).toBeCloseTo(50 * Math.exp(0.1), 10);
    expect(getWheelZoom(50, 10)).toBeCloseTo(50 * Math.exp(-0.1), 10);
    expect(getWheelZoom(2, -3)).toBeCloseTo(2 * Math.exp(0.03), 10);
    // a big delta counts as 10
    expect(getWheelZoom(1, -500)).toBeCloseTo(Math.exp(0.1), 10);
    expect(getWheelZoom(1, 500)).toBeCloseTo(Math.exp(-0.1), 10);
  });
});

describe("the zoom steps in the app (YAZ-4405)", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  const setZoom = (value: number) =>
    API.setAppState({ zoom: { value: value as NormalizedZoomValue } });

  it("+ and − multiply by 1.1 at 100% and at 5000%", () => {
    for (const start of [1, 50]) {
      setZoom(start);
      act(() => {
        h.app.actionManager.executeAction(actionZoomIn);
      });
      expect(h.state.zoom.value).toBeCloseTo(start * 1.1, 6);
      act(() => {
        h.app.actionManager.executeAction(actionZoomOut);
      });
      expect(h.state.zoom.value).toBeCloseTo(start, 6);
    }
  });

  it("⌘= goes past 3000% up to 10,000%", () => {
    setZoom(95);
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.codePress(CODES.EQUAL);
    });
    expect(h.state.zoom.value).toBe(100);
  });

  it("one ⌘-scroll notch multiplies by the same factor at 100% and at 5000%", () => {
    for (const start of [1, 50]) {
      setZoom(start);
      fireEvent.wheel(GlobalTestState.interactiveCanvas, {
        ctrlKey: true,
        deltaY: -10,
      });
      expect(h.state.zoom.value / start).toBeCloseTo(Math.exp(0.1), 5);
    }
  });

  it("⌘-scroll out goes below 10%, down to 1%", () => {
    setZoom(0.011);
    fireEvent.wheel(GlobalTestState.interactiveCanvas, {
      ctrlKey: true,
      deltaY: 10,
    });
    expect(h.state.zoom.value).toBe(0.01);
  });
});

describe("zoom to fit below 10% (YAZ-4405)", () => {
  const appState = {
    width: 1000,
    height: 1000,
    offsetLeft: 0,
    offsetTop: 0,
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 },
  } as unknown as AppState;

  const fit = (size: number) =>
    zoomToFitBounds({
      bounds: [0, 0, size, size],
      appState,
      fit: "contain",
      steppedZoom: true,
    }).appState.zoom.value;

  it("floors to whole percents below 10%, not to 0", () => {
    // 1000 / 28000 = 3.57%: floors to 3%
    expect(fit(28000)).toBeCloseTo(0.03, 10);
    expect(fit(200000)).toBe(0.01);
  });

  it("still floors to 10% steps from 10% up", () => {
    // 1000 / 4000 = 25%: floors to 20%
    expect(fit(4000)).toBeCloseTo(0.2, 10);
    // 1000 / 600 = 166%: floors to 160%
    expect(fit(600)).toBeCloseTo(1.6, 10);
  });
});
