import {
  pointFrom,
  pointRotateRads,
  rangeInclusive,
  rangeIntersection,
  rangesOverlap,
  type GlobalPoint,
} from "@excalidraw/math";

import { TOOL_TYPE, KEYS } from "@excalidraw/common";
import {
  getCommonBounds,
  getElementAbsoluteCoords,
  getFreeTextInteractionCoords,
  getMaximumGroups,
  getSelectedElements,
  getVisibleAndNonSelectedElements,
  isBoundToContainer,
  isTextElement,
} from "@excalidraw/element";

import type { InclusiveRange } from "@excalidraw/math";
import type { Bounds } from "@excalidraw/common";
import type { MaybeTransformHandleType } from "@excalidraw/element";
import type {
  ElementsMap,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type {
  AppClassProperties,
  AppState,
  KeyboardModifiersObject,
} from "./types";

const SNAP_DISTANCE = 5;
const MIN_GAP_LENGTH = 4;
const VISIBLE_GAPS_LIMIT_PER_AXIS = 2000;
const NON_LAYOUT_SNAP_TYPES = new Set(["arrow", "line", "freedraw"]);
const COLINEAR_TOLERANCE = 0.5;

// snap distance with zoom value taken into consideration
export const getSnapDistance = (zoomValue: number) => {
  return SNAP_DISTANCE / zoomValue;
};

type Vector2D = {
  x: number;
  y: number;
};

type PointPair = [GlobalPoint, GlobalPoint];

export type SnapRole = "edge" | "center";

export type ReferenceSnapBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  isFrame?: boolean;
};

export type PointSnap = {
  type: "point";
  points: PointPair;
  offset: number;
  role: SnapRole;
  perpDistance: number;
  refBounds?: Bounds;
};

export type Gap = {
  startBounds: Bounds;
  endBounds: Bounds;
  startSide: [GlobalPoint, GlobalPoint];
  endSide: [GlobalPoint, GlobalPoint];
  overlap: InclusiveRange;
  length: number;
};

export type GapSnap = {
  type: "gap";
  direction:
    | "center_horizontal"
    | "center_vertical"
    | "side_left"
    | "side_right"
    | "side_top"
    | "side_bottom";
  gap: Gap;
  offset: number;
};

export type GapSnaps = GapSnap[];

export type Snap = GapSnap | PointSnap;
export type Snaps = Snap[];

export type PointSnapLine = {
  type: "points";
  points: GlobalPoint[];
  role?: SnapRole;
};

export type PointerSnapLine = {
  type: "pointer";
  points: PointPair;
  direction: "horizontal" | "vertical";
};

export type GapSnapLine = {
  type: "gap";
  direction: "horizontal" | "vertical";
  points: PointPair;
  distance?: number;
  bandSpan?: InclusiveRange;
  alwaysShowPill?: boolean;
};

export type SnapLine = PointSnapLine | GapSnapLine | PointerSnapLine;

// -----------------------------------------------------------------------------

export class SnapCache {
  private static referenceSnapPoints: GlobalPoint[] | null = null;
  private static referenceSnapBoxes: ReferenceSnapBox[] | null = null;

  private static visibleGaps: {
    verticalGaps: Gap[];
    horizontalGaps: Gap[];
  } | null = null;

  public static setReferenceSnapPoints = (snapPoints: GlobalPoint[] | null) => {
    SnapCache.referenceSnapPoints = snapPoints;
    if (snapPoints === null) {
      SnapCache.referenceSnapBoxes = null;
    }
  };

  public static getReferenceSnapPoints = () => {
    return SnapCache.referenceSnapPoints;
  };

  public static setReferenceSnapBoxes = (boxes: ReferenceSnapBox[] | null) => {
    SnapCache.referenceSnapBoxes = boxes;
  };

  public static getReferenceSnapBoxes = () => {
    return SnapCache.referenceSnapBoxes;
  };

  public static setVisibleGaps = (
    gaps: {
      verticalGaps: Gap[];
      horizontalGaps: Gap[];
    } | null,
  ) => {
    SnapCache.visibleGaps = gaps;
  };

  public static getVisibleGaps = () => {
    return SnapCache.visibleGaps;
  };

  public static destroy = () => {
    SnapCache.referenceSnapPoints = null;
    SnapCache.referenceSnapBoxes = null;
    SnapCache.visibleGaps = null;
  };
}

// -----------------------------------------------------------------------------

export const isGridModeEnabled = (app: AppClassProperties): boolean =>
  app.props.gridModeEnabled ?? app.state.gridModeEnabled;

export const isSnappingEnabled = ({
  event,
  app,
  selectedElements,
}: {
  app: AppClassProperties;
  event: KeyboardModifiersObject;
  selectedElements: readonly NonDeletedExcalidrawElement[];
}) => {
  if (event) {
    // Allow snapping for lasso tool when dragging selected elements
    // but not during lasso selection phase
    const isLassoDragging =
      app.state.activeTool.type === "lasso" &&
      app.state.selectedElementsAreBeingDragged;

    return (
      (app.state.activeTool.type !== "lasso" || isLassoDragging) &&
      ((app.state.objectsSnapModeEnabled && !event[KEYS.CTRL_OR_CMD]) ||
        (!app.state.objectsSnapModeEnabled &&
          event[KEYS.CTRL_OR_CMD] &&
          !isGridModeEnabled(app)))
    );
  }

  // do not suggest snaps for an arrow to give way to binding
  if (selectedElements.length === 1 && selectedElements[0].type === "arrow") {
    return false;
  }
  return app.state.objectsSnapModeEnabled;
};

export const areRoughlyEqual = (a: number, b: number, precision = 0.01) => {
  return Math.abs(a - b) <= precision;
};

const round = (x: number) => {
  const decimalPlaces = 6;
  return Math.round(x * 10 ** decimalPlaces) / 10 ** decimalPlaces;
};

const isStrictlyContainedIn = (inner: Bounds, outer: Bounds): boolean =>
  inner[0] >= outer[0] &&
  inner[1] >= outer[1] &&
  inner[2] <= outer[2] &&
  inner[3] <= outer[3] &&
  (inner[2] - inner[0] < outer[2] - outer[0] ||
    inner[3] - inner[1] < outer[3] - outer[1]);

const boundsToBox = (bounds: Bounds, isFrame = false): ReferenceSnapBox => {
  const minX = round(bounds[0]);
  const minY = round(bounds[1]);
  const maxX = round(bounds[2]);
  const maxY = round(bounds[3]);
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: round((minX + maxX) / 2),
    cy: round((minY + maxY) / 2),
    isFrame,
  };
};

const isFrameLike = (el: ExcalidrawElement) =>
  el.type === "frame" || el.type === "magicframe";

const getElementSnapBounds = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
): Bounds => {
  if (isTextElement(element) && !element.containerId) {
    const coords = getFreeTextInteractionCoords(element);
    if (coords) {
      const [x1, y1, x2, y2, cx, cy] = coords;
      if (areRoughlyEqual(element.angle, 0)) {
        return [x1, y1, x2, y2];
      }
      const center = pointFrom<GlobalPoint>(cx, cy);
      const corners = [
        pointRotateRads<GlobalPoint>(pointFrom(x1, y1), center, element.angle),
        pointRotateRads<GlobalPoint>(pointFrom(x2, y1), center, element.angle),
        pointRotateRads<GlobalPoint>(pointFrom(x1, y2), center, element.angle),
        pointRotateRads<GlobalPoint>(pointFrom(x2, y2), center, element.angle),
      ];
      return [
        Math.min(...corners.map((p) => p[0])),
        Math.min(...corners.map((p) => p[1])),
        Math.max(...corners.map((p) => p[0])),
        Math.max(...corners.map((p) => p[1])),
      ];
    }
  }
  if (areRoughlyEqual(element.angle, 0)) {
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
    return [x1, y1, x2, y2];
  }
  return getCommonBounds([element]);
};

