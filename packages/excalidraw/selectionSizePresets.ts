import { arrayToMap } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  deepCopyElement,
  getCommonBoundingBox,
  isBoundToContainer,
  isTextElement,
  resizeMultipleElements,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { changeFontSize } from "./actions/actionProperties";
import { register } from "./actions/register";
import { getSelectedElements } from "./scene";

export type SelectionSizePresetKey =
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "0";

export const SELECTION_SIZE_PRESETS = {
  text: {
    "1": 12,
    "2": 16,
    "3": 20,
    "4": 24,
    "5": 32,
    "6": 40,
    "7": 56,
    "8": 72,
    "9": 96,
    "0": 128,
  },
  visual: {
    "1": 48,
    "2": 64,
    "3": 96,
    "4": 128,
    "5": 192,
    "6": 256,
    "7": 384,
    "8": 512,
    "9": 768,
    "0": 1024,
  },
} as const;

export const isSelectionSizePresetKey = (
  key: string,
): key is SelectionSizePresetKey => /^[0-9]$/.test(key);

export const getSelectionSizePreset = (
  key: SelectionSizePresetKey,
  kind: keyof typeof SELECTION_SIZE_PRESETS,
  zoom: number,
) => SELECTION_SIZE_PRESETS[kind][key] / zoom;

export const actionResizeSelectionToPreset = register<{
  key: SelectionSizePresetKey;
}>({
  name: "resizeSelectionToPreset",
  label: "labels.resize",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    if (!value) {
      return false;
    }

    const directlySelected = app.scene.getSelectedElements(appState);
    if (
      !directlySelected.length ||
      directlySelected.some((element) => element.locked)
    ) {
      return false;
    }

    if (directlySelected.length === 1 && isTextElement(directlySelected[0])) {
      const targetFontSize = getSelectionSizePreset(
        value.key,
        "text",
        appState.zoom.value,
      );
      if (directlySelected[0].fontSize === targetFontSize) {
        return false;
      }
      return changeFontSize(
        elements,
        appState,
        app,
        () => targetFontSize,
        targetFontSize,
      );
    }

    const selectedElements = getSelectedElements(elements, appState, {
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    });
    if (
      !selectedElements.length ||
      selectedElements.some((element) => element.locked)
    ) {
      return false;
    }

    const resizeTargets = selectedElements.filter(
      (element) => !isBoundToContainer(element),
    );
    if (!resizeTargets.length) {
      return false;
    }

    const bounds = getCommonBoundingBox(resizeTargets);
    const longestEdge = Math.max(bounds.width, bounds.height);
    const targetLongestEdge = getSelectionSizePreset(
      value.key,
      "visual",
      appState.zoom.value,
    );
    if (!longestEdge || Math.abs(longestEdge - targetLongestEdge) < 0.001) {
      return false;
    }

    const originalElementsMap = new Map(
      app.scene
        .getNonDeletedElements()
        .map((element) => [element.id, deepCopyElement(element)]),
    );
    resizeMultipleElements(
      resizeTargets,
      app.scene.getNonDeletedElementsMap(),
      "se",
      app.scene,
      originalElementsMap,
      {
        shouldMaintainAspectRatio: true,
        shouldResizeFromCenter: true,
        ...(bounds.width >= bounds.height
          ? { nextWidth: targetLongestEdge }
          : { nextHeight: targetLongestEdge }),
        originalBoundingBox: bounds,
      },
    );

    const resizedElementsMap = arrayToMap(
      app.scene.getNonDeletedElements() as readonly ExcalidrawElement[],
    );
    return {
      elements: elements.map(
        (element) => resizedElementsMap.get(element.id) ?? element,
      ),
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});
