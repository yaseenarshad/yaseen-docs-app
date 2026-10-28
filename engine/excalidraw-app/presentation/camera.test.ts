import { afterEach, describe, expect, it } from "vitest";

import {
  PRESENTATION_CAMERA_RESERVE,
  getPresentationViewportOffsets,
} from "./camera";

const DEFAULT_WINDOW_WIDTH = window.innerWidth;

const setWindowWidth = (width: number) =>
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
    writable: true,
  });

describe("presentation camera reserve", () => {
  afterEach(() => setWindowWidth(DEFAULT_WINDOW_WIDTH));

  it("keeps the ratio the canvas skill records with", () => {
    expect(PRESENTATION_CAMERA_RESERVE).toBe(0.32);
  });

  it("reserves whole right-hand pixels for the current window width", () => {
    // 1920 → 614px reserved, so the slide fits in the left 1306px (68%).
    setWindowWidth(1920);
    expect(getPresentationViewportOffsets()).toEqual({ ui: true, right: 614 });

    // Rounded, never fractional: 999 * 0.32 = 319.68, 1023 * 0.32 = 327.36.
    setWindowWidth(999);
    expect(getPresentationViewportOffsets().right).toBe(320);
    setWindowWidth(1023);
    expect(getPresentationViewportOffsets().right).toBe(327);
  });
});
