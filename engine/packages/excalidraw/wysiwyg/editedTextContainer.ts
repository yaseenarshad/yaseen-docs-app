import {
  LinearElementEditor,
  bumpVersion,
  computeBoundTextPosition,
  computeContainerDimensionForBoundText,
  getBoundTextMaxHeight,
  getBoundTextElementId,
  getBoundTextMaxWidth,
  getContainerElement,
  isArrowElement,
  isTextElement,
  originalContainerCache,
  redrawTextBoundingBox,
  updateBoundElements,
  updateOriginalContainerCache,
} from "@excalidraw/element";

import type {
  ExcalidrawLinearElement,
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
  ExcalidrawTextElementWithContainer,
  NonDeleted,
} from "@excalidraw/element/types";

import type App from "../components/App";

/**
 * The place of a text in edit inside its shape (YAZ-4277 D1: the textarea and
 * the host editor share it). The shape grows with the text, and shrinks back
 * to its height before the edit. Null: the shape grew, and the scene update
 * that follows places the text again.
 */
export const fitEditedTextContainer = (
  app: App,
  textElement: NonDeleted<ExcalidrawTextElement>,
  container: NonDeleted<ExcalidrawTextContainer>,
  /** The font changed since the last call: the height before the edit is the height now. */
  fontChanged: boolean,
) => {
  let { x, y } = textElement;
  const { height } = textElement;
  if (isArrowElement(container)) {
    ({ x, y } = LinearElementEditor.getBoundTextElementPosition(
      container,
      textElement as ExcalidrawTextElementWithContainer,
      app.scene.getNonDeletedElementsMap(),
    ));
  }

  let originalContainerData;
  if (fontChanged) {
    originalContainerData = updateOriginalContainerCache(
      container.id,
      container.height,
    );
  } else {
    originalContainerData = originalContainerCache[container.id];
    if (!originalContainerData) {
      originalContainerData = updateOriginalContainerCache(
        container.id,
        container.height,
      );
    }
  }

  const maxWidth = getBoundTextMaxWidth(container, textElement);
  const maxHeight = getBoundTextMaxHeight(
    container,
    textElement as ExcalidrawTextElementWithContainer,
  );

  // autogrow container height if text exceeds
  if (!isArrowElement(container) && height > maxHeight) {
    const targetContainerHeight = computeContainerDimensionForBoundText(
      height,
      container.type,
    );

    app.scene.mutateElement(container, { height: targetContainerHeight });
    updateBoundElements(container, app.scene);
    return null;
  } else if (
    // autoshrink container height until original container height
    // is reached when text is removed
    !isArrowElement(container) &&
    container.height > originalContainerData.height &&
    height < maxHeight
  ) {
    const targetContainerHeight = computeContainerDimensionForBoundText(
      height,
      container.type,
    );
    app.scene.mutateElement(container, { height: targetContainerHeight });
    updateBoundElements(container, app.scene);
  } else {
    ({ x, y } = computeBoundTextPosition(
      container,
      textElement as ExcalidrawTextElementWithContainer,
      app.scene.getNonDeletedElementsMap(),
    ));
  }
  return { x, y, maxWidth };
};

/**
 * The shape of a text whose edit ends (YAZ-4277 D1: the textarea and the host
 * editor share it): it holds the text, or lets an empty one go, and fits it.
 */
export const submitEditedTextContainer = (
  app: App,
  textElement: ExcalidrawTextElement,
  text: string,
) => {
  const container = getContainerElement(
    textElement,
    app.scene.getNonDeletedElementsMap(),
  );
  if (!container) {
    return;
  }
  if (text.trim()) {
    const boundTextElementId = getBoundTextElementId(container);
    if (!boundTextElementId || boundTextElementId !== textElement.id) {
      app.scene.mutateElement(container, {
        boundElements: (container.boundElements || []).concat({
          type: "text",
          id: textElement.id,
        }),
      });
    } else if (isArrowElement(container)) {
      // updating an arrow label may change bounds, prevent stale cache:
      bumpVersion(container);
    }
  } else {
    app.scene.mutateElement(container, {
      boundElements: container.boundElements?.filter(
        (ele) =>
          !isTextElement(
            ele as ExcalidrawTextElement | ExcalidrawLinearElement,
          ),
      ),
    });
  }

  redrawTextBoundingBox(textElement, container, app.scene);
};
