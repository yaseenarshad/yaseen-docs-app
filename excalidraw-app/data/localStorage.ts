import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "@excalidraw/excalidraw/appState";
import {
  DEFAULT_FONT_FAMILY,
  FONT_FAMILY,
  TEXT_ALIGN,
} from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { STORAGE_KEYS } from "../app_constants";

const ASSISTANT_DEFAULT_FONT_MIGRATION_KEY =
  "yaseen-excalidraw-assistant-default-font-v1";
const ARCHITECT_DEFAULT_ROUGHNESS_MIGRATION_KEY =
  "yaseen-whiteboard-architect-default-roughness-v1";
const CENTER_TEXT_ALIGN_MIGRATION_KEY =
  "yaseen-whiteboard-center-text-align-v1";

export const saveUsernameToLocalStorage = (username: string) => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_COLLAB,
      JSON.stringify({ username }),
    );
  } catch (error: any) {
    // Unable to access window.localStorage
    console.error(error);
  }
};

export const importUsernameFromLocalStorage = (): string | null => {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);
    if (data) {
      return JSON.parse(data).username;
    }
  } catch (error: any) {
    // Unable to access localStorage
    console.error(error);
  }

  return null;
};

export const importFromLocalStorage = () => {
  let savedElements = null;
  let savedState = null;
  let shouldMigrateRoughness = false;
  let shouldMigrateTextAlign = false;

  try {
    savedElements = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
    savedState = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
    shouldMigrateRoughness = !localStorage.getItem(
      ARCHITECT_DEFAULT_ROUGHNESS_MIGRATION_KEY,
    );
    if (shouldMigrateRoughness) {
      localStorage.setItem(ARCHITECT_DEFAULT_ROUGHNESS_MIGRATION_KEY, "1");
    }
    shouldMigrateTextAlign = !localStorage.getItem(
      CENTER_TEXT_ALIGN_MIGRATION_KEY,
    );
    if (shouldMigrateTextAlign) {
      localStorage.setItem(CENTER_TEXT_ALIGN_MIGRATION_KEY, "1");
    }
  } catch (error: any) {
    // Unable to access localStorage
    console.error(error);
  }

  let elements: ExcalidrawElement[] = [];
  if (savedElements) {
    try {
      elements = JSON.parse(savedElements);
    } catch (error: any) {
      console.error(error);
      // Do nothing because elements array is already empty
    }
  }

  let appState = null;
  if (savedState) {
    try {
      const parsedState = JSON.parse(savedState) as Partial<AppState>;
      if (
        parsedState.currentItemRoughness !== 0 &&
        parsedState.currentItemRoughness !== 1 &&
        parsedState.currentItemRoughness !== 2
      ) {
        delete parsedState.currentItemRoughness;
      }
      if (
        parsedState.currentItemTextAlign !== TEXT_ALIGN.LEFT &&
        parsedState.currentItemTextAlign !== TEXT_ALIGN.CENTER &&
        parsedState.currentItemTextAlign !== TEXT_ALIGN.RIGHT
      ) {
        delete parsedState.currentItemTextAlign;
      }
      if (
        shouldMigrateRoughness &&
        (parsedState.currentItemRoughness === undefined ||
          parsedState.currentItemRoughness === 1)
      ) {
        parsedState.currentItemRoughness = 0;
      }
      if (
        shouldMigrateTextAlign &&
        (parsedState.currentItemTextAlign === undefined ||
          parsedState.currentItemTextAlign === TEXT_ALIGN.LEFT)
      ) {
        parsedState.currentItemTextAlign = TEXT_ALIGN.CENTER;
      }
      if (!localStorage.getItem(ASSISTANT_DEFAULT_FONT_MIGRATION_KEY)) {
        if (parsedState.currentItemFontFamily === DEFAULT_FONT_FAMILY) {
          parsedState.currentItemFontFamily = FONT_FAMILY.Assistant;
        }
        localStorage.setItem(ASSISTANT_DEFAULT_FONT_MIGRATION_KEY, "1");
      }
      appState = {
        ...getDefaultAppState(),
        ...clearAppStateForLocalStorage(parsedState),
      };
    } catch (error: any) {
      console.error(error);
      // Do nothing because appState is already null
    }
  }
  return { elements, appState };
};

export const getElementsStorageSize = () => {
  try {
    const elements = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
    const elementsSize = elements?.length || 0;
    return elementsSize;
  } catch (error: any) {
    console.error(error);
    return 0;
  }
};

export const getTotalStorageSize = () => {
  try {
    const appState = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
    const collab = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);

    const appStateSize = appState?.length || 0;
    const collabSize = collab?.length || 0;

    return appStateSize + collabSize + getElementsStorageSize();
  } catch (error: any) {
    console.error(error);
    return 0;
  }
};