export const getSnapBounds = (
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
  dragOffset?: Vector2D,
): Bounds => {
  if (elements.length === 0) {
    return [0, 0, 0, 0];
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    const [x1, y1, x2, y2] = getElementSnapBounds(el, elementsMap);
    if (x1 < minX) {
      minX = x1;
    }
    if (y1 < minY) {
      minY = y1;
    }
    if (x2 > maxX) {
      maxX = x2;
    }
    if (y2 > maxY) {
      maxY = y2;
    }
  }

  if (dragOffset) {
    return [
      minX + dragOffset.x,
      minY + dragOffset.y,
      maxX + dragOffset.x,
      maxY + dragOffset.y,
    ];
  }

  return [minX, minY, maxX, maxY];
};

const isContainerCandidate = (group: readonly ExcalidrawElement[]) =>
  group.length === 1 &&
  (group[0].type === "rectangle" || isFrameLike(group[0]));

export const getElementsCorners = (
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
  {
    omitCenter,
    boundingBoxCorners,
    dragOffset,
  }: {
    omitCenter?: boolean;
    boundingBoxCorners?: boolean;
    dragOffset?: Vector2D;
  } = {
    omitCenter: false,
    boundingBoxCorners: false,
  },
): GlobalPoint[] => {
  let result: GlobalPoint[] = [];

  if (elements.length === 1) {
    const element = elements[0];

    let [x1, y1, x2, y2, cx, cy] =
      (isTextElement(element) && !element.containerId
        ? getFreeTextInteractionCoords(element)
        : null) ?? getElementAbsoluteCoords(element, elementsMap);

    if (dragOffset) {
      x1 += dragOffset.x;
      x2 += dragOffset.x;
      cx += dragOffset.x;

      y1 += dragOffset.y;
      y2 += dragOffset.y;
      cy += dragOffset.y;
    }

    const halfWidth = (x2 - x1) / 2;
    const halfHeight = (y2 - y1) / 2;

    if (
      (element.type === "diamond" || element.type === "ellipse") &&
      !boundingBoxCorners
    ) {
      const leftMid = pointRotateRads<GlobalPoint>(
        pointFrom(x1, y1 + halfHeight),
        pointFrom(cx, cy),
        element.angle,
      );
      const topMid = pointRotateRads<GlobalPoint>(
        pointFrom(x1 + halfWidth, y1),
        pointFrom(cx, cy),
        element.angle,
      );
      const rightMid = pointRotateRads<GlobalPoint>(
        pointFrom(x2, y1 + halfHeight),
        pointFrom(cx, cy),
        element.angle,
      );
      const bottomMid = pointRotateRads<GlobalPoint>(
        pointFrom(x1 + halfWidth, y2),
        pointFrom(cx, cy),
        element.angle,
      );
      const center = pointFrom<GlobalPoint>(cx, cy);

      result = omitCenter
        ? [leftMid, topMid, rightMid, bottomMid]
        : [leftMid, topMid, rightMid, bottomMid, center];
    } else {
      const topLeft = pointRotateRads<GlobalPoint>(
        pointFrom(x1, y1),
        pointFrom(cx, cy),
        element.angle,
      );
      const topRight = pointRotateRads<GlobalPoint>(
        pointFrom(x2, y1),
        pointFrom(cx, cy),
        element.angle,
      );
      const bottomLeft = pointRotateRads<GlobalPoint>(
        pointFrom(x1, y2),
        pointFrom(cx, cy),
        element.angle,
      );
      const bottomRight = pointRotateRads<GlobalPoint>(
        pointFrom(x2, y2),
        pointFrom(cx, cy),
        element.angle,
      );
      const center = pointFrom<GlobalPoint>(cx, cy);

      result = omitCenter
        ? [topLeft, topRight, bottomLeft, bottomRight]
        : [topLeft, topRight, bottomLeft, bottomRight, center];
    }
  } else if (elements.length > 1) {
    const [minX, minY, maxX, maxY] = getSnapBounds(
      elements,
      elementsMap,
      dragOffset ?? { x: 0, y: 0 },
    );
    const width = maxX - minX;
    const height = maxY - minY;

    const topLeft = pointFrom<GlobalPoint>(minX, minY);
    const topRight = pointFrom<GlobalPoint>(maxX, minY);
    const bottomLeft = pointFrom<GlobalPoint>(minX, maxY);
    const bottomRight = pointFrom<GlobalPoint>(maxX, maxY);
    const center = pointFrom<GlobalPoint>(minX + width / 2, minY + height / 2);

    result = omitCenter
      ? [topLeft, topRight, bottomLeft, bottomRight]
      : [topLeft, topRight, bottomLeft, bottomRight, center];
  }

  return result.map((p) => pointFrom(round(p[0]), round(p[1])));
};

const getReferenceElements = (
  elements: readonly NonDeletedExcalidrawElement[],
  selectedElements: readonly ExcalidrawElement[],
  appState: AppState,
  elementsMap: ElementsMap,
) =>
  getVisibleAndNonSelectedElements(
    elements,
    selectedElements,
    appState,
    elementsMap,
  ).filter((el) => !NON_LAYOUT_SNAP_TYPES.has(el.type));

type FilteredReferenceEntry = {
  group: NonDeletedExcalidrawElement[];
  bounds: Bounds;
  isEnclosingFrame: boolean;
};

const getFilteredReferenceEntries = (
  elements: readonly NonDeletedExcalidrawElement[],
  selectedElements: readonly NonDeletedExcalidrawElement[],
  appState: AppState,
  elementsMap: ElementsMap,
): FilteredReferenceEntry[] => {
  const referenceElements = getReferenceElements(
    elements,
    selectedElements,
    appState,
    elementsMap,
  );

  const groups = getMaximumGroups(referenceElements, elementsMap).filter(
    (elementsGroup) =>
      !(elementsGroup.length === 1 && isBoundToContainer(elementsGroup[0])),
  );

  const selectionBounds: Bounds | null =
    selectedElements.length > 0
      ? getSnapBounds(selectedElements, elementsMap)
      : null;

  const entries = groups.map((group) => {
    const bounds = getSnapBounds(group, elementsMap).map((b) =>
      round(b),
    ) as unknown as Bounds;
    const isFrame = group.length === 1 && isFrameLike(group[0]);
    const isEnclosingFrame =
      isFrame &&
      (selectionBounds !== null
        ? isStrictlyContainedIn(selectionBounds, bounds) ||
          selectedElements.some((el) => el.frameId === group[0].id)
        : false);
    return {
      group,
      bounds,
      isContainer: isContainerCandidate(group),
      isEnclosingFrame,
    };
  });

  const containers = entries.filter((e) => e.isContainer);

  return entries
    .filter((entry) => {
      if (entry.isEnclosingFrame) {
        return true;
      }
      const enclosing = containers.find(
        (c) => c !== entry && isStrictlyContainedIn(entry.bounds, c.bounds),
      );
      if (!enclosing) {
        return true;
      }
      // Keep inner siblings when dragging inside the same container.
      return selectionBounds
        ? isStrictlyContainedIn(selectionBounds, enclosing.bounds)
        : false;
    })
    .map(({ group, bounds, isEnclosingFrame }) => ({
      group,
      bounds,
      isEnclosingFrame,
    }));
};

const hasOccludingBoxX = (
  sorted: readonly Bounds[],
  startIdx: number,
  endIdx: number,
  startMaxX: number,
  endMinX: number,
  overlapY: InclusiveRange,
): boolean => {
  for (let k = startIdx + 1; k < endIdx; k++) {
    const [kMinX, kMinY, kMaxX, kMaxY] = sorted[k];
    if (
      kMaxX > startMaxX &&
      kMinX < endMinX &&
      rangesOverlap(rangeInclusive(kMinY, kMaxY), overlapY)
    ) {
      return true;
    }
  }
  return false;
};

const hasOccludingBoxY = (
  sorted: readonly Bounds[],
  startIdx: number,
  endIdx: number,
  startMaxY: number,
  endMinY: number,
  overlapX: InclusiveRange,
): boolean => {
  for (let k = startIdx + 1; k < endIdx; k++) {
    const [kMinX, kMinY, kMaxX, kMaxY] = sorted[k];
    if (
      kMaxY > startMaxY &&
      kMinY < endMinY &&
      rangesOverlap(rangeInclusive(kMinX, kMaxX), overlapX)
    ) {
      return true;
    }
  }
  return false;
};

