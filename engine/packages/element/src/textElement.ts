import {
  ARROW_LABEL_FONT_SIZE_TO_MIN_WIDTH_RATIO,
  ARROW_LABEL_WIDTH_FRACTION,
  BOUND_TEXT_PADDING,
  CORNER_RADIUS,
  DEFAULT_FONT_SIZE,
  ROUNDNESS,
  TEXT_ALIGN,
  VERTICAL_ALIGN,
  getVerticalOffset,
  isRTL,
  isTransparent,
  isProdEnv,
  invariant,
} from "@excalidraw/common";

import {
  isPointWithinBounds,
  pointFrom,
  pointRotateRads,
  type GlobalPoint,
  type Radians,
} from "@excalidraw/math";

import type { ExtractSetType } from "@excalidraw/common/utility-types";

import {
  resetOriginalContainerCache,
  updateOriginalContainerCache,
} from "./containerCache";
import { LinearElementEditor } from "./linearElementEditor";

import { getCornerRadius } from "./utils";
import {
  getStyledVisualLineStart,
  getTextElementStyledLayout,
} from "./textLineUnderlines";
import {
  isBoundToContainer,
  isArrowElement,
  isTextElement,
} from "./typeChecks";

import { isNonDeletedElement } from ".";

import type { Scene } from "./Scene";

import type { MaybeTransformHandleType } from "./transformHandles";
import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawElementType,
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
  ExcalidrawTextElementWithContainer,
  NonDeleted,
} from "./types";

type TextVisualBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const TEXT_BACKGROUND_RADIUS_BASE_FONT_SIZE = 130;
const TEXT_INTERACTION_PADDING_RATIO = 0.04;
const TEXT_BACKGROUND_VERTICAL_PADDING_RATIO = 0.23;
const TEXT_BACKGROUND_HORIZONTAL_PADDING_RATIO = 0.26;
export const TEXT_BACKGROUND_NOMINAL_PADDING_RATIO =
  (TEXT_BACKGROUND_VERTICAL_PADDING_RATIO +
    TEXT_BACKGROUND_HORIZONTAL_PADDING_RATIO) /
  2;
export const TEXT_BACKGROUND_MAX_PADDING_SCALE =
  1 / TEXT_BACKGROUND_NOMINAL_PADDING_RATIO;

const roundTextBackgroundMetric = (value: number) =>
  Math.round(value * 100) / 100;

export const normalizeTextBackgroundPaddingScale = (
  value: unknown,
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.min(value, TEXT_BACKGROUND_MAX_PADDING_SCALE);
};

export const getTextBackgroundPaddingScale = (element: ExcalidrawTextElement) =>
  normalizeTextBackgroundPaddingScale(element.backgroundPaddingScale) ?? 1;

export const getTextBackgroundPaddingScaleFromNominalPx = (
  fontSize: number,
  nominalPadding: number,
) => {
  const safeFontSize =
    Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_FONT_SIZE;
  if (!Number.isFinite(nominalPadding) || nominalPadding < 0) {
    return 1;
  }

  return (
    Math.min(nominalPadding, safeFontSize) /
    (safeFontSize * TEXT_BACKGROUND_NOMINAL_PADDING_RATIO)
  );
};

export const getTextBackgroundNominalPadding = (
  element: ExcalidrawTextElement,
) =>
  roundTextBackgroundMetric(
    element.fontSize *
      TEXT_BACKGROUND_NOMINAL_PADDING_RATIO *
      getTextBackgroundPaddingScale(element),
  );

export const getTextBackgroundPadding = (element: ExcalidrawTextElement) => {
  const scale = getTextBackgroundPaddingScale(element);
  return {
    horizontal: roundTextBackgroundMetric(
      element.fontSize * TEXT_BACKGROUND_HORIZONTAL_PADDING_RATIO * scale,
    ),
    vertical: roundTextBackgroundMetric(
      element.fontSize * TEXT_BACKGROUND_VERTICAL_PADDING_RATIO * scale,
    ),
  };
};

