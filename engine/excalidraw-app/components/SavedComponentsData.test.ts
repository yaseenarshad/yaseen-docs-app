import { newElement, newImageElement } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  captureSavedComponentSelection,
  captureSavedComponentSelectionWithFiles,
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

const image = (fileId = "file-a", overrides: Record<string, unknown> = {}) => ({
  ...newImageElement({
    type: "image",
    x: 20,
    y: 30,
    width: 160,
    height: 90,
    status: "saved",
    fileId: fileId as never,
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

  it("serializes native image properties while JSON import remains unsupported", () => {
    const sourceImage = image("file-a", {
      groupIds: ["group-a"],
      scale: [-1, 1],
      crop: {
        x: 5,
        y: 10,
        width: 80,
        height: 40,
        naturalWidth: 160,
        naturalHeight: 90,
      },
    });
    const serialized = serializeSavedComponent([sourceImage]);
    expect(JSON.parse(serialized.elementsJson).elements[0]).toMatchObject({
      type: "image",
      fileId: "file-a",
      status: "saved",
      groupIds: ["group-a"],
      scale: [-1, 1],
      crop: {
        x: 5,
        y: 10,
        width: 80,
        height: 40,
        naturalWidth: 160,
        naturalHeight: 90,
      },
    });
    expect(() => parseImportedComponentJson(serialized.elementsJson)).toThrow(
      "image elements",
    );
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

  it("captures only the binary files referenced by the selected relationship closure", () => {
    const selectedImage = image("file-a");
    const unselectedImage = image("file-b");
    const files = {
      "file-a": {
        id: "file-a",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,YQ==",
        created: 1,
      },
      "file-b": {
        id: "file-b",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,Yg==",
        created: 2,
      },
    };
    const excalidrawAPI = {
      getSceneElements: () => [selectedImage, unselectedImage],
      getAppState: () => ({ selectedElementIds: { [selectedImage.id]: true } }),
      getFiles: () => files,
    } as unknown as ExcalidrawImperativeAPI;

    const captured = captureSavedComponentSelectionWithFiles(excalidrawAPI);

    expect(captured.elements.map((element) => element.id)).toEqual([
      selectedImage.id,
    ]);
    expect(Object.keys(captured.files)).toEqual(["file-a"]);
    expect(captured.files["file-a"]).toBe(files["file-a"]);
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

  it("adds every image file before inserting an image component", () => {
    const order: string[] = [];
    const addFiles = vi.fn(() => order.push("files"));
    const insertElements = vi.fn(() => order.push("elements"));
    const excalidrawAPI = {
      addFiles,
      insertElements,
    } as unknown as ExcalidrawImperativeAPI;
    const source = serializeSavedComponent([image()]).elementsJson;
    const files = [
      {
        id: "file-a",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,YQ==",
        created: 1,
      },
    ] as never;

    insertSavedComponent(excalidrawAPI, source, files);

    expect(order).toEqual(["files", "elements"]);
    expect(addFiles).toHaveBeenCalledWith(files);
    expect(insertElements).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: "image" })]),
    );
  });

  it("restores mixed frame and image relationships before insertion", () => {
    const addFiles = vi.fn();
    const insertElements = vi.fn();
    const excalidrawAPI = {
      addFiles,
      insertElements,
    } as unknown as ExcalidrawImperativeAPI;
    const frame = rectangle({ id: "frame-a", type: "frame", name: "Frame" });
    const sourceImage = image("file-a", {
      id: "image-a",
      frameId: "frame-a",
      groupIds: ["group-a"],
    });
    const source = serializeSavedComponent([frame, sourceImage]).elementsJson;

    insertSavedComponent(excalidrawAPI, source, [
      {
        id: "file-a",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,YQ==",
        created: 1,
      },
    ] as never);

    const inserted = insertElements.mock.calls[0][0];
    expect(inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "frame-a", type: "frame" }),
        expect.objectContaining({
          id: "image-a",
          type: "image",
          frameId: "frame-a",
          groupIds: ["group-a"],
        }),
      ]),
    );
  });
});
