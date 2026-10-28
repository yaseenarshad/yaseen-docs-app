import type { ViewportOffsets } from "@excalidraw/excalidraw/types";

/**
 * Fraction of the window kept clear on the right while presenting, so the
 * presenter's camera feed can sit there during a recording (GRO-1926). Same
 * ratio as the `4-Canvas-Visuals` skill's `rsv = 0.32`, and always on — there
 * is no toggle (GRO-1929 D6).
 */
export const PRESENTATION_CAMERA_RESERVE = 0.32;

/**
 * Offsets for every `setViewport` call made while presenting: the measured
 * editor UI (`ui`) for the sides we don't own, plus a static right inset that
 * holds the camera strip. A static side replaces the UI-derived one rather than
 * adding to it, so `right` here is the whole right inset — which is what we
 * want: the reserve is wider than any chrome it hides behind.
 */
export const getPresentationViewportOffsets = (): ViewportOffsets => ({
  ui: true,
  right: Math.round(window.innerWidth * PRESENTATION_CAMERA_RESERVE),
});