export const getScaledTextRoundness = (
  element: ExcalidrawTextElement,
  nextFontSize: number,
): ExcalidrawTextElement["roundness"] => {
  if (element.containerId !== null || !element.roundness) {
    return element.roundness;
  }

  const previousFontSize =
    Number.isFinite(element.fontSize) && element.fontSize > 0
      ? element.fontSize
      : nextFontSize;
  const safeNextFontSize =
    Number.isFinite(nextFontSize) && nextFontSize > 0
      ? nextFontSize
      : previousFontSize;
  const defaultRadius = Math.min(
    CORNER_RADIUS.max,
    Math.max(
      CORNER_RADIUS.min,
      Math.round(
        (CORNER_RADIUS.default * previousFontSize) /
          TEXT_BACKGROUND_RADIUS_BASE_FONT_SIZE,
      ),
    ),
  );
  const previousRadius =
    Number.isFinite(element.roundness.value) &&
    (element.roundness.value ?? 0) >= 0
      ? element.roundness.value ?? defaultRadius
      : defaultRadius;

  return {
    ...element.roundness,
    type: ROUNDNESS.ADAPTIVE_RADIUS,
    value: Math.min(
      CORNER_RADIUS.max,
      Math.max(
        CORNER_RADIUS.min,
        Math.round((previousRadius * safeNextFontSize) / previousFontSize),
      ),
    ),
  };
};

let textBackgroundMeasurementContext:
  | CanvasRenderingContext2D
  | null
  | undefined;

const getTextBackgroundMeasurementContext = () => {
  if (textBackgroundMeasurementContext !== undefined) {
    return textBackgroundMeasurementContext;
  }

  if (typeof document === "undefined") {
    textBackgroundMeasurementContext = null;
    return textBackgroundMeasurementContext;
  }

  textBackgroundMeasurementContext = document
    .createElement("canvas")
    .getContext("2d");
  return textBackgroundMeasurementContext;
};

const getTextVisualBounds = (
  element: ExcalidrawTextElement,
): TextVisualBounds | null => {
  const context = getTextBackgroundMeasurementContext();
  if (!context) {
    return null;
  }

  const maxWidth = element.autoResize ? Infinity : element.width;
  const { lines } = getTextElementStyledLayout(element, maxWidth);
  const lineHeightPx = element.fontSize * element.lineHeight;
  const verticalOffset = getVerticalOffset(
    element.fontFamily,
    element.fontSize,
    lineHeightPx,
  );
  const horizontalOffset =
    element.textAlign === "center"
      ? element.width / 2
      : element.textAlign === "right"
      ? element.width
      : 0;

  context.textAlign = element.textAlign as CanvasTextAlign;
  context.direction = isRTL(element.text) ? "rtl" : "ltr";
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (let index = 0; index < lines.length; index++) {
    context.font = lines[index].font;
    const lineStart = getStyledVisualLineStart(
      lines[index],
      element.width,
      element.textAlign,
    );
    const drawX = lines[index].isListItem ? lineStart : horizontalOffset;
    context.textAlign = lines[index].isListItem
      ? "left"
      : (element.textAlign as CanvasTextAlign);
    const metrics = context.measureText(lines[index].text || " ");
    const baseline = index * lineHeightPx + verticalOffset;
    const values = [
      metrics.actualBoundingBoxLeft,
      metrics.actualBoundingBoxRight,
      metrics.actualBoundingBoxAscent,
      metrics.actualBoundingBoxDescent,
    ];

    if (!values.every((value) => Number.isFinite(value))) {
      return null;
    }

    left = Math.min(left, drawX - metrics.actualBoundingBoxLeft);
    right = Math.max(right, drawX + metrics.actualBoundingBoxRight);
    top = Math.min(top, baseline - metrics.actualBoundingBoxAscent);
    bottom = Math.max(bottom, baseline + metrics.actualBoundingBoxDescent);
  }

  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    right <= left ||
    bottom <= top
  ) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
};

export const getFreeTextInteractionGeometry = (
  element: ExcalidrawTextElement,
  measuredVisualBounds?: TextVisualBounds,
): TextVisualBounds | null => {
  if (element.containerId !== null || !element.autoResize) {
    return null;
  }

  const visualBounds = measuredVisualBounds ?? getTextVisualBounds(element);
  if (!visualBounds) {
    return {
      x: 0,
      y: 0,
      width: element.width,
      height: element.height,
    };
  }

  const padding = element.fontSize * TEXT_INTERACTION_PADDING_RATIO;

  return {
    x: visualBounds.x - padding,
    y: visualBounds.y - padding,
    width: visualBounds.width + padding * 2,
    height: visualBounds.height + padding * 2,
  };
};

