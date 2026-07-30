import {
  MAX_SAVED_COMPONENT_BYTES,
  SAVED_COMPONENT_SCHEMA_VERSION,
  UNSUPPORTED_SAVED_COMPONENT_ELEMENT_TYPES,
} from "@excalidraw/common/savedComponents";
import { deepCopyElement } from "@excalidraw/element";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSelectedElements } from "@excalidraw/excalidraw/scene";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type JsonRecord = Record<string, unknown>;

export type SerializedSavedComponent = {
  elementsJson: string;
  elementCount: number;
  schemaVersion: typeof SAVED_COMPONENT_SCHEMA_VERSION;
};

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

const assertSupportedElements = (
  elements: readonly ExcalidrawElement[],
): void => {
  if (elements.length === 0) {
    throw new Error("A component must contain at least one element");
  }

  const ids = new Set<string>();
  for (const element of elements) {
    if (
      !isRecord(element) ||
      typeof element.id !== "string" ||
      typeof element.type !== "string"
    ) {
      throw new Error("Every component element must have a valid id and type");
    }
    if (ids.has(element.id)) {
      throw new Error(`Duplicate element id: ${element.id}`);
    }
    ids.add(element.id);
    if (
      (UNSUPPORTED_SAVED_COMPONENT_ELEMENT_TYPES as readonly string[]).includes(
        element.type,
      )
    ) {
      throw new Error(
        `Saved components do not support ${element.type} elements yet`,
      );
    }
  }

  for (const element of elements) {
    if (element.frameId && !ids.has(element.frameId)) {
      throw new Error(
        `Element ${element.id} references a missing frame (${element.frameId})`,
      );
    }
    if (
      element.type === "text" &&
      element.containerId &&
      !ids.has(element.containerId)
    ) {
      throw new Error(
        `Text element ${element.id} references a missing container (${element.containerId})`,
      );
    }
    for (const boundElement of element.boundElements ?? []) {
      if (boundElement.type === "text" && !ids.has(boundElement.id)) {
        throw new Error(
          `Element ${element.id} references missing bound text (${boundElement.id})`,
        );
      }
    }
  }
};

const assertPayloadSize = (elementsJson: string) => {
  const bytes = new TextEncoder().encode(elementsJson).byteLength;
  if (bytes > MAX_SAVED_COMPONENT_BYTES) {
    throw new Error(
      `Component payloads must be ${MAX_SAVED_COMPONENT_BYTES.toLocaleString(
        "en-US",
      )} bytes or smaller`,
    );
  }
};

export const serializeSavedComponent = (
  elements: readonly ExcalidrawElement[],
): SerializedSavedComponent => {
  assertSupportedElements(elements);
  const elementsJson = JSON.stringify({
    type: "growprofit/saved-component",
    schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
    elements,
  });
  assertPayloadSize(elementsJson);
  return {
    elementsJson,
    elementCount: elements.length,
    schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
  };
};

const getLibraryElements = (payload: JsonRecord): unknown[] => {
  if (payload.version !== 1 && payload.version !== 2) {
    throw new Error("Unsupported Excalidraw Library version");
  }
  const items = payload.libraryItems ?? payload.library;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("The Library JSON does not contain a component");
  }
  if (items.length !== 1) {
    throw new Error("Import one Library item at a time");
  }
  const item = items[0];
  if (Array.isArray(item)) {
    return item;
  }
  if (isRecord(item) && Array.isArray(item.elements)) {
    return item.elements;
  }
  throw new Error("The Library item does not contain valid elements");
};

const getImportedElements = (payload: unknown): unknown[] => {
  if (!isRecord(payload)) {
    throw new Error("Unsupported component JSON envelope");
  }

  if (payload.type === "growprofit/saved-component") {
    if (payload.schemaVersion !== SAVED_COMPONENT_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported component schema version: ${String(
          payload.schemaVersion,
        )}`,
      );
    }
    if (!Array.isArray(payload.elements)) {
      throw new Error("The component JSON must contain an elements array");
    }
    if (
      payload.elementCount !== undefined &&
      payload.elementCount !== payload.elements.length
    ) {
      throw new Error("Component element count does not match its payload");
    }
    return payload.elements;
  }

  if (
    payload.type === "excalidraw" ||
    payload.type === "excalidraw/clipboard" ||
    payload.type === "excalidraw-api/clipboard"
  ) {
    if (!Array.isArray(payload.elements)) {
      throw new Error("The Excalidraw JSON must contain an elements array");
    }
    return payload.elements;
  }

  if (payload.type === "excalidrawlib") {
    return getLibraryElements(payload);
  }

  throw new Error("Unsupported component JSON envelope");
};

export const parseImportedComponentJson = (
  source: string,
): readonly ExcalidrawElement[] => {
  let payload: unknown;
  try {
    payload = JSON.parse(source);
  } catch {
    throw new Error("Paste valid JSON");
  }

  const importedElements = getImportedElements(payload);
  assertSupportedElements(importedElements as ExcalidrawElement[]);
  const restored = restoreElements(
    importedElements as ExcalidrawElement[],
    null,
    { repairBindings: true },
  ).filter((element) => !element.isDeleted);
  assertSupportedElements(restored);
  serializeSavedComponent(restored);
  return restored;
};

export const captureSavedComponentSelection = (
  excalidrawAPI: ExcalidrawImperativeAPI,
): readonly ExcalidrawElement[] => {
  const appState = excalidrawAPI.getAppState();
  const selectedElements = getSelectedElements(
    excalidrawAPI.getSceneElements(),
    { selectedElementIds: appState.selectedElementIds },
    {
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    },
  ).map(deepCopyElement);
  assertSupportedElements(selectedElements);
  serializeSavedComponent(selectedElements);
  return selectedElements;
};

export const insertSavedComponent = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  elementsJson: string,
) => {
  const elements = parseImportedComponentJson(elementsJson);
  excalidrawAPI.insertElements(elements);
  return elements;
};
