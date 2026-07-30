import { newElement } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  captureSavedComponentSelection,
  insertSavedComponent,
  parseImportedComponentJson,
  serializeSavedComponent,
} from "./SavedComponentsData";

const rectangle = (overrides: Record<string, unknown> = {}) => ({
  ...newElement({
    type: "rectangle",
    x: 10,
    y: 20,
    width: 100,
    height: 60,
  }),
  ...overrides,
});

describe("saved component data", () => {
  it.each([
    ["clipboard", "excalidraw/clipboard"],
    ["scene", "excalidraw"],
    ["API clipboard", "excalidraw-api/clipboard"],
  ])("restores supported %s element envelopes", (_label, type) => {
    const restored = parseImportedComponentJson(
      JSON.stringify({ type, elements: [rectangle()] }),
    );

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ type: "rectangle", width: 100 });
  });

  it("restores canonical and single-item Library envelopes", () => {
    const element = rectangle();
    const canonical = parseImportedComponentJson(
      JSON.stringify({
        type: "growprofit/saved-component",
        schemaVersion: 1,
        elements: [element],
      }),
    );
    const library = parseImportedComponentJson(
      JSON.stringify({
        type: "excalidrawlib",
        version: 2,
        libraryItems: [
          {
            id: "library-item",
            status: "unpublished",
            created: Date.now(),
            elements: [element],
          },
        ],
      }),
    );

    expect(canonical).toHaveLength(1);
    expect(library).toHaveLength(1);
  });

  it("returns specific errors for malformed, empty, unsupported, and ambiguous input", () => {
    expect(() => parseImportedComponentJson("{")).toThrow("Paste valid JSON");
    expect(() =>
      parseImportedComponentJson(
        JSON.stringify({ type: "excalidraw/clipboard", elements: [] }),
      ),
    ).toThrow("at least one element");
    expect(() =>
      parseImportedComponentJson(
        JSON.stringify({ type: "other", elements: [rectangle()] }),
      ),
    ).toThrow("Unsupported component JSON envelope");
    expect(() =>
      parseImportedComponentJson(
        JSON.stringify({
          type: "growprofit/saved-component",
          schemaVersion: 2,
          elements: [rectangle()],
        }),
      ),
    ).toThrow("Unsupported component schema version");
    expect(() =>
      parseImportedComponentJson(
        JSON.stringify({
          type: "excalidrawlib",
          version: 2,
          libraryItems: [
            { elements: [rectangle()] },
            { elements: [rectangle()] },
          ],
        }),
      ),
    ).toThrow("one Library item at a time");
    expect(() =>
      parseImportedComponentJson(
        JSON.stringify({
          type: "excalidraw/clipboard",
          elements: [rectangle({ type: "image" })],
        }),
      ),
    ).toThrow("image elements");
  });

  it("rejects missing required frame and bound-text relationships", () => {
    expect(() =>
      parseImportedComponentJson(
        JSON.stringify({
          type: "excalidraw/clipboard",
          elements: [rectangle({ frameId: "missing-frame" })],
        }),
      ),
    ).toThrow("missing frame");

    expect(() =>
      parseImportedComponentJson(
        JSON.stringify({
          type: "excalidraw/clipboard",
          elements: [
            rectangle({
              boundElements: [{ id: "missing-text", type: "text" }],
            }),
          ],
        }),
      ),
    ).toThrow("missing bound text");
  });

  it("serializes an exact canonical v1 payload and enforces the byte limit", () => {
    const element = rectangle({
      groupIds: ["group-1"],
      customData: { preserved: true },
    });
    const serialized = serializeSavedComponent([element]);
    const payload = JSON.parse(serialized.elementsJson);

    expect(serialized).toMatchObject({
      elementCount: 1,
      schemaVersion: 1,
    });
    expect(payload).toMatchObject({
      type: "growprofit/saved-component",
      schemaVersion: 1,
    });
    expect(payload.elements[0]).toMatchObject({
      id: element.id,
      groupIds: ["group-1"],
      customData: { preserved: true },
    });

    expect(() =>
      serializeSavedComponent([
        rectangle({ customData: { padding: "x".repeat(750_000) } }),
      ]),
    ).toThrow("750,000 bytes or smaller");
  });

  it("captures native Library-style selection closure without changing the scene", () => {
    const child = rectangle({ id: "child", frameId: "frame" });
    const frame = rectangle({ id: "frame", type: "frame" });
    const elements = [child, frame];
    const appState = {
      selectedElementIds: { frame: true },
    };
    const excalidrawAPI = {
      getSceneElements: () => elements,
      getAppState: () => appState,
    } as unknown as ExcalidrawImperativeAPI;

    const captured = captureSavedComponentSelection(excalidrawAPI);

    expect(captured.map((element) => element.id)).toEqual(["child", "frame"]);
    expect(excalidrawAPI.getSceneElements()).toEqual(elements);
    expect(excalidrawAPI.getAppState().selectedElementIds).toEqual({
      frame: true,
    });
  });

  it("validates before delegating atomic insertion to Excalidraw", () => {
    const insertElements = vi.fn();
    const excalidrawAPI = {
      insertElements,
    } as unknown as ExcalidrawImperativeAPI;
    const source = JSON.stringify({
      type: "growprofit/saved-component",
      schemaVersion: 1,
      elements: [rectangle()],
    });

    const inserted = insertSavedComponent(excalidrawAPI, source);
    expect(insertElements).toHaveBeenCalledWith(inserted);

    expect(() => insertSavedComponent(excalidrawAPI, "{")).toThrow(
      "Paste valid JSON",
    );
    expect(insertElements).toHaveBeenCalledTimes(1);
  });
});
