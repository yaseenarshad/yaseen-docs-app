/**
 * Yaseen Docs (YAZ-4354 1D): "Edit colors" opens a mode on the board for one
 * many-color icon (`appState.colorEditingElementId`, as `croppingElementId`). The
 * top bar's button, the context menu and the command palette open it; double-click
 * and Enter stay crop. Done, Esc, Enter or a click outside leave it.
 */
import {
  CaptureUpdateAction,
  getIconInfo,
  isInitializedImageElement,
} from "@excalidraw/element";

import { t } from "../i18n";

import { register } from "./register";

import type { AppClassProperties, AppState } from "../types";

/** The one selected many-color icon that can open the mode, if any. */
export const getColorEditorTarget = (
  appState: Pick<AppState, "selectedElementIds">,
  app: AppClassProperties,
) => {
  const selected = app.scene.getSelectedElements({
    selectedElementIds: appState.selectedElementIds,
  });
  const element = selected.length === 1 ? selected[0] : null;
  return element &&
    !element.locked &&
    isInitializedImageElement(element) &&
    getIconInfo(app.files[element.fileId]).kind === "many"
    ? element
    : null;
};

export const actionToggleColorEditor = register({
  name: "colorEditor",
  label: "labels.editColors",
  trackEvent: { category: "element" },
  keywords: ["icon", "color", "colour", "recolor", "paint", "emoji"],
  perform(elements, appState, _, app) {
    if (appState.colorEditingElementId) {
      return {
        appState: { ...appState, colorEditingElementId: null },
        captureUpdate: CaptureUpdateAction.NEVER,
      };
    }
    const element = getColorEditorTarget(appState, app);
    if (!element) {
      return false;
    }
    return {
      appState: {
        ...appState,
        croppingElementId: null,
        isCropping: false,
        openPopup: null,
        colorEditingElementId: element.id,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    };
  },
  predicate: (elements, appState, _, app) =>
    !appState.viewModeEnabled &&
    !appState.croppingElementId &&
    !appState.colorEditingElementId &&
    !!getColorEditorTarget(appState, app),
  PanelComponent: ({ appState, updateData, app }) => {
    if (!getColorEditorTarget(appState, app) || appState.viewModeEnabled) {
      return null;
    }
    const label = t("labels.editColors");
    return (
      <button
        type="button"
        className="contextual-properties-toolbar__text-button"
        title={`${label} — click a part of the picture to change its color`}
        aria-label={label}
        onClick={() => updateData(null)}
      >
        {label}
      </button>
    );
  },
});