export const getVisibleGaps = (
  elements: readonly NonDeletedExcalidrawElement[],
  selectedElements: readonly NonDeletedExcalidrawElement[],
  appState: AppState,
  elementsMap: ElementsMap,
) => {
  const referenceBounds = getFilteredReferenceEntries(
    elements,
    selectedElements,
    appState,
    elementsMap,
  )
    .filter((entry) => !entry.isEnclosingFrame)
    .map((entry) => entry.bounds);

  const horizontallySorted = [...referenceBounds].sort((a, b) => a[0] - b[0]);
  const horizontalGaps: Gap[] = [];

  let c = 0;
  horizontal: for (let i = 0; i < horizontallySorted.length; i++) {
    const startBounds = horizontallySorted[i];
    const [, startMinY, startMaxX, startMaxY] = startBounds;
    const startRangeY = rangeInclusive(startMinY, startMaxY);

    for (let j = i + 1; j < horizontallySorted.length; j++) {
      if (++c > VISIBLE_GAPS_LIMIT_PER_AXIS) {
        break horizontal;
      }

      const endBounds = horizontallySorted[j];
      const [endMinX, endMinY, , endMaxY] = endBounds;
      const gapLength = endMinX - startMaxX;

      if (gapLength < MIN_GAP_LENGTH) {
        continue;
      }

      const endRangeY = rangeInclusive(endMinY, endMaxY);
      if (!rangesOverlap(startRangeY, endRangeY)) {
        continue;
      }

      const overlap = rangeIntersection(startRangeY, endRangeY)!;
      if (
        hasOccludingBoxX(horizontallySorted, i, j, startMaxX, endMinX, overlap)
      ) {
        continue;
      }

      horizontalGaps.push({
        startBounds,
        endBounds,
        startSide: [
          pointFrom(startMaxX, startMinY),
          pointFrom(startMaxX, startMaxY),
        ],
        endSide: [pointFrom(endMinX, endMinY), pointFrom(endMinX, endMaxY)],
        length: round(gapLength),
        overlap,
      });

      // If endBounds fully covers startBounds vertically, no later box can be
      // an unoccluded direct horizontal neighbor of startBounds.
      if (endMinY <= startMinY && endMaxY >= startMaxY) {
        break;
      }
    }
  }

  const verticallySorted = [...referenceBounds].sort((a, b) => a[1] - b[1]);
  const verticalGaps: Gap[] = [];

  c = 0;
  vertical: for (let i = 0; i < verticallySorted.length; i++) {
    const startBounds = verticallySorted[i];
    const [startMinX, , startMaxX, startMaxY] = startBounds;
    const startRangeX = rangeInclusive(startMinX, startMaxX);

    for (let j = i + 1; j < verticallySorted.length; j++) {
      if (++c > VISIBLE_GAPS_LIMIT_PER_AXIS) {
        break vertical;
      }

      const endBounds = verticallySorted[j];
      const [endMinX, endMinY, endMaxX] = endBounds;
      const gapLength = endMinY - startMaxY;

      if (gapLength < MIN_GAP_LENGTH) {
        continue;
      }

      const endRangeX = rangeInclusive(endMinX, endMaxX);
      if (!rangesOverlap(startRangeX, endRangeX)) {
        continue;
      }

      const overlap = rangeIntersection(startRangeX, endRangeX)!;
      if (
        hasOccludingBoxY(verticallySorted, i, j, startMaxY, endMinY, overlap)
      ) {
        continue;
      }

      verticalGaps.push({
        startBounds,
        endBounds,
        startSide: [
          pointFrom(startMinX, startMaxY),
          pointFrom(startMaxX, startMaxY),
        ],
        endSide: [pointFrom(endMinX, endMinY), pointFrom(endMaxX, endMinY)],
        length: round(gapLength),
        overlap,
      });

      if (endMinX <= startMinX && endMaxX >= startMaxX) {
        break;
      }
    }
  }

  return {
    horizontalGaps,
    verticalGaps,
  };
};

const getGapSnaps = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  dragOffset: Vector2D,
  app: AppClassProperties,
  event: KeyboardModifiersObject,
  nearestSnapsX: Snaps,
  nearestSnapsY: Snaps,
  minOffset: Vector2D,
  elementsMap: ElementsMap,
) => {
  if (!isSnappingEnabled({ app, event, selectedElements })) {
    return;
  }

  if (selectedElements.length === 0) {
    return;
  }

  const visibleGaps = SnapCache.getVisibleGaps();
  if (!visibleGaps) {
    return;
  }

  const { horizontalGaps, verticalGaps } = visibleGaps;

  const [minX, minY, maxX, maxY] = getSnapBounds(
    selectedElements,
    elementsMap,
    dragOffset,
  ).map((bound) => round(bound));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  for (const gap of horizontalGaps) {
    if (!rangesOverlap(rangeInclusive(minY, maxY), gap.overlap)) {
      continue;
    }

    // center gap (selection fits between start and end with >= MIN_GAP_LENGTH on each side)
    const gapMidX = gap.startSide[0][0] + gap.length / 2;
    const centerOffset = round(gapMidX - centerX);
    const sideGapSize = (gap.length - (maxX - minX)) / 2;

    if (
      sideGapSize >= MIN_GAP_LENGTH &&
      Math.abs(centerOffset) <= minOffset.x
    ) {
      if (Math.abs(centerOffset) < minOffset.x) {
        nearestSnapsX.length = 0;
      }
      minOffset.x = Math.abs(centerOffset);
      nearestSnapsX.push({
        type: "gap",
        direction: "center_horizontal",
        gap,
        offset: centerOffset,
      });
      continue;
    }

    // side gap, from the right
    const [, , endMaxX] = gap.endBounds;
    const distanceToEndElementX = minX - endMaxX;
    const sideOffsetRight = round(gap.length - distanceToEndElementX);

    if (
      distanceToEndElementX + sideOffsetRight >= MIN_GAP_LENGTH &&
      Math.abs(sideOffsetRight) <= minOffset.x
    ) {
      if (Math.abs(sideOffsetRight) < minOffset.x) {
        nearestSnapsX.length = 0;
      }
      minOffset.x = Math.abs(sideOffsetRight);
      nearestSnapsX.push({
        type: "gap",
        direction: "side_right",
        gap,
        offset: sideOffsetRight,
      });
      continue;
    }

    // side gap, from the left
    const [startMinX] = gap.startBounds;
    const distanceToStartElementX = startMinX - maxX;
    const sideOffsetLeft = round(distanceToStartElementX - gap.length);

    if (
      distanceToStartElementX - sideOffsetLeft >= MIN_GAP_LENGTH &&
      Math.abs(sideOffsetLeft) <= minOffset.x
    ) {
      if (Math.abs(sideOffsetLeft) < minOffset.x) {
        nearestSnapsX.length = 0;
      }
      minOffset.x = Math.abs(sideOffsetLeft);
      nearestSnapsX.push({
        type: "gap",
        direction: "side_left",
        gap,
        offset: sideOffsetLeft,
      });
      continue;
    }
  }

  for (const gap of verticalGaps) {
    if (!rangesOverlap(rangeInclusive(minX, maxX), gap.overlap)) {
      continue;
    }

    // center gap
    const gapMidY = gap.startSide[0][1] + gap.length / 2;
    const centerOffset = round(gapMidY - centerY);
    const sideGapSize = (gap.length - (maxY - minY)) / 2;

    if (
      sideGapSize >= MIN_GAP_LENGTH &&
      Math.abs(centerOffset) <= minOffset.y
    ) {
      if (Math.abs(centerOffset) < minOffset.y) {
        nearestSnapsY.length = 0;
      }
      minOffset.y = Math.abs(centerOffset);
      nearestSnapsY.push({
        type: "gap",
        direction: "center_vertical",
        gap,
        offset: centerOffset,
      });
      continue;
    }

    // side gap, from the top
    const [, startMinY] = gap.startBounds;
    const distanceToStartElementY = startMinY - maxY;
    const sideOffsetTop = round(distanceToStartElementY - gap.length);

    if (
      distanceToStartElementY - sideOffsetTop >= MIN_GAP_LENGTH &&
      Math.abs(sideOffsetTop) <= minOffset.y
    ) {
      if (Math.abs(sideOffsetTop) < minOffset.y) {
        nearestSnapsY.length = 0;
      }
      minOffset.y = Math.abs(sideOffsetTop);
      nearestSnapsY.push({
        type: "gap",
        direction: "side_top",
        gap,
        offset: sideOffsetTop,
      });
      continue;
    }

    // side gap, from the bottom
    const [, , , endMaxY] = gap.endBounds;
    const distanceToEndElementY = round(minY - endMaxY);
    const sideOffsetBottom = round(gap.length - distanceToEndElementY);

    if (
      distanceToEndElementY + sideOffsetBottom >= MIN_GAP_LENGTH &&
      Math.abs(sideOffsetBottom) <= minOffset.y
    ) {
      if (Math.abs(sideOffsetBottom) < minOffset.y) {
        nearestSnapsY.length = 0;
      }
      minOffset.y = Math.abs(sideOffsetBottom);
      nearestSnapsY.push({
        type: "gap",
        direction: "side_bottom",
        gap,
        offset: sideOffsetBottom,
      });
      continue;
    }
  }
};

