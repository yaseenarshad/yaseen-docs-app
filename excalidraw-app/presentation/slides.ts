import { newElementWith } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";

export type OrderedPresentationFrame = {
  frame: ExcalidrawFrameElement;
  order: number;
  sceneIndex: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getPresentationOrder = (frame: ExcalidrawFrameElement) => {
  const rootOrder = frame.customData?.presentationOrder;
  if (Number.isInteger(rootOrder) && Number(rootOrder) > 0) {
    return Number(rootOrder);
  }
  const generatedMetadata = frame.customData?.yaseenPresentation;
  if (isRecord(generatedMetadata)) {
    const generatedOrder = generatedMetadata.presentationOrder;
    if (Number.isInteger(generatedOrder) && Number(generatedOrder) > 0) {
      return Number(generatedOrder);
    }
  }
  return null;
};

export const getTopLevelFrames = (
  elements: readonly ExcalidrawElement[],
): { frame: ExcalidrawFrameElement; sceneIndex: number }[] =>
  elements.flatMap((element, sceneIndex) =>
    element.type === "frame" && !element.isDeleted && element.frameId === null
      ? [{ frame: element, sceneIndex }]
      : [],
  );

export const getOrderedPresentationFrames = (
  elements: readonly ExcalidrawElement[],
): OrderedPresentationFrame[] => {
  const frames = getTopLevelFrames(elements);
  const orderCounts = new Map<number, number>();
  const requestedOrders = frames.map(({ frame }) => {
    const order = getPresentationOrder(frame);
    if (order !== null && order <= frames.length) {
      orderCounts.set(order, (orderCounts.get(order) ?? 0) + 1);
      return order;
    }
    return null;
  });
  const slots: (typeof frames[number] | undefined)[] = Array(frames.length);
  const unresolved: typeof frames[number][] = [];

  frames.forEach((entry, index) => {
    const requestedOrder = requestedOrders[index];
    if (requestedOrder !== null && orderCounts.get(requestedOrder) === 1) {
      slots[requestedOrder - 1] = entry;
    } else {
      unresolved.push(entry);
    }
  });

  let unresolvedIndex = 0;
  for (let index = 0; index < slots.length; index += 1) {
    if (!slots[index]) {
      slots[index] = unresolved[unresolvedIndex];
      unresolvedIndex += 1;
    }
  }

  return slots.flatMap((entry, index) =>
    entry ? [{ ...entry, order: index + 1 }] : [],
  );
};

/**
 * Which slide a scene point lands in, or `null` for a miss — the click target
 * test for overview mode (GRO-1933). Frames are axis-aligned and never
 * rotated, so bounds are the whole story; on overlap the earlier slide wins.
 */
export const findSlideIndexAtPoint = (
  { x, y }: { x: number; y: number },
  slides: readonly OrderedPresentationFrame[],
): number | null => {
  // Slides may overlap — a deck-overview frame drawn around the slides is a
  // real authoring pattern — so the innermost (smallest) frame under the
  // point wins, not the first one in presentation order.
  let bestIndex: number | null = null;
  let bestArea = Infinity;
  slides.forEach(({ frame }, index) => {
    const inside =
      x >= frame.x &&
      x <= frame.x + frame.width &&
      y >= frame.y &&
      y <= frame.y + frame.height;
    const area = frame.width * frame.height;
    if (inside && area < bestArea) {
      bestIndex = index;
      bestArea = area;
    }
  });
  return bestIndex;
};

export const reorderPresentationFrames = (
  elements: readonly ExcalidrawElement[],
  orderedFrameIds: readonly string[],
): ExcalidrawElement[] => {
  const current = getOrderedPresentationFrames(elements);
  const topLevelIds = new Set(current.map(({ frame }) => frame.id));
  const uniqueRequestedIds = orderedFrameIds.filter(
    (id, index) => topLevelIds.has(id) && orderedFrameIds.indexOf(id) === index,
  );
  const completeIds = [
    ...uniqueRequestedIds,
    ...current
      .map(({ frame }) => frame.id)
      .filter((id) => !uniqueRequestedIds.includes(id)),
  ];
  const orderById = new Map(
    completeIds.map((frameId, index) => [frameId, index + 1]),
  );

  return elements.map((element) => {
    const order = orderById.get(element.id);
    if (element.type !== "frame" || order === undefined) {
      return element;
    }
    return newElementWith(element, {
      customData: {
        ...element.customData,
        presentationOrder: order,
      },
    });
  });
};

export const renamePresentationFrame = (
  elements: readonly ExcalidrawElement[],
  frameId: string,
  name: string,
): ExcalidrawElement[] =>
  elements.map((element) =>
    element.type === "frame" && element.id === frameId
      ? newElementWith(element, { name })
      : element,
  );