export const getFreeTextInteractionCoords = (
  element: ExcalidrawTextElement,
  measuredVisualBounds?: TextVisualBounds,
): [number, number, number, number, number, number] | null => {
  const visualBounds = getFreeTextInteractionGeometry(
    element,
    measuredVisualBounds,
  );
  if (!visualBounds) {
    return null;
  }

  const elementCenter = pointFrom(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  const visualCenter = pointRotateRads(
    pointFrom(
      element.x + visualBounds.x + visualBounds.width / 2,
      element.y + visualBounds.y + visualBounds.height / 2,
    ),
    elementCenter,
    element.angle,
  );

  return [
    visualCenter[0] - visualBounds.width / 2,
    visualCenter[1] - visualBounds.height / 2,
    visualCenter[0] + visualBounds.width / 2,
    visualCenter[1] + visualBounds.height / 2,
    visualCenter[0],
    visualCenter[1],
  ];
};

export const isPointInFreeTextInteractionBounds = (
  element: ExcalidrawTextElement,
  point: GlobalPoint,
  threshold = 0,
  measuredVisualBounds?: TextVisualBounds,
): boolean | null => {
  const coords = getFreeTextInteractionCoords(element, measuredVisualBounds);
  if (!coords) {
    return null;
  }

  const [x1, y1, x2, y2, cx, cy] = coords;
  const adjustedPoint =
    element.angle === 0
      ? point
      : pointRotateRads(
          point,
          pointFrom<GlobalPoint>(cx, cy),
          -element.angle as Radians,
        );

  return isPointWithinBounds(
    pointFrom<GlobalPoint>(x1 - threshold, y1 - threshold),
    adjustedPoint,
    pointFrom<GlobalPoint>(x2 + threshold, y2 + threshold),
  );
};

export const getTextBackgroundGeometry = (
  element: ExcalidrawTextElement,
  measuredVisualBounds?: TextVisualBounds,
) => {
  if (element.containerId !== null || isTransparent(element.backgroundColor)) {
    return null;
  }

  const visualBounds = measuredVisualBounds ??
    getTextVisualBounds(element) ?? {
      x: 0,
      y: 0,
      width: element.width,
      height: element.height,
    };
  // Slightly wider side padding gives the filled text a compact label shape
  // instead of a square block. Measuring actual glyph bounds keeps words
  // without descenders from looking bottom-heavy.
  const { horizontal: horizontalPadding, vertical: verticalPadding } =
    getTextBackgroundPadding(element);
  const x = roundTextBackgroundMetric(visualBounds.x - horizontalPadding);
  const y = roundTextBackgroundMetric(visualBounds.y - verticalPadding);
  const width = roundTextBackgroundMetric(
    visualBounds.width + horizontalPadding * 2,
  );
  const height = roundTextBackgroundMetric(
    visualBounds.height + verticalPadding * 2,
  );

  return {
    x,
    y,
    width,
    height,
    radius: roundTextBackgroundMetric(
      element.roundness ? getCornerRadius(Math.min(width, height), element) : 0,
    ),
  };
};

export const redrawTextBoundingBox = (
  textElement: ExcalidrawTextElement,
  container: ExcalidrawElement | null,
  scene: Scene,
) => {
  const elementsMap = scene.getNonDeletedElementsMap();

  let maxWidth = undefined;

  if (!isProdEnv()) {
    invariant(
      !container || !isArrowElement(container) || textElement.angle === 0,
      "text element angle must be 0 if bound to arrow container",
    );
  }

  const boundTextUpdates = {
    x: textElement.x,
    y: textElement.y,
    text: textElement.text,
    width: textElement.width,
    height: textElement.height,
    angle: (container
      ? isArrowElement(container)
        ? 0
        : container.angle
      : textElement.angle) as Radians,
  };

  maxWidth = container
    ? getBoundTextMaxWidth(container, textElement)
    : textElement.autoResize
    ? Infinity
    : textElement.width;
  const styledLayout = getTextElementStyledLayout(textElement, maxWidth);
  boundTextUpdates.text = styledLayout.text;

  const metrics = {
    width: styledLayout.width,
    height: styledLayout.height,
  };

  // Note: only update width for unwrapped text and bound texts (which always have autoResize set to true)
  if (textElement.autoResize) {
    boundTextUpdates.width = metrics.width;
  }
  boundTextUpdates.height = metrics.height;

  if (container) {
    const maxContainerHeight = getBoundTextMaxHeight(
      container,
      textElement as ExcalidrawTextElementWithContainer,
    );
    const maxContainerWidth = getBoundTextMaxWidth(container, textElement);

    if (!isArrowElement(container) && metrics.height > maxContainerHeight) {
      const nextHeight = computeContainerDimensionForBoundText(
        metrics.height,
        container.type,
      );
      scene.mutateElement(container, { height: nextHeight });
      updateOriginalContainerCache(container.id, nextHeight);
    }

    if (metrics.width > maxContainerWidth) {
      const nextWidth = computeContainerDimensionForBoundText(
        metrics.width,
        container.type,
      );
      scene.mutateElement(container, { width: nextWidth });
    }

    const updatedTextElement = {
      ...textElement,
      ...boundTextUpdates,
    } as ExcalidrawTextElementWithContainer;

    const { x, y } = computeBoundTextPosition(
      container,
      updatedTextElement,
      elementsMap,
    );

    boundTextUpdates.x = x;
    boundTextUpdates.y = y;
  }

  scene.mutateElement(textElement, boundTextUpdates);
};

export const handleBindTextResize = (
  container: ExcalidrawElement,
  scene: Scene,
  transformHandleType: MaybeTransformHandleType,
  shouldMaintainAspectRatio = false,
  shouldResizeFromCenter = false,
) => {
  const elementsMap = scene.getNonDeletedElementsMap();
  const boundTextElementId = getBoundTextElementId(container);
  if (!boundTextElementId) {
    return;
  }
  resetOriginalContainerCache(container.id);
  const textElement = getBoundTextElement(container, elementsMap);
  if (textElement && textElement.text) {
    if (!container) {
      return;
    }

    let text = textElement.text;
    let nextHeight = textElement.height;
    let nextWidth = textElement.width;
    const maxWidth = getBoundTextMaxWidth(container, textElement);
    const maxHeight = getBoundTextMaxHeight(container, textElement);
    let containerHeight = container.height;
    if (
      shouldMaintainAspectRatio ||
      (transformHandleType !== "n" && transformHandleType !== "s")
    ) {
      if (text) {
        const styledLayout = getTextElementStyledLayout(textElement, maxWidth);
        text = styledLayout.text;
        nextHeight = styledLayout.height;
        nextWidth = styledLayout.width;
      }
    }
    // increase height in case text element height exceeds
    if (nextHeight > maxHeight) {
      containerHeight = computeContainerDimensionForBoundText(
        nextHeight,
        container.type,
      );

      const diff = containerHeight - container.height;
      // fix the y coord when resizing from ne/nw/n
      const shouldResizeFromTop =
        transformHandleType === "n" ||
        transformHandleType === "ne" ||
        transformHandleType === "nw";

      let offsetY = 0;
      if (!isArrowElement(container)) {
        if (shouldResizeFromCenter) {
          offsetY = diff / 2;
        } else if (shouldResizeFromTop) {
          offsetY = diff;
        }
      }
      scene.mutateElement(container, {
        height: containerHeight,
        y: container.y - offsetY,
      });
    }

    scene.mutateElement(textElement, {
      text,
      width: nextWidth,
      height: nextHeight,
    });

    if (!isArrowElement(container)) {
      scene.mutateElement(
        textElement,
        computeBoundTextPosition(container, textElement, elementsMap),
      );
    }
  }
};

export const computeBoundTextPosition = (
  container: ExcalidrawElement,
  boundTextElement: ExcalidrawTextElementWithContainer,
  elementsMap: ElementsMap,
) => {
  if (isArrowElement(container)) {
    return LinearElementEditor.getBoundTextElementPosition(
      container,
      boundTextElement,
      elementsMap,
    );
  }
  const containerCoords = getContainerCoords(container);
  const maxContainerHeight = getBoundTextMaxHeight(container, boundTextElement);
  const maxContainerWidth = getBoundTextMaxWidth(container, boundTextElement);

  let x;
  let y;
  if (boundTextElement.verticalAlign === VERTICAL_ALIGN.TOP) {
    y = containerCoords.y;
  } else if (boundTextElement.verticalAlign === VERTICAL_ALIGN.BOTTOM) {
    y = containerCoords.y + (maxContainerHeight - boundTextElement.height);
  } else {
    y =
      containerCoords.y +
      (maxContainerHeight / 2 - boundTextElement.height / 2);
  }
  if (boundTextElement.textAlign === TEXT_ALIGN.LEFT) {
    x = containerCoords.x;
  } else if (boundTextElement.textAlign === TEXT_ALIGN.RIGHT) {
    x = containerCoords.x + (maxContainerWidth - boundTextElement.width);
  } else {
    x =
      containerCoords.x + (maxContainerWidth / 2 - boundTextElement.width / 2);
  }
  const angle = (container.angle ?? 0) as Radians;

  if (angle !== 0) {
    const contentCenter = pointFrom(
      containerCoords.x + maxContainerWidth / 2,
      containerCoords.y + maxContainerHeight / 2,
    );
    const textCenter = pointFrom(
      x + boundTextElement.width / 2,
      y + boundTextElement.height / 2,
    );

    const [rx, ry] = pointRotateRads(textCenter, contentCenter, angle);

    return {
      x: rx - boundTextElement.width / 2,
      y: ry - boundTextElement.height / 2,
    };
  }

  return { x, y };
};

export const getBoundTextElementId = (container: ExcalidrawElement | null) => {
  return container?.boundElements?.length
    ? container?.boundElements?.find((ele) => ele.type === "text")?.id || null
    : null;
};

export const getBoundTextElement = (
  element: ExcalidrawElement | null,
  elementsMap: ElementsMap,
): NonDeleted<ExcalidrawTextElementWithContainer> | null => {
  if (!element) {
    return null;
  }
  const boundTextElementId = getBoundTextElementId(element);

  if (boundTextElementId) {
    const boundTextElement = (elementsMap.get(boundTextElementId) ||
      null) as NonDeleted<ExcalidrawTextElementWithContainer> | null;

    // SAFETY: This should never happen, but log it just in case
    if (boundTextElement && !isNonDeletedElement(boundTextElement)) {
      console.error(
        "[NONDELETED][INVARIANT] Bound text element `isDeleted: true` which is not expected.",
      );
    }

    return boundTextElement;
  }
  return null;
};

export const getContainerElement = <
  T extends ExcalidrawTextElement,
  R extends ExcalidrawTextContainer,
>(
  element: T | null,
  elementsMap: ElementsMap,
): R | null => {
  if (!element) {
    return null;
  }
  if (element.containerId) {
    return (elementsMap.get(element.containerId) || null) as R | null;
  }
  return null;
};

/**
 * The point a text bound to this container centers on — and, for arrows, the
 * point the text tool snaps a new label to.
 */
export const getContainerCenter = (
  container: ExcalidrawElement,
  elementsMap: ElementsMap,
) => {
  if (!isArrowElement(container)) {
    return {
      x: container.x + container.width / 2,
      y: container.y + container.height / 2,
    };
  }

  const center = LinearElementEditor.getBoundTextElementCenter(
    container,
    elementsMap,
  );

  return { x: center[0], y: center[1] };
};

export const getContainerCoords = (container: ExcalidrawElement) => {
  let offsetX = BOUND_TEXT_PADDING;
  let offsetY = BOUND_TEXT_PADDING;

  if (container.type === "ellipse") {
    // The derivation of coordinates is explained in https://github.com/excalidraw/excalidraw/pull/6172
    offsetX += (container.width / 2) * (1 - Math.sqrt(2) / 2);
    offsetY += (container.height / 2) * (1 - Math.sqrt(2) / 2);
  }
  // The derivation of coordinates is explained in https://github.com/excalidraw/excalidraw/pull/6265
  if (container.type === "diamond") {
    offsetX += container.width / 4;
    offsetY += container.height / 4;
  }
  return {
    x: container.x + offsetX,
    y: container.y + offsetY,
  };
};

export const getTextElementAngle = (
  textElement: ExcalidrawTextElement,
  container: ExcalidrawTextContainer | null,
) => {
  if (isArrowElement(container)) {
    return 0;
  }
  if (!container) {
    return textElement.angle;
  }
  return container.angle;
};

export const getBoundTextElementPosition = (
  container: ExcalidrawElement,
  boundTextElement: ExcalidrawTextElementWithContainer,
  elementsMap: ElementsMap,
) => {
  if (isArrowElement(container)) {
    return LinearElementEditor.getBoundTextElementPosition(
      container,
      boundTextElement,
      elementsMap,
    );
  }
};

export const shouldAllowVerticalAlign = (
  selectedElements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
) => {
  return selectedElements.some((element) => {
    if (isBoundToContainer(element)) {
      const container = getContainerElement(element, elementsMap);
      if (isArrowElement(container)) {
        return false;
      }
      return true;
    }
    return false;
  });
};

export const suppportsHorizontalAlign = (
  selectedElements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
) => {
  return selectedElements.some((element) => {
    if (isBoundToContainer(element)) {
      const container = getContainerElement(element, elementsMap);
      if (isArrowElement(container)) {
        return false;
      }
      return true;
    }

    return isTextElement(element);
  });
};

const VALID_CONTAINER_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
]);

