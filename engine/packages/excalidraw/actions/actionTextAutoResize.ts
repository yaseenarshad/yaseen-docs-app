import { getFontString } from "@excalidraw/common";

import {
  getTextAnchorRatios,
  getTextElementStyledLayout,
  getTextLayoutMaxWidth,
  isExcalidrawElement,
  isNonDeletedElement,
  newElementWith,
  updateBoundElements,
} from "@excalidraw/element";
import { measureText } from "@excalidraw/element";

import { isTextElement } from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { getSelectedElements } from "../scene";

import { register } from "./register";

import type { AppClassProperties, AppState } from "../types";

/** The text the action works on: the one handed over, or the selected one. */
const getTargetText = (
  elements: readonly ExcalidrawElement[],
  appState: Readonly<AppState>,
  targetElement: unknown,
) => {
  const selectedElements = getSelectedElements(elements, appState);

  const targetTextElement =
    isExcalidrawElement(targetElement) && isTextElement(targetElement)
      ? targetElement
      : (selectedElements[0] as ExcalidrawElement | undefined);

  const target = elements.find(
    (element) => element.id === targetTextElement?.id,
  );

  return target && isTextElement(target) ? target : null;
};

/**
 * Gives a text box a new size and keeps the point its alignment pins.
 *
 * Resizing the box would otherwise make a right-aligned or centred text slide
 * sideways, and one bound to an arrow endpoint drag the arrow with it. Shared
 * by "fit the text" and "only shrink" (YAZ-5771).
 */
const resizeTextAtAnchor = (
  elements: readonly ExcalidrawElement[],
  appState: Readonly<AppState>,
  app: AppClassProperties,
  target: ExcalidrawTextElement,
  next: Pick<ExcalidrawTextElement, "autoResize" | "width" | "height" | "text">,
) => {
  const anchor = getTextAnchorRatios(target);

  const resized = newElementWith(target, {
    ...next,
    x: target.x + (target.width - next.width) * anchor.x,
    y: target.y + (target.height - next.height) * anchor.y,
  });

  // the anchor only pins one point of the box, so any other arrow bound to
  // this text still has to be re-routed to its new geometry. The scene holds
  // the pre-resize text, hence handing the new one over explicitly.
  if (isNonDeletedElement(resized)) {
    updateBoundElements(resized, app.scene, {
      changedElements: new Map([[resized.id, resized]]),
    });
  }

  return {
    appState,
    elements: elements.map((element) =>
      element.id === resized.id ? resized : element,
    ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  };
};

export const actionTextAutoResize = register({
  name: "autoResize",
  label: "labels.autoResize",
  icon: null,
  trackEvent: { category: "element" },
  predicate: (elements, appState, _: unknown) => {
    const selectedElements = getSelectedElements(elements, appState);
    return (
      selectedElements.length === 1 &&
      isTextElement(selectedElements[0]) &&
      !selectedElements[0].autoResize
    );
  },
  perform: (elements, appState, targetElement, app) => {
    const target = getTargetText(elements, appState, targetElement);

    if (!target) {
      return false;
    }

    const metrics = measureText(
      target.originalText,
      getFontString(target),
      target.lineHeight,
    );

    return resizeTextAtAnchor(elements, appState, app, target, {
      autoResize: true,
      width: metrics.width,
      height: metrics.height,
      text: target.originalText,
    });
  },
});

/**
 * YAZ-5771 "Only shrink": the width a free text box can shrink to and keep
 * every line break it has now, or null when there is nothing to cut.
 *
 * The widest line as laid out at the box's width (list indents, text runs and
 * link pills included). A width that wraps the text otherwise (letter widths
 * add up a hair differently than a whole line measures) is nudged up, never
 * past the box's own width.
 */
export const getTextShrinkWidth = (target: ExcalidrawTextElement) => {
  const current = getTextElementStyledLayout(
    target,
    getTextLayoutMaxWidth(target, null),
  );
  const widest = current.width;

  if (!(widest > 0) || widest >= target.width - 0.01) {
    return null;
  }

  for (const nudge of [0, 0.01, 0.1, 0.5, 1]) {
    const width = widest + nudge;
    if (width >= target.width) {
      break;
    }
    const shrunk = getTextElementStyledLayout(target, width);
    if (shrunk.text === current.text) {
      return { width, height: shrunk.height, text: shrunk.text };
    }
  }

  return null;
};

/**
 * YAZ-5771: a double click on a text box's left or right edge, "Only shrink":
 * the box keeps its line breaks and a fixed width, as wide as its widest line.
 * It never gets wider; with nothing to cut, nothing changes (no history step).
 */
export const actionTextShrinkToLines = register({
  name: "textShrinkToLines",
  label: "labels.autoResize",
  icon: null,
  trackEvent: false,
  predicate: (elements, appState, _: unknown) => {
    const selectedElements = getSelectedElements(elements, appState);
    return (
      selectedElements.length === 1 &&
      isTextElement(selectedElements[0]) &&
      !selectedElements[0].containerId
    );
  },
  perform: (elements, appState, targetElement, app) => {
    const target = getTargetText(elements, appState, targetElement);

    if (!target || target.containerId) {
      return false;
    }

    const shrunk = getTextShrinkWidth(target);

    if (!shrunk) {
      return false;
    }

    return resizeTextAtAnchor(elements, appState, app, target, {
      autoResize: false,
      ...shrunk,
    });
  },
});
