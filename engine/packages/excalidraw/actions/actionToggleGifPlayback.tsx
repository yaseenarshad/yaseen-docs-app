import { MIME_TYPES } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  isGifPaused,
  isInitializedImageElement,
  newElementWith,
} from "@excalidraw/element";

import type { InitializedExcalidrawImageElement } from "@excalidraw/element/types";

import { register } from "./register";

import type { AppClassProperties, AppState } from "../types";

/** The one selected GIF with more than one frame (a paused GIF counts: it played before). */
const getSelectedGif = (
  appState: Pick<AppState, "selectedElementIds">,
  app: AppClassProperties,
) => {
  const selected = app.scene.getSelectedElements({
    selectedElementIds: appState.selectedElementIds,
  });
  const element = selected.length === 1 ? selected[0] : null;
  if (
    !element ||
    !isInitializedImageElement(element) ||
    app.files[element.fileId]?.mimeType !== MIME_TYPES.gif
  ) {
    return null;
  }
  return isGifPaused(element) || app.gifPlayer.isAnimated(element.fileId)
    ? element
    : null;
};

/** YAZ-3944 D4: "Pause GIF" / "Play GIF", saved as `customData.gifPaused`. */
export const actionToggleGifPlayback = register({
  name: "toggleGifPlayback",
  label: (elements, appState, app) => {
    const element = getSelectedGif(appState, app);
    return element && isGifPaused(element)
      ? "labels.playGif"
      : "labels.pauseGif";
  },
  trackEvent: { category: "element" },
  perform(elements, appState, _, app) {
    const gif = getSelectedGif(appState, app)!;
    const { gifPaused, ...customData } = gif.customData ?? {};
    const next = newElementWith(gif as InitializedExcalidrawImageElement, {
      customData: isGifPaused(gif)
        ? customData
        : { ...customData, gifPaused: true },
    });
    return {
      elements: elements.map((element) =>
        element.id === gif.id ? next : element,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  predicate: (elements, appState, _, app) =>
    !appState.croppingElementId && !!getSelectedGif(appState, app),
});