export const getReferenceSnapPoints = (
  elements: readonly NonDeletedExcalidrawElement[],
  selectedElements: readonly NonDeletedExcalidrawElement[],
  appState: AppState,
  elementsMap: ElementsMap,
) => {
  const entries = getFilteredReferenceEntries(
    elements,
    selectedElements,
    appState,
    elementsMap,
  );

  const boxes = entries.map((entry) =>
    boundsToBox(entry.bounds, entry.isEnclosingFrame),
  );
  SnapCache.setReferenceSnapBoxes(boxes);

  return entries.flatMap((entry) =>
    getElementsCorners(entry.group, elementsMap),
  );
};

const getRolePointSnaps = (
  selectionBox: ReferenceSnapBox,
  referenceBoxes: readonly ReferenceSnapBox[],
  maxOffsetX: number,
  maxOffsetY: number,
): { snapsX: PointSnap[]; snapsY: PointSnap[] } => {
  const snapsX: PointSnap[] = [];
  const snapsY: PointSnap[] = [];

  for (const ref of referenceBoxes) {
    const refBounds: Bounds = [ref.minX, ref.minY, ref.maxX, ref.maxY];
    const perpY = Math.abs(selectionBox.cy - ref.cy);
    const perpX = Math.abs(selectionBox.cx - ref.cx);

    const pairsX: Array<[number, number, SnapRole]> = ref.isFrame
      ? [
          [selectionBox.cx, ref.cx, "center"],
          [selectionBox.minX, ref.minX, "edge"],
          [selectionBox.maxX, ref.maxX, "edge"],
        ]
      : [
          [selectionBox.cx, ref.cx, "center"],
          [selectionBox.minX, ref.minX, "edge"],
          [selectionBox.maxX, ref.maxX, "edge"],
          [selectionBox.minX, ref.maxX, "edge"],
          [selectionBox.maxX, ref.minX, "edge"],
        ];

    for (const [selX, refX, role] of pairsX) {
      const offsetX = round(refX - selX);
      if (Math.abs(offsetX) <= maxOffsetX) {
        snapsX.push({
          type: "point",
          points: [
            pointFrom<GlobalPoint>(selX, selectionBox.cy),
            pointFrom<GlobalPoint>(refX, ref.cy),
          ],
          offset: offsetX,
          role,
          perpDistance: perpY,
          refBounds,
        });
      }
    }

    const pairsY: Array<[number, number, SnapRole]> = ref.isFrame
      ? [
          [selectionBox.cy, ref.cy, "center"],
          [selectionBox.minY, ref.minY, "edge"],
          [selectionBox.maxY, ref.maxY, "edge"],
        ]
      : [
          [selectionBox.cy, ref.cy, "center"],
          [selectionBox.minY, ref.minY, "edge"],
          [selectionBox.maxY, ref.maxY, "edge"],
          [selectionBox.minY, ref.maxY, "edge"],
          [selectionBox.maxY, ref.minY, "edge"],
        ];

    for (const [selY, refY, role] of pairsY) {
      const offsetY = round(refY - selY);
      if (Math.abs(offsetY) <= maxOffsetY) {
        snapsY.push({
          type: "point",
          points: [
            pointFrom<GlobalPoint>(selectionBox.cx, selY),
            pointFrom<GlobalPoint>(ref.cx, refY),
          ],
          offset: offsetY,
          role,
          perpDistance: perpX,
          refBounds,
        });
      }
    }
  }

  return { snapsX, snapsY };
};

const pickBestPointSnap = (
  candidates: readonly PointSnap[],
  zoomValue: number,
): PointSnap | null => {
  if (candidates.length === 0) {
    return null;
  }
  const tieBand = 1.5 / zoomValue;
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const diff = Math.abs(c.offset) - Math.abs(best.offset);
    if (diff < -tieBand) {
      best = c;
    } else if (Math.abs(diff) <= tieBand) {
      // Within tie band: prefer center over edge, then nearest visual neighbor.
      if (c.role === "center" && best.role !== "center") {
        best = c;
      } else if (c.role === best.role) {
        if (
          c.perpDistance < best.perpDistance ||
          (c.perpDistance === best.perpDistance &&
            Math.abs(c.offset) < Math.abs(best.offset))
        ) {
          best = c;
        }
      }
    }
  }
  return best;
};

const getPointSnaps = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  selectionSnapPoints: GlobalPoint[],
  app: AppClassProperties,
  event: KeyboardModifiersObject,
  nearestSnapsX: Snaps,
  nearestSnapsY: Snaps,
  minOffset: Vector2D,
) => {
  if (
    !isSnappingEnabled({ app, event, selectedElements }) ||
    (selectedElements.length === 0 && selectionSnapPoints.length === 0)
  ) {
    return;
  }

  const referenceSnapPoints = SnapCache.getReferenceSnapPoints();

  if (referenceSnapPoints) {
    for (const thisSnapPoint of selectionSnapPoints) {
      for (const otherSnapPoint of referenceSnapPoints) {
        const offsetX = otherSnapPoint[0] - thisSnapPoint[0];
        const offsetY = otherSnapPoint[1] - thisSnapPoint[1];

        if (Math.abs(offsetX) <= minOffset.x) {
          if (Math.abs(offsetX) < minOffset.x) {
            nearestSnapsX.length = 0;
          }

          nearestSnapsX.push({
            type: "point",
            points: [thisSnapPoint, otherSnapPoint],
            offset: offsetX,
            role: "edge",
            perpDistance: Math.abs(otherSnapPoint[1] - thisSnapPoint[1]),
          });

          minOffset.x = Math.abs(offsetX);
        }

        if (Math.abs(offsetY) <= minOffset.y) {
          if (Math.abs(offsetY) < minOffset.y) {
            nearestSnapsY.length = 0;
          }

          nearestSnapsY.push({
            type: "point",
            points: [thisSnapPoint, otherSnapPoint],
            offset: offsetY,
            role: "edge",
            perpDistance: Math.abs(otherSnapPoint[0] - thisSnapPoint[0]),
          });

          minOffset.y = Math.abs(offsetY);
        }
      }
    }
  }
};

