import {
  KEYS,
  matchKey,
  arrayToMap,
  MOBILE_ACTION_BUTTON_BG,
} from "@excalidraw/common";

import { CaptureUpdateAction } from "@excalidraw/element";

import { orderByFractionalIndex } from "@excalidraw/element";

import type { SceneElementsMap } from "@excalidraw/element/types";

import { IconButton } from "../components/IconButton";
import { UndoIcon, RedoIcon } from "../components/icons";
import { HistoryChangedEvent } from "../history";
import { useEmitter } from "../hooks/useEmitter";
import { t } from "../i18n";

import { useStylesPanelMode } from "../components/App";

import type { History } from "../history";
import type { AppClassProperties, AppState } from "../types";
import type { Action, ActionResult } from "./types";

const executeHistoryAction = (
  app: AppClassProperties,
  appState: Readonly<AppState>,
  updater: () => [SceneElementsMap, AppState] | void,
): ActionResult => {
  if (
    !appState.multiElement &&
    !appState.resizingElement &&
    !appState.editingTextElement &&
    !appState.newElement &&
    !appState.selectedElementsAreBeingDragged &&
    !appState.selectionElement &&
    !app.flowchart.isCreatingChart &&
    // a drawShape sketch in progress isn't visible via `newElement` while
    // the stroke is still unrecognized — block history mid-gesture the same
    // way as for the other in-progress interactions above
    !app.drawShape.hasPendingGesture()
  ) {
    const result = updater();

    if (!result) {
      return { captureUpdate: CaptureUpdateAction.EVENTUALLY };
    }

    const [nextElementsMap, nextAppState] = result;

    // order by fractional indices in case the map was accidently modified in the meantime
    const nextElements = orderByFractionalIndex(
      Array.from(nextElementsMap.values()),
    );

    return {
      appState: nextAppState,
      elements: nextElements,
      captureUpdate: CaptureUpdateAction.NEVER,
    };
  }

  return { captureUpdate: CaptureUpdateAction.EVENTUALLY };
};

type ActionCreator = (history: History) => Action;

/** while the laser is active, undo/redo step the laser's own mark history */
const isLaserActive = (appState: Readonly<Pick<AppState, "activeTool">>) =>
  appState.activeTool.type === "laser";

export const createUndoAction: ActionCreator = (history) => ({
  name: "undo",
  label: "buttons.undo",
  icon: UndoIcon,
  trackEvent: { category: "history" },
  // the laser's marks can be undone while presenting in view mode
  viewMode: isLaserActive,
  perform: (elements, appState, value, app) => {
    if (isLaserActive(appState)) {
      app.laserTrails.undo();
      return { captureUpdate: CaptureUpdateAction.NEVER };
    }
    return executeHistoryAction(app, appState, () =>
      history.undo(arrayToMap(elements) as SceneElementsMap, appState),
    );
  },
  keyTest: (event) =>
    event[KEYS.CTRL_OR_CMD] && matchKey(event, KEYS.Z) && !event.shiftKey,
  PanelComponent: ({ appState, updateData, data, app }) => {
    const { isUndoStackEmpty } = useEmitter<HistoryChangedEvent>(
      history.onHistoryChangedEmitter,
      new HistoryChangedEvent(
        history.isUndoStackEmpty,
        history.isRedoStackEmpty,
      ),
    );
    const laserHistory = useEmitter(
      app.laserTrails.onChange,
      app.laserTrails.getSnapshot(),
    );
    const isMobile = useStylesPanelMode() === "mobile";

    return (
      <IconButton
        type="button"
        icon={UndoIcon}
        aria-label={t("buttons.undo")}
        title={data?.title}
        onClick={updateData}
        size={data?.size || "medium"}
        disabled={
          isLaserActive(appState) ? !laserHistory.canUndo : isUndoStackEmpty
        }
        data-testid={data?.testId ?? "button-undo"}
        style={{
          ...(isMobile ? MOBILE_ACTION_BUTTON_BG : {}),
        }}
      />
    );
  },
});

export const createRedoAction: ActionCreator = (history) => ({
  name: "redo",
  label: "buttons.redo",
  icon: RedoIcon,
  trackEvent: { category: "history" },
  viewMode: isLaserActive,
  perform: (elements, appState, __, app) => {
    if (isLaserActive(appState)) {
      app.laserTrails.redo();
      return { captureUpdate: CaptureUpdateAction.NEVER };
    }
    return executeHistoryAction(app, appState, () =>
      history.redo(arrayToMap(elements) as SceneElementsMap, appState),
    );
  },
  keyTest: (event) =>
    (event[KEYS.CTRL_OR_CMD] && event.shiftKey && matchKey(event, KEYS.Z)) ||
    (event[KEYS.CTRL_OR_CMD] && !event.shiftKey && matchKey(event, KEYS.Y)),
  PanelComponent: ({ appState, updateData, data, app }) => {
    const { isRedoStackEmpty } = useEmitter(
      history.onHistoryChangedEmitter,
      new HistoryChangedEvent(
        history.isUndoStackEmpty,
        history.isRedoStackEmpty,
      ),
    );
    const laserHistory = useEmitter(
      app.laserTrails.onChange,
      app.laserTrails.getSnapshot(),
    );
    const isMobile = useStylesPanelMode() === "mobile";

    return (
      <IconButton
        type="button"
        icon={RedoIcon}
        aria-label={t("buttons.redo")}
        title={data?.title}
        onClick={updateData}
        size={data?.size || "medium"}
        disabled={
          isLaserActive(appState) ? !laserHistory.canRedo : isRedoStackEmpty
        }
        data-testid={data?.testId ?? "button-redo"}
        style={{
          ...(isMobile ? MOBILE_ACTION_BUTTON_BG : {}),
        }}
      />
    );
  },
});
