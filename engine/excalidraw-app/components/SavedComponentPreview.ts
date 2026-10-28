import { exportToCanvas } from "@excalidraw/excalidraw";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

const PREVIEW_MAX_WIDTH = 800;
const PREVIEW_MAX_HEIGHT = 600;
const PREVIEW_MIME_TYPE = "image/webp";

type ExportCanvasOptions = Parameters<typeof exportToCanvas>[0];
type ExportCanvas = (
  options: ExportCanvasOptions,
) => Promise<HTMLCanvasElement>;

export type SavedComponentPreviewScene = {
  elements: readonly OrderedExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
};

export const getSavedComponentPreviewDimensions = (
  width: number,
  height: number,
) => {
  const scale = Math.min(
    1,
    PREVIEW_MAX_WIDTH / Math.max(1, width),
    PREVIEW_MAX_HEIGHT / Math.max(1, height),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
};

const encodeWebP = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, PREVIEW_MIME_TYPE, 0.78);
  });
  if (!blob || blob.type !== PREVIEW_MIME_TYPE || blob.size === 0) {
    throw new Error("WebP component preview encoding is not supported");
  }
  return blob;
};

export const createSavedComponentPreview = async (
  scene: SavedComponentPreviewScene,
  exportCanvas: ExportCanvas = exportToCanvas,
) => {
  const elements = scene.elements.filter(
    (element) => !element.isDeleted,
  ) as ExportCanvasOptions["elements"];
  if (elements.length === 0) {
    throw new Error("A component preview requires visible elements");
  }
  const canvas = await exportCanvas({
    elements,
    appState: {
      ...scene.appState,
      exportBackground: true,
      exportWithDarkMode: scene.appState.theme === "dark",
    },
    files: scene.files,
    exportPadding: 12,
    getDimensions: getSavedComponentPreviewDimensions,
  });
  return {
    blob: await encodeWebP(canvas),
    mimeType: PREVIEW_MIME_TYPE as "image/webp",
    width: canvas.width,
    height: canvas.height,
  };
};