export const snapDraggedElements = (
  elements: ExcalidrawElement[],
  dragOffset: Vector2D,
  app: AppClassProperties,
  event: KeyboardModifiersObject,
  elementsMap: ElementsMap,
) => {
  const appState = app.state;
  const selectedElements = getSelectedElements(elements, appState);
  if (
    !isSnappingEnabled({ app, event, selectedElements }) ||
    selectedElements.length === 0
  ) {
    return {
      snapOffset: {
        x: 0,
        y: 0,
      },
      snapLines: [],
    };
  }
  dragOffset.x = round(dragOffset.x);
  dragOffset.y = round(dragOffset.y);
  const snapDistance = getSnapDistance(appState.zoom.value);
  const referenceBoxes = SnapCache.getReferenceSnapBoxes();

  const rawBounds = getSnapBounds(selectedElements, elementsMap, dragOffset);
  const selectionBox = boundsToBox(rawBounds);

  let bestPointX: PointSnap | null = null;
  let bestPointY: PointSnap | null = null;

  if (referenceBoxes) {
    const { snapsX, snapsY } = getRolePointSnaps(
      selectionBox,
      referenceBoxes,
      snapDistance,
      snapDistance,
    );
    bestPointX = pickBestPointSnap(snapsX, appState.zoom.value);
    bestPointY = pickBestPointSnap(snapsY, appState.zoom.value);
  }

  const gapSnapsX: Snaps = [];
  const gapSnapsY: Snaps = [];
  const gapMinOffset = {
    x: bestPointX ? Math.abs(bestPointX.offset) : snapDistance,
    y: bestPointY ? Math.abs(bestPointY.offset) : snapDistance,
  };

  getGapSnaps(
    selectedElements,
    dragOffset,
    app,
    event,
    gapSnapsX,
    gapSnapsY,
    gapMinOffset,
    elementsMap,
  );

  // If a gap snap is strictly closer than the point snap (or no point snap exists), use it.
  const winOffsetX =
    gapSnapsX.length > 0 &&
    (!bestPointX || Math.abs(gapSnapsX[0].offset) < Math.abs(bestPointX.offset))
      ? gapSnapsX[0].offset
      : (bestPointX?.offset ?? 0);

  const winOffsetY =
    gapSnapsY.length > 0 &&
    (!bestPointY || Math.abs(gapSnapsY[0].offset) < Math.abs(bestPointY.offset))
      ? gapSnapsY[0].offset
      : (bestPointY?.offset ?? 0);

  const snapOffset = {
    x: winOffsetX,
    y: winOffsetY,
  };

  // Re-evaluate exact matches at the snapped position for rendering guides.
  const newDragOffset = {
    x: round(dragOffset.x + snapOffset.x),
    y: round(dragOffset.y + snapOffset.y),
  };
  const snappedBounds = getSnapBounds(
    selectedElements,
    elementsMap,
    newDragOffset,
  );
  const snappedBox = boundsToBox(snappedBounds);

  let exactPointSnapsX: PointSnap[] = [];
  let exactPointSnapsY: PointSnap[] = [];
  if (referenceBoxes) {
    const exact = getRolePointSnaps(
      snappedBox,
      referenceBoxes,
      COLINEAR_TOLERANCE,
      COLINEAR_TOLERANCE,
    );
    exactPointSnapsX = exact.snapsX;
    exactPointSnapsY = exact.snapsY;
  }

  const exactGapSnapsX: Snaps = [];
  const exactGapSnapsY: Snaps = [];
  getGapSnaps(
    selectedElements,
    newDragOffset,
    app,
    event,
    exactGapSnapsX,
    exactGapSnapsY,
    { x: COLINEAR_TOLERANCE, y: COLINEAR_TOLERANCE },
    elementsMap,
  );

  const pointSnapLines = createPointSnapLines(
    exactPointSnapsX,
    exactPointSnapsY,
    snappedBounds,
  );

  const gapSnapLines = createGapSnapLines(
    selectedElements,
    newDragOffset,
    [
      ...pickBestGapPerAxis(exactGapSnapsX as GapSnap[], snappedBox, "x"),
      ...pickBestGapPerAxis(exactGapSnapsY as GapSnap[], snappedBox, "y"),
    ],
    elementsMap,
  );

  return {
    snapOffset,
    snapLines: [...pointSnapLines, ...gapSnapLines],
  };
};

const pickBestGapPerAxis = (
  gapSnaps: readonly GapSnap[],
  selectionBox: ReferenceSnapBox,
  axis: "x" | "y",
): GapSnap[] => {
  if (gapSnaps.length <= 1) {
    return [...gapSnaps];
  }
  let best = gapSnaps[0];
  let bestDist = gapPerpDistance(best, selectionBox, axis);
  for (let i = 1; i < gapSnaps.length; i++) {
    const d = gapPerpDistance(gapSnaps[i], selectionBox, axis);
    if (d < bestDist) {
      best = gapSnaps[i];
      bestDist = d;
    }
  }
  return [best];
};

const gapPerpDistance = (
  gapSnap: GapSnap,
  selectionBox: ReferenceSnapBox,
  axis: "x" | "y",
): number => {
  const gapMidPerp = (gapSnap.gap.overlap[0] + gapSnap.gap.overlap[1]) / 2;
  return axis === "x"
    ? Math.abs(selectionBox.cy - gapMidPerp)
    : Math.abs(selectionBox.cx - gapMidPerp);
};

const dedupePoints = (points: GlobalPoint[]): GlobalPoint[] => {
  const map = new Map<string, GlobalPoint>();

  for (const point of points) {
    const key = point.join(",");

    if (!map.has(key)) {
      map.set(key, point);
    }
  }

  return Array.from(map.values());
};

type ColinearCluster = {
  coord: number;
  minSpan: number;
  maxSpan: number;
  role: SnapRole;
  minPerp: number;
};

const mergeColinearSnapLines = (
  snaps: readonly Snap[],
  axis: "x" | "y",
  selectionBounds?: Bounds,
): PointSnapLine[] => {
  const clusters: ColinearCluster[] = [];

  for (const snap of snaps) {
    if (snap.type !== "point") {
      continue;
    }
    const coord = round(axis === "x" ? snap.points[0][0] : snap.points[0][1]);
    let minSpan = Infinity;
    let maxSpan = -Infinity;

    if (selectionBounds) {
      minSpan = Math.min(
        minSpan,
        axis === "x" ? selectionBounds[1] : selectionBounds[0],
      );
      maxSpan = Math.max(
        maxSpan,
        axis === "x" ? selectionBounds[3] : selectionBounds[2],
      );
    } else {
      for (const p of snap.points) {
        const s = axis === "x" ? p[1] : p[0];
        minSpan = Math.min(minSpan, s);
        maxSpan = Math.max(maxSpan, s);
      }
    }

    if (snap.refBounds) {
      minSpan = Math.min(
        minSpan,
        axis === "x" ? snap.refBounds[1] : snap.refBounds[0],
      );
      maxSpan = Math.max(
        maxSpan,
        axis === "x" ? snap.refBounds[3] : snap.refBounds[2],
      );
    }

    const existing = clusters.find(
      (c) => Math.abs(c.coord - coord) <= COLINEAR_TOLERANCE,
    );
    if (existing) {
      existing.minSpan = Math.min(existing.minSpan, minSpan);
      existing.maxSpan = Math.max(existing.maxSpan, maxSpan);
      if (snap.role === "center") {
        existing.role = "center";
      }
      existing.minPerp = Math.min(existing.minPerp, snap.perpDistance);
    } else {
      clusters.push({
        coord,
        minSpan,
        maxSpan,
        role: snap.role,
        minPerp: snap.perpDistance,
      });
    }
  }

  if (clusters.length === 0) {
    return [];
  }

  // Decision 6: Show up to 2 edge guides per axis (e.g. left + right when both
  // align), OR 1 center guide when center matches without both edges matching.
  const edgeClusters = clusters
    .filter((c) => c.role === "edge")
    .sort((a, b) => a.minPerp - b.minPerp);
  const centerClusters = clusters
    .filter((c) => c.role === "center")
    .sort((a, b) => a.minPerp - b.minPerp);

  let chosen: ColinearCluster[];
  if (edgeClusters.length >= 2) {
    chosen = edgeClusters.slice(0, 2);
  } else if (centerClusters.length > 0) {
    chosen = [centerClusters[0]];
  } else {
    chosen = edgeClusters.slice(0, 2);
  }

  return chosen.map((c) => ({
    type: "points",
    role: c.role,
    points: dedupePoints(
      axis === "x"
        ? [
            pointFrom<GlobalPoint>(c.coord, round(c.minSpan)),
            pointFrom<GlobalPoint>(c.coord, round(c.maxSpan)),
          ]
        : [
            pointFrom<GlobalPoint>(round(c.minSpan), c.coord),
            pointFrom<GlobalPoint>(round(c.maxSpan), c.coord),
          ],
    ),
  }));
};

