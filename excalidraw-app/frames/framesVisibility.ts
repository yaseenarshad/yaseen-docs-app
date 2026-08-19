import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export const FRAMES_VISIBLE_STORAGE_KEY = "yaseendraw.frames.visible";

/** Frames are shown unless the user has explicitly turned them off. */
export const readFramesVisiblePreference = () => {
  try {
    return window.localStorage.getItem(FRAMES_VISIBLE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

export const writeFramesVisiblePreference = (visible: boolean) => {
  try {
    window.localStorage.setItem(FRAMES_VISIBLE_STORAGE_KEY, String(visible));
  } catch {
    // Storage may be unavailable in privacy-restricted contexts.
  }
};

/**
 * Only the grey box and its name label follow the preference. `clip` and
 * `enabled` are deliberately left alone: `enabled: false` would also stop
 * frames from clipping their children.
 */
export const applyFramesVisibility = (
  excalidrawAPI: Pick<ExcalidrawImperativeAPI, "updateFrameRendering">,
  visible: boolean,
) => excalidrawAPI.updateFrameRendering({ outline: visible, name: visible });
