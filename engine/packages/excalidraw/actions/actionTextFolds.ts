import { KEYS } from "@excalidraw/common";

import {
  CaptureUpdateAction,
  getAllFoldedLines,
  isTextElement,
  setFoldedLines,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { getSelectedElements } from "../scene";

import { register } from "./register";

import type { AppState } from "../types";

/**
 * YAZ-4277 D9: ⌘↑ folds all and ⌘↓ unfolds all in the selected free text
 * boxes, not in edit. The host binds them to the notes' keys
 * (`note.foldHere` / `note.unfoldHere`), so a rebinding applies here too.
 * The flowchart's ⌘ + arrow acts on one selected shape only, so the two
 * never meet; align (⌘⇧↑ / ⌘⇧↓) has ⇧.
 */
const selectedFreeTextBoxes = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
) =>
  getSelectedElements(elements, appState).filter(
    (element): element is NonDeleted<ExcalidrawTextElement> =>
      isTextElement(element) && !element.containerId && !element.locked,
  );

const foldKeyTest =
  (key: string) =>
  (
    event: React.KeyboardEvent | KeyboardEvent,
    appState: AppState,
    elements: readonly ExcalidrawElement[],
  ) =>
    event[KEYS.CTRL_OR_CMD] &&
    !event.shiftKey &&
    !event.altKey &&
    event.key === key &&
    !appState.editingTextElement &&
    !appState.viewModeEnabled &&
    selectedFreeTextBoxes(elements, appState).length > 0;

export const actionFoldTextBoxes = register({
  name: "foldTextBoxes",
  label: "Fold all",
  icon: null,
  trackEvent: false,
  perform: (elements, appState, _, app) => {
    for (const element of selectedFreeTextBoxes(elements, appState)) {
      setFoldedLines(element, getAllFoldedLines(element), app.scene);
    }
    // a fold is no undo step (D3)
    return { captureUpdate: CaptureUpdateAction.NEVER };
  },
  keyTest: foldKeyTest(KEYS.ARROW_UP),
});

export const actionUnfoldTextBoxes = register({
  name: "unfoldTextBoxes",
  label: "Unfold all",
  icon: null,
  trackEvent: false,
  perform: (elements, appState, _, app) => {
    for (const element of selectedFreeTextBoxes(elements, appState)) {
      setFoldedLines(element, [], app.scene);
    }
    return { captureUpdate: CaptureUpdateAction.NEVER };
  },
  keyTest: foldKeyTest(KEYS.ARROW_DOWN),
});