const createPointSnapLines = (
  nearestSnapsX: Snaps,
  nearestSnapsY: Snaps,
  selectionBounds?: Bounds,
): PointSnapLine[] => [
  ...mergeColinearSnapLines(nearestSnapsX, "x", selectionBounds),
  ...mergeColinearSnapLines(nearestSnapsY, "y", selectionBounds),
];

const dedupeGapSnapLines = (gapSnapLines: GapSnapLine[]) => {
  const map = new Map<string, GapSnapLine>();

  for (const gapSnapLine of gapSnapLines) {
    const key = gapSnapLine.points
      .flat()
      .map((point) => round(point))
      .join(",");

    if (!map.has(key)) {
      map.set(key, gapSnapLine);
    }
  }

  return Array.from(map.values());
};

const createGapSnapLines = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  dragOffset: Vector2D,
  gapSnaps: GapSnap[],
  elementsMap: ElementsMap,
): GapSnapLine[] => {
  const [minX, minY, maxX, maxY] = getSnapBounds(
    selectedElements,
    elementsMap,
    dragOffset,
  );

  const gapSnapLines: GapSnapLine[] = [];

  for (const gapSnap of gapSnaps) {
    const [startMinX, startMinY, startMaxX, startMaxY] =
      gapSnap.gap.startBounds;
    const [endMinX, endMinY, endMaxX, endMaxY] = gapSnap.gap.endBounds;

    const verticalIntersection = rangeIntersection(
      rangeInclusive(minY, maxY),
      gapSnap.gap.overlap,
    );

    const horizontalGapIntersection = rangeIntersection(
      rangeInclusive(minX, maxX),
      gapSnap.gap.overlap,
    );

    switch (gapSnap.direction) {
      case "center_horizontal": {
        if (verticalIntersection) {
          const gapLineY =
            (verticalIntersection[0] + verticalIntersection[1]) / 2;
          const d1 = round(minX - gapSnap.gap.startSide[0][0]);
          const d2 = round(gapSnap.gap.endSide[0][0] - maxX);

          gapSnapLines.push(
            {
              type: "gap",
              direction: "horizontal",
              points: [
                pointFrom(gapSnap.gap.startSide[0][0], gapLineY),
                pointFrom(minX, gapLineY),
              ],
              distance: d1,
              bandSpan: verticalIntersection,
            },
            {
              type: "gap",
              direction: "horizontal",
              points: [
                pointFrom(maxX, gapLineY),
                pointFrom(gapSnap.gap.endSide[0][0], gapLineY),
              ],
              distance: d2,
              bandSpan: verticalIntersection,
            },
          );
        }
        break;
      }
      case "center_vertical": {
        if (horizontalGapIntersection) {
          const gapLineX =
            (horizontalGapIntersection[0] + horizontalGapIntersection[1]) / 2;
          const d1 = round(minY - gapSnap.gap.startSide[0][1]);
          const d2 = round(gapSnap.gap.endSide[0][1] - maxY);

          gapSnapLines.push(
            {
              type: "gap",
              direction: "vertical",
              points: [
                pointFrom(gapLineX, gapSnap.gap.startSide[0][1]),
                pointFrom(gapLineX, minY),
              ],
              distance: d1,
              bandSpan: horizontalGapIntersection,
            },
            {
              type: "gap",
              direction: "vertical",
              points: [
                pointFrom(gapLineX, maxY),
                pointFrom(gapLineX, gapSnap.gap.endSide[0][1]),
              ],
              distance: d2,
              bandSpan: horizontalGapIntersection,
            },
          );
        }
        break;
      }
      case "side_right": {
        if (verticalIntersection) {
          const gapLineY =
            (verticalIntersection[0] + verticalIntersection[1]) / 2;
          const d1 = round(endMinX - startMaxX);
          const d2 = round(minX - endMaxX);

          gapSnapLines.push(
            {
              type: "gap",
              direction: "horizontal",
              points: [
                pointFrom(startMaxX, gapLineY),
                pointFrom(endMinX, gapLineY),
              ],
              distance: d1,
              bandSpan: verticalIntersection,
            },
            {
              type: "gap",
              direction: "horizontal",
              points: [pointFrom(endMaxX, gapLineY), pointFrom(minX, gapLineY)],
              distance: d2,
              bandSpan: verticalIntersection,
            },
          );
        }
        break;
      }
      case "side_left": {
        if (verticalIntersection) {
          const gapLineY =
            (verticalIntersection[0] + verticalIntersection[1]) / 2;
          const d1 = round(startMinX - maxX);
          const d2 = round(endMinX - startMaxX);

          gapSnapLines.push(
            {
              type: "gap",
              direction: "horizontal",
              points: [
                pointFrom(maxX, gapLineY),
                pointFrom(startMinX, gapLineY),
              ],
              distance: d1,
              bandSpan: verticalIntersection,
            },
            {
              type: "gap",
              direction: "horizontal",
              points: [
                pointFrom(startMaxX, gapLineY),
                pointFrom(endMinX, gapLineY),
              ],
              distance: d2,
              bandSpan: verticalIntersection,
            },
          );
        }
        break;
      }
      case "side_top": {
        if (horizontalGapIntersection) {
          const gapLineX =
            (horizontalGapIntersection[0] + horizontalGapIntersection[1]) / 2;
          const d1 = round(startMinY - maxY);
          const d2 = round(endMinY - startMaxY);

          gapSnapLines.push(
            {
              type: "gap",
              direction: "vertical",
              points: [
                pointFrom(gapLineX, maxY),
                pointFrom(gapLineX, startMinY),
              ],
              distance: d1,
              bandSpan: horizontalGapIntersection,
            },
            {
              type: "gap",
              direction: "vertical",
              points: [
                pointFrom(gapLineX, startMaxY),
                pointFrom(gapLineX, endMinY),
              ],
              distance: d2,
              bandSpan: horizontalGapIntersection,
            },
          );
        }
        break;
      }
      case "side_bottom": {
        if (horizontalGapIntersection) {
          const gapLineX =
            (horizontalGapIntersection[0] + horizontalGapIntersection[1]) / 2;
          const d1 = round(endMinY - startMaxY);
          const d2 = round(minY - endMaxY);

          gapSnapLines.push(
            {
              type: "gap",
              direction: "vertical",
              points: [
                pointFrom(gapLineX, startMaxY),
                pointFrom(gapLineX, endMinY),
              ],
              distance: d1,
              bandSpan: horizontalGapIntersection,
            },
            {
              type: "gap",
              direction: "vertical",
              points: [pointFrom(gapLineX, endMaxY), pointFrom(gapLineX, minY)],
              distance: d2,
              bandSpan: horizontalGapIntersection,
            },
          );
        }
        break;
      }
    }
  }

  return dedupeGapSnapLines(
    gapSnapLines.map((gapSnapLine) => ({
      ...gapSnapLine,
      points: gapSnapLine.points.map((p) =>
        pointFrom(round(p[0]), round(p[1])),
      ) as PointPair,
    })),
  );
};

