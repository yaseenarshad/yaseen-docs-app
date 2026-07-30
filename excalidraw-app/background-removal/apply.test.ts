import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
  ImageBackgroundRemovalRequest,
} from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";

import type {
  InitializedExcalidrawImageElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { CaptureUpdateActionType } from "@excalidraw/element";

import { removeImageBackgroundAndReplace } from "./apply";

import type {
  BackgroundRemovalClient,
  BackgroundRemovalResult,
} from "./client";

const generatedFileId = "transparent-file" as FileId;
const generatedDataURL = "data:image/png;base64,result" as DataURL;

vi.mock("@excalidraw/excalidraw/data/blob", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@excalidraw/excalidraw/data/blob")
  >();
  return {
    ...original,
    generateIdFromFile: vi.fn(async () => generatedFileId),
    getDataURL: vi.fn(async () => generatedDataURL),
  };
});

const sourceFile: BinaryFileData = {
  id: "source-file" as FileId,
  mimeType: "image/jpeg",
  dataURL: "data:image/jpeg;base64,source" as DataURL,
  created: 1,
};

const createFixture = () => {
  const image = API.createElement({
    type: "image",
    id: "image",
    fileId: sourceFile.id,
    status: "saved",
    x: 42,
    y: 24,
    width: 640,
    height: 480,
    groupIds: ["group"],
    frameId: "frame",
  }) as NonDeleted<InitializedExcalidrawImageElement>;
  let elements = [image];
  let selectedElementIds: Record<string, true> = { [image.id]: true };
  const addFiles = vi.fn();
  const updateScene = vi.fn(
    (update: {
      elements: readonly typeof image[];
      captureUpdate?: CaptureUpdateActionType;
    }) => {
      elements = [...update.elements];
    },
  );
  const api = {
    getSceneElements: () => elements,
    getAppState: () => ({ selectedElementIds }),
    addFiles,
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  const remove = vi.fn(
    async (): Promise<BackgroundRemovalResult> => ({
      blob: new Blob(["png"], { type: "image/png" }),
      width: 640,
      height: 480,
      backend: "wasm",
    }),
  );
  const client = { remove } as unknown as BackgroundRemovalClient;
  const request: ImageBackgroundRemovalRequest = {
    element: image,
    file: sourceFile,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  };
  return {
    image,
    api,
    client,
    request,
    addFiles,
    updateScene,
    remove,
    setSelection: (value: Record<string, true>) => {
      selectedElementIds = value;
    },
  };
};

describe("atomic image background replacement", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps element geometry and identity while recording one immediate swap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json("source", {
          headers: { "Content-Type": "image/jpeg" },
        }),
      ),
    );
    const fixture = createFixture();

    await expect(
      removeImageBackgroundAndReplace(fixture),
    ).resolves.toMatchObject({
      fileId: generatedFileId,
      backend: "wasm",
    });

    expect(fixture.addFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        id: generatedFileId,
        mimeType: "image/png",
        dataURL: generatedDataURL,
      }),
    ]);
    expect(fixture.updateScene).toHaveBeenCalledTimes(1);
    const update = fixture.updateScene.mock.calls[0][0];
    expect(update.captureUpdate).toBe(CaptureUpdateAction.IMMEDIATELY);
    expect(update.elements[0]).toMatchObject({
      id: fixture.image.id,
      fileId: generatedFileId,
      x: fixture.image.x,
      y: fixture.image.y,
      width: fixture.image.width,
      height: fixture.image.height,
      groupIds: fixture.image.groupIds,
      frameId: fixture.image.frameId,
    });
    expect(fixture.image.fileId).toBe(sourceFile.id);
  });

  it("does not process a source that is no longer the sole selection", async () => {
    const fixture = createFixture();
    fixture.setSelection({});

    await expect(removeImageBackgroundAndReplace(fixture)).rejects.toThrow(
      /selected image changed/,
    );
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(fixture.addFiles).not.toHaveBeenCalled();
    expect(fixture.updateScene).not.toHaveBeenCalled();
  });

  it("drops a completed result when the selection changes during inference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json("source")),
    );
    const fixture = createFixture();
    fixture.remove.mockImplementation(async () => {
      fixture.setSelection({});
      return {
        blob: new Blob(["png"], { type: "image/png" }),
        width: 640,
        height: 480,
        backend: "webgpu",
      };
    });

    await expect(removeImageBackgroundAndReplace(fixture)).rejects.toThrow(
      /selected image changed/,
    );
    expect(fixture.addFiles).not.toHaveBeenCalled();
    expect(fixture.updateScene).not.toHaveBeenCalled();
  });
});