export const isValidTextContainer = (element: {
  type: ExcalidrawElementType;
}): element is ExcalidrawTextContainer =>
  VALID_CONTAINER_TYPES.has(element.type);

export const computeContainerDimensionForBoundText = (
  dimension: number,
  containerType: ExtractSetType<typeof VALID_CONTAINER_TYPES>,
) => {
  dimension = Math.ceil(dimension);
  const padding = BOUND_TEXT_PADDING * 2;

  if (containerType === "ellipse") {
    return Math.round(((dimension + padding) / Math.sqrt(2)) * 2);
  }
  if (containerType === "arrow") {
    return dimension + padding * 8;
  }
  if (containerType === "diamond") {
    return 2 * (dimension + padding);
  }
  return dimension + padding;
};

export const getBoundTextMaxWidth = (
  container: ExcalidrawElement,
  boundTextElement: ExcalidrawTextElement | null,
) => {
  const { width } = container;
  if (isArrowElement(container)) {
    const minWidth =
      (boundTextElement?.fontSize ?? DEFAULT_FONT_SIZE) *
      ARROW_LABEL_FONT_SIZE_TO_MIN_WIDTH_RATIO;
    return Math.max(ARROW_LABEL_WIDTH_FRACTION * width, minWidth);
  }
  if (container.type === "ellipse") {
    // The width of the largest rectangle inscribed inside an ellipse is
    // Math.round((ellipse.width / 2) * Math.sqrt(2)) which is derived from
    // equation of an ellipse -https://github.com/excalidraw/excalidraw/pull/6172
    return Math.round((width / 2) * Math.sqrt(2)) - BOUND_TEXT_PADDING * 2;
  }
  if (container.type === "diamond") {
    // The width of the largest rectangle inscribed inside a rhombus is
    // Math.round(width / 2) - https://github.com/excalidraw/excalidraw/pull/6265
    return Math.round(width / 2) - BOUND_TEXT_PADDING * 2;
  }
  return width - BOUND_TEXT_PADDING * 2;
};