const getResizeEdgeSnaps = (
  box: ReferenceSnapBox,
  referenceBoxes: readonly ReferenceSnapBox[],
  activeX: "minX" | "maxX" | null,
  activeY: "minY" | "maxY" | null,
  maxOffsetX: number,
  maxOffsetY: number,
) => {
  const snapsX: PointSnap[] = [];
  const snapsY: PointSnap[] = [];

  for (const ref of referenceBoxes) {
    const refBounds: Bounds = [ref.minX, ref.minY, ref.maxX, ref.maxY];

    if (activeX) {
      const selX = box[activeX];
      const perpY = Math.abs(box.cy - ref.cy);
      const targetsX: Array<[number, SnapRole]> = [
        [ref.minX, "edge"],
        [ref.maxX, "edge"],
        [ref.cx, "center"],
      ];
      for (const [refX, role] of targetsX) {
        const offsetX = round(refX - selX);
        if (Math.abs(offsetX) <= maxOffsetX) {
          snapsX.push({
            type: "point",
            points: [
              pointFrom<GlobalPoint>(selX, box.cy),
              pointFrom<GlobalPoint>(refX, ref.cy),
            ],
            offset: offsetX,
            role,
            perpDistance: perpY,
            refBounds,
          });
        }
      }
    }

    if (activeY) {
      const selY = box[activeY];
      const perpX = Math.abs(box.cx - ref.cx);
      const targetsY: Array<[number, SnapRole]> = [
        [ref.minY, "edge"],
        [ref.maxY, "edge"],
        [ref.cy, "center"],
      ];
      for (const [refY, role] of targetsY) {
        const offsetY = round(refY - selY);
        if (Math.abs(offsetY) <= maxOffsetY) {
          snapsY.push({
            type: "point",
            points: [
              pointFrom<GlobalPoint>(box.cx, selY),
              pointFrom<GlobalPoint>(ref.cx, refY),
            ],
            offset: offsetY,
            role,
            perpDistance: perpX,
            refBounds,
          });
        }
      }
    }
  }

  return { snapsX, snapsY };
};

export const snapResizingElements = (
  // use the latest elements to create snap lines
  selectedElements: readonly NonDeletedExcalidrawElement[],
  // while using the original elements to apply dragOffset to calculate snaps
  selectedOriginalElements: readonly NonDeletedExcalidrawElement[],
  app: AppClassProperties,
  event: KeyboardModifiersObject,
  dragOffset: Vector2D,
  transformHandle: MaybeTransformHandleType,
) => {
  if (
    !isSnappingEnabled({ event, selectedElements, app }) ||
    selectedElements.length === 0 ||
    (selectedElements.length === 1 &&
      !areRoughlyEqual(selectedElements[0].angle, 0))
  ) {
    return {
      snapOffset: { x: 0, y: 0 },
      snapLines: [],
    };
  }

  const referenceBoxes = SnapCache.getReferenceSnapBoxes();
  if (!referenceBoxes || referenceBoxes.length === 0) {
    return {
      snapOffset: { x: 0, y: 0 },
      snapLines: [],
    };
  }

  const elementsMap: ElementsMap =
    app.scene?.getNonDeletedElementsMap() ??
    new Map(
      [...selectedOriginalElements, ...selectedElements].map((el) => [
        el.id,
        el,
      ]),
    );
  let [minX, minY, maxX, maxY] = getSnapBounds(
    selectedOriginalElements,
    elementsMap,
  );
  let activeX: "minX" | "maxX" | null = null;
  let activeY: "minY" | "maxY" | null = null;

  if (transformHandle) {
    if (transformHandle.includes("e")) {
      maxX += dragOffset.x;
      activeX = "maxX";
    } else if (transformHandle.includes("w")) {
      minX += dragOffset.x;
      activeX = "minX";
    }

    if (transformHandle.includes("n")) {
      minY += dragOffset.y;
      activeY = "minY";
    } else if (transformHandle.includes("s")) {
      maxY += dragOffset.y;
      activeY = "maxY";
    }
  }

  const snapDistance = getSnapDistance(app.state.zoom.value);
  const candidateBox = boundsToBox([minX, minY, maxX, maxY]);
  const { snapsX, snapsY } = getResizeEdgeSnaps(
    candidateBox,
    referenceBoxes,
    activeX,
    activeY,
    snapDistance,
    snapDistance,
  );

  const bestX = pickBestPointSnap(snapsX, app.state.zoom.value);
  const bestY = pickBestPointSnap(snapsY, app.state.zoom.value);

  const snapOffset = {
    x: bestX?.offset ?? 0,
    y: bestY?.offset ?? 0,
  };

  const latestBounds = getSnapBounds(selectedElements, elementsMap).map(
    (bound) => round(bound),
  ) as unknown as Bounds;
  const latestBox = boundsToBox(latestBounds);
  const exact = getResizeEdgeSnaps(
    latestBox,
    referenceBoxes,
    activeX,
    activeY,
    COLINEAR_TOLERANCE,
    COLINEAR_TOLERANCE,
  );

  const pointSnapLines = createPointSnapLines(
    exact.snapsX,
    exact.snapsY,
    latestBounds,
  );

  return {
    snapOffset,
    snapLines: pointSnapLines,
  };
};

export const snapNewElement = (
  newElement: NonDeletedExcalidrawElement,
  app: AppClassProperties,
  event: KeyboardModifiersObject,
  origin: Vector2D,
  dragOffset: Vector2D,
  elementsMap: ElementsMap,
) => {
  if (!isSnappingEnabled({ event, selectedElements: [newElement], app })) {
    return {
      snapOffset: { x: 0, y: 0 },
      snapLines: [],
    };
  }

  const selectionSnapPoints: GlobalPoint[] = [
    pointFrom(origin.x + dragOffset.x, origin.y + dragOffset.y),
  ];

  const snapDistance = getSnapDistance(app.state.zoom.value);

  const minOffset = {
    x: snapDistance,
    y: snapDistance,
  };

  const nearestSnapsX: Snaps = [];
  const nearestSnapsY: Snaps = [];

  getPointSnaps(
    [newElement],
    selectionSnapPoints,
    app,
    event,
    nearestSnapsX,
    nearestSnapsY,
    minOffset,
  );

  const snapOffset = {
    x: nearestSnapsX[0]?.offset ?? 0,
    y: nearestSnapsY[0]?.offset ?? 0,
  };

  minOffset.x = 0;
  minOffset.y = 0;
  nearestSnapsX.length = 0;
  nearestSnapsY.length = 0;

  const corners = getElementsCorners([newElement], elementsMap, {
    boundingBoxCorners: true,
    omitCenter: true,
  });

  getPointSnaps(
    [newElement],
    corners,
    app,
    event,
    nearestSnapsX,
    nearestSnapsY,
    minOffset,
  );

  const pointSnapLines = createPointSnapLines(nearestSnapsX, nearestSnapsY);

  return {
    snapOffset,
    snapLines: pointSnapLines,
  };
};

export const getSnapLinesAtPointer = (
  elements: readonly NonDeletedExcalidrawElement[],
  app: AppClassProperties,
  pointer: Vector2D,
  event: KeyboardModifiersObject,
  elementsMap: ElementsMap,
) => {
  if (!isSnappingEnabled({ event, selectedElements: [], app })) {
    return {
      originOffset: { x: 0, y: 0 },
      snapLines: [],
    };
  }

  // Reuse filtered reference entries (skips arrows/lines/freedraws and nested inner shapes).
  const entries = getFilteredReferenceEntries(
    elements,
    [],
    app.state,
    elementsMap,
  );

  const snapDistance = getSnapDistance(app.state.zoom.value);

  const minOffset = {
    x: snapDistance,
    y: snapDistance,
  };

  const horizontalSnapLines: PointerSnapLine[] = [];
  const verticalSnapLines: PointerSnapLine[] = [];

  for (const entry of entries) {
    const corners = getElementsCorners(entry.group, elementsMap);

    for (const corner of corners) {
      const offsetX = corner[0] - pointer.x;

      if (Math.abs(offsetX) <= Math.abs(minOffset.x)) {
        if (Math.abs(offsetX) < Math.abs(minOffset.x)) {
          verticalSnapLines.length = 0;
        }

        verticalSnapLines.push({
          type: "pointer",
          points: [corner, pointFrom(corner[0], pointer.y)],
          direction: "vertical",
        });

        minOffset.x = offsetX;
      }

      const offsetY = corner[1] - pointer.y;

      if (Math.abs(offsetY) <= Math.abs(minOffset.y)) {
        if (Math.abs(offsetY) < Math.abs(minOffset.y)) {
          horizontalSnapLines.length = 0;
        }

        horizontalSnapLines.push({
          type: "pointer",
          points: [corner, pointFrom(pointer.x, corner[1])],
          direction: "horizontal",
        });

        minOffset.y = offsetY;
      }
    }
  }

  return {
    originOffset: {
      x:
        verticalSnapLines.length > 0
          ? verticalSnapLines[0].points[0][0] - pointer.x
          : 0,
      y:
        horizontalSnapLines.length > 0
          ? horizontalSnapLines[0].points[0][1] - pointer.y
          : 0,
    },
    snapLines: [
      ...(verticalSnapLines.length > 0 ? [verticalSnapLines[0]] : []),
      ...(horizontalSnapLines.length > 0 ? [horizontalSnapLines[0]] : []),
    ],
  };
};

