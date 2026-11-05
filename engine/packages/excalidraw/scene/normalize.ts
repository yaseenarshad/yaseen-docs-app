import { MAX_ZOOM, MIN_ZOOM } from "@excalidraw/common";

import { clamp, round } from "@excalidraw/math";

import type { NormalizedZoomValue } from "../types";

export const getNormalizedZoom = (zoom: number): NormalizedZoomValue => {
  return clamp(round(zoom, 6), MIN_ZOOM, MAX_ZOOM) as NormalizedZoomValue;
};

/**
 * YAZ-4277 demo: even zoom steps. A step multiplies the zoom, so each one
 * moves in or out by the same amount on screen at 10% or at 10,000%. At 100%
 * a button step is 1.1 and a wheel notch about 1.105, as the old fixed steps.
 */
export const ZOOM_STEP_FACTOR = 1.1;
/** The wheel and pinch rate: `exp(-deltaY × k)`; deltaY is clamped to ±10. */
const WHEEL_ZOOM_RATE = 0.01;
const WHEEL_ZOOM_MAX_DELTA = 10;

/** The zoom after `steps` button steps (negative: out). */
export const getSteppedZoom = (zoom: number, steps: number) =>
  getNormalizedZoom(zoom * ZOOM_STEP_FACTOR ** steps);

/** The zoom after a ⌘-scroll or a pinch of `deltaY` (not normalized). */
export const getWheelZoom = (zoom: number, deltaY: number) =>
  zoom *
  Math.exp(
    -WHEEL_ZOOM_RATE *
      clamp(deltaY, -WHEEL_ZOOM_MAX_DELTA, WHEEL_ZOOM_MAX_DELTA),
  );

export const getNormalizedGridSize = (gridStep: number) => {
  return clamp(Math.round(gridStep), 1, 100);
};

export const getNormalizedGridStep = (gridStep: number) => {
  return clamp(Math.round(gridStep), 1, 100);
};
