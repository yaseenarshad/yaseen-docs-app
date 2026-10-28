import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  generateIdFromFile,
  getDataURL,
} from "@excalidraw/excalidraw/data/blob";
import { isInitializedImageElement, newElementWith } from "@excalidraw/element";

import type {
  ExcalidrawImperativeAPI,
  ImageBackgroundRemovalRequest,
} from "@excalidraw/excalidraw/types";

import type { BackgroundRemovalClient } from "./client";

const staleMessage =
  "The selected image changed while processing. Your canvas was not changed.";

const assertCurrentSource = (
  api: ExcalidrawImperativeAPI,
  request: ImageBackgroundRemovalRequest,
) => {
  const current = api
    .getSceneElements()
    .find((element) => element.id === request.element.id);
  const selectedIds = Object.keys(api.getAppState().selectedElementIds);
  if (
    !current ||
    !isInitializedImageElement(current) ||
    current.fileId !== request.file.id ||
    current.version !== request.element.version ||
    selectedIds.length !== 1 ||
    selectedIds[0] !== current.id
  ) {
    throw new Error(staleMessage);
  }
  return current;
};

export const removeImageBackgroundAndReplace = async ({
  api,
  request,
  client,
}: {
  api: ExcalidrawImperativeAPI;
  request: ImageBackgroundRemovalRequest;
  client: BackgroundRemovalClient;
}) => {
  assertCurrentSource(api, request);
  const sourceResponse = await fetch(request.file.dataURL);
  if (!sourceResponse.ok) {
    throw new Error("The selected image file could not be read.");
  }
  const source = await sourceResponse.blob();
  const result = await client.remove({
    source,
    mimeType: request.file.mimeType,
    signal: request.signal,
    onProgress: request.onProgress,
  });
  if (request.signal.aborted) {
    throw new DOMException("Background removal cancelled.", "AbortError");
  }

  const current = assertCurrentSource(api, request);
  const pngFile = new File([result.blob], "background-removed.png", {
    type: "image/png",
  });
  const fileId = await generateIdFromFile(pngFile);
  const dataURL = await getDataURL(pngFile);
  if (request.signal.aborted) {
    throw new DOMException("Background removal cancelled.", "AbortError");
  }
  assertCurrentSource(api, request);

  api.addFiles([
    {
      id: fileId,
      mimeType: "image/png",
      dataURL,
      created: Date.now(),
    },
  ]);
  api.updateScene({
    elements: api
      .getSceneElements()
      .map((element) =>
        element.id === current.id
          ? newElementWith(current, { fileId, status: "saved" })
          : element,
      ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return { fileId, backend: result.backend };
};