export const isActiveToolNonLinearSnappable = (
  activeToolType: AppState["activeTool"]["type"],
) => {
  return (
    activeToolType === TOOL_TYPE.rectangle ||
    activeToolType === TOOL_TYPE.ellipse ||
    activeToolType === TOOL_TYPE.diamond ||
    activeToolType === TOOL_TYPE.frame ||
    activeToolType === TOOL_TYPE.magicframe ||
    activeToolType === TOOL_TYPE.image ||
    activeToolType === TOOL_TYPE.text
  );
};

const MEASURE_MIN_DISTANCE = 0.5;

const buildInnerPaddingMeasureLines = (
  inner: Bounds,
  outer: Bounds,
): GapSnapLine[] => {
  const [iMinX, iMinY, iMaxX, iMaxY] = inner;
  const [oMinX, oMinY, oMaxX, oMaxY] = outer;
  const iMidX = round((iMinX + iMaxX) / 2);
  const iMidY = round((iMinY + iMaxY) / 2);
  const lines: GapSnapLine[] = [];

  const leftDist = round(iMinX - oMinX);
  if (leftDist > MEASURE_MIN_DISTANCE) {
    lines.push({
      type: "gap",
      direction: "horizontal",
      points: [pointFrom(oMinX, iMidY), pointFrom(iMinX, iMidY)],
      distance: leftDist,
      bandSpan: rangeInclusive(iMinY, iMaxY),
      alwaysShowPill: true,
    });
  }

  const rightDist = round(oMaxX - iMaxX);
  if (rightDist > MEASURE_MIN_DISTANCE) {
    lines.push({
      type: "gap",
      direction: "horizontal",
      points: [pointFrom(iMaxX, iMidY), pointFrom(oMaxX, iMidY)],
      distance: rightDist,
      bandSpan: rangeInclusive(iMinY, iMaxY),
      alwaysShowPill: true,
    });
  }

  const topDist = round(iMinY - oMinY);
  if (topDist > MEASURE_MIN_DISTANCE) {
    lines.push({
      type: "gap",
      direction: "vertical",
      points: [pointFrom(iMidX, oMinY), pointFrom(iMidX, iMinY)],
      distance: topDist,
      bandSpan: rangeInclusive(iMinX, iMaxX),
      alwaysShowPill: true,
    });
  }

  const bottomDist = round(oMaxY - iMaxY);
  if (bottomDist > MEASURE_MIN_DISTANCE) {
    lines.push({
      type: "gap",
      direction: "vertical",
      points: [pointFrom(iMidX, iMaxY), pointFrom(iMidX, oMaxY)],
      distance: bottomDist,
      bandSpan: rangeInclusive(iMinX, iMaxX),
      alwaysShowPill: true,
    });
  }

  return lines;
};

const buildDisjointMeasureLines = (a: Bounds, b: Bounds): GapSnapLine[] => {
  const [aMinX, aMinY, aMaxX, aMaxY] = a;
  const [bMinX, bMinY, bMaxX, bMaxY] = b;
  const lines: GapSnapLine[] = [];

  if (bMinX - aMaxX > MEASURE_MIN_DISTANCE || aMinX - bMaxX > MEASURE_MIN_DISTANCE) {
    const fromX = bMinX > aMaxX ? aMaxX : bMaxX;
    const toX = bMinX > aMaxX ? bMinX : aMinX;
    const dist = round(toX - fromX);
    const rangeAY = rangeInclusive(aMinY, aMaxY);
    const rangeBY = rangeInclusive(bMinY, bMaxY);
    const bandSpan = rangesOverlap(rangeAY, rangeBY)
      ? rangeIntersection(rangeAY, rangeBY)!
      : rangeAY;
    const midY = round((bandSpan[0] + bandSpan[1]) / 2);
    lines.push({
      type: "gap",
      direction: "horizontal",
      points: [pointFrom(fromX, midY), pointFrom(toX, midY)],
      distance: dist,
      bandSpan,
      alwaysShowPill: true,
    });
  }

  if (bMinY - aMaxY > MEASURE_MIN_DISTANCE || aMinY - bMaxY > MEASURE_MIN_DISTANCE) {
    const fromY = bMinY > aMaxY ? aMaxY : bMaxY;
    const toY = bMinY > aMaxY ? bMinY : aMinY;
    const dist = round(toY - fromY);
    const rangeAX = rangeInclusive(aMinX, aMaxX);
    const rangeBX = rangeInclusive(bMinX, bMaxX);
    const bandSpan = rangesOverlap(rangeAX, rangeBX)
      ? rangeIntersection(rangeAX, rangeBX)!
      : rangeAX;
    const midX = round((bandSpan[0] + bandSpan[1]) / 2);
    lines.push({
      type: "gap",
      direction: "vertical",
      points: [pointFrom(midX, fromY), pointFrom(midX, toY)],
      distance: dist,
      bandSpan,
      alwaysShowPill: true,
    });
  }

  return lines;
};

export const getAltHoverMeasureLines = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  hoveredElement: NonDeletedExcalidrawElement | null,
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
): GapSnapLine[] => {
  if (selectedElements.length === 0) {
    return [];
  }

  const selBounds = getSnapBounds(selectedElements, elementsMap).map(
    round,
  ) as unknown as Bounds;

  if (hoveredElement) {
    const selectedIds = new Set(selectedElements.map((el) => el.id));
    const resolvedHover =
      (isBoundToContainer(hoveredElement) &&
        (elementsMap.get(hoveredElement.containerId) as
          | NonDeletedExcalidrawElement
          | undefined)) ||
      hoveredElement;

    if (selectedIds.has(resolvedHover.id)) {
      return [];
    }

    let targetGroup: readonly NonDeletedExcalidrawElement[] = [resolvedHover];
    if (resolvedHover.groupIds.length > 0) {
      const maxGroups = getMaximumGroups([...elements], elementsMap);
      const foundGroup = maxGroups.find((g) =>
        g.some((el) => el.id === resolvedHover.id),
      );
      if (foundGroup) {
        if (foundGroup.some((el) => selectedIds.has(el.id))) {
          return [];
        }
        targetGroup = foundGroup;
      }
    }

    const targetBounds = getSnapBounds(targetGroup, elementsMap).map(
      round,
    ) as unknown as Bounds;

    if (isStrictlyContainedIn(selBounds, targetBounds)) {
      return buildInnerPaddingMeasureLines(selBounds, targetBounds);
    }
    if (isStrictlyContainedIn(targetBounds, selBounds)) {
      return buildInnerPaddingMeasureLines(targetBounds, selBounds);
    }
    return buildDisjointMeasureLines(selBounds, targetBounds);
  }

  const frameId = selectedElements[0].frameId;
  if (frameId && selectedElements.every((el) => el.frameId === frameId)) {
    const frame = elementsMap.get(frameId);
    if (frame && !frame.isDeleted && isFrameLike(frame)) {
      const frameBounds = getSnapBounds(
        [frame as NonDeletedExcalidrawElement],
        elementsMap,
      ).map(round) as unknown as Bounds;
      return buildInnerPaddingMeasureLines(selBounds, frameBounds);
    }
  }

  return [];
};