export const getBoundTextMaxHeight = (
  container: ExcalidrawElement,
  boundTextElement: ExcalidrawTextElementWithContainer,
) => {
  const { height } = container;
  if (isArrowElement(container)) {
    const containerHeight = height - BOUND_TEXT_PADDING * 8 * 2;
    if (containerHeight <= 0) {
      return boundTextElement.height;
    }
    return height;
  }
  if (container.type === "ellipse") {
    // The height of the largest rectangle inscribed inside an ellipse is
    // Math.round((ellipse.height / 2) * Math.sqrt(2)) which is derived from
    // equation of an ellipse - https://github.com/excalidraw/excalidraw/pull/6172
    return Math.round((height / 2) * Math.sqrt(2)) - BOUND_TEXT_PADDING * 2;
  }
  if (container.type === "diamond") {
    // The height of the largest rectangle inscribed inside a rhombus is
    // Math.round(height / 2) - https://github.com/excalidraw/excalidraw/pull/6265
    return Math.round(height / 2) - BOUND_TEXT_PADDING * 2;
  }
  return height - BOUND_TEXT_PADDING * 2;
};

/** retrieves text from text elements and concatenates to a single string */
export const getTextFromElements = (
  elements: readonly ExcalidrawElement[],
  separator = "\n\n",
) => {
  const text = elements
    .reduce((acc: string[], element) => {
      if (isTextElement(element)) {
        acc.push(element.text);
      }
      return acc;
    }, [])
    .join(separator);
  return text;
};
