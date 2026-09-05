import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "@excalidraw/excalidraw/appState";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_NEW_TEXT_ALIGN,
  FONT_FAMILY,
} from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { STORAGE_KEYS } from "../app_constants";

const ASSISTANT_DEFAULT_FONT_MIGRATION_KEY =
  "yaseen-excalidraw-assistant-default-font-v1";
const ARCHITECT_DEFAULT_ROUGHNESS_MIGRATION_KEY =
  "yaseen-whiteboard-architect-default-roughness-v1";

// Cloud and collaboration routes pause scene saves, but these preferences still
// belong to this browser. Merge only them so the local board stays untouched.
export const saveWritingPreferencesToLocalStorage = ({
  writingMode,
  currentItemWritingStrokeWidth,
}: Pick<AppState, "writingMode" | "currentItemWritingStrokeWidth">) => {
  try {
    const savedState = localStorage.getItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
    );
    const appState = savedState ? JSON.parse(savedState) : {};
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({
        ...appState,
        writingMode,
        currentItemWritingStrokeWidth,
      }),
    );
  } catch (error) {
    console.error(error);
  }
};

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

  try {
    savedElements = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
    savedState = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
    shouldMigrateRoughness = !localStorage.getItem(
      ARCHITECT_DEFAULT_ROUGHNESS_MIGRATION_KEY,
    );
    if (shouldMigrateRoughness) {
      localStorage.setItem(ARCHITECT_DEFAULT_ROUGHNESS_MIGRATION_KEY, "1");
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
        parsedState.currentItemVectorStrokeWidth === undefined &&
        (parsedState as any).currentItemLinearStrokeWidth !== undefined
      ) {
        parsedState.currentItemVectorStrokeWidth = (
          parsedState as any
        ).currentItemLinearStrokeWidth;
      }
      delete (parsedState as any).currentItemLinearStrokeWidth;
      if (
        parsedState.currentItemRoughness !== 0 &&
        parsedState.currentItemRoughness !== 1 &&
        parsedState.currentItemRoughness !== 2
      ) {
        delete parsedState.currentItemRoughness;
      }
      parsedState.currentItemTextAlign = DEFAULT_NEW_TEXT_ALIGN;
      if (
        shouldMigrateRoughness &&
        (parsedState.currentItemRoughness === undefined ||
          parsedState.currentItemRoughness === 1)
      ) {
        parsedState.currentItemRoughness = 0;
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
