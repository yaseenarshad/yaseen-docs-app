import { exportToCanvas } from "@excalidraw/excalidraw";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

const PREVIEW_MAX_WIDTH = 1200;
const PREVIEW_MAX_HEIGHT = 800;
const PREVIEW_IDLE_MS = 1_500;
const PREVIEW_THROTTLE_MS = 30_000;
const PREVIEW_MIME_TYPE = "image/webp";

type ExportCanvasOptions = Parameters<typeof exportToCanvas>[0];
type ExportCanvas = (
  options: ExportCanvasOptions,
) => Promise<HTMLCanvasElement>;

export type BoardPreviewScene = {
  elements: OrderedExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
};

export type BoardPreviewImage = {
  blob: Blob;
  mimeType: "image/webp";
  width: number;
  height: number;
};

export const getBoardPreviewDimensions = (width: number, height: number) => {
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

export const getBoardPreviewDelay = (
  now: number,
  lastStartedAt: number | null,
) =>
  Math.max(
    PREVIEW_IDLE_MS,
    lastStartedAt === null ? 0 : PREVIEW_THROTTLE_MS - (now - lastStartedAt),
  );

const encodeWebP = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, PREVIEW_MIME_TYPE, 0.8);
  });
  if (!blob || blob.type !== PREVIEW_MIME_TYPE || blob.size === 0) {
    throw new Error("WebP preview encoding is not supported");
  }
  return blob;
};

export const createBoardPreviewImage = async (
  scene: BoardPreviewScene,
  exportCanvas: ExportCanvas = exportToCanvas,
): Promise<BoardPreviewImage | null> => {
  const elements = scene.elements.filter(
    (element) => !element.isDeleted,
  ) as ExportCanvasOptions["elements"];
  if (elements.length === 0) {
    return null;
  }
  const canvas = await exportCanvas({
    elements,
    appState: {
      ...scene.appState,
      exportBackground: true,
      exportWithDarkMode: scene.appState.theme === "dark",
    },
    files: scene.files,
    exportPadding: 16,
    getDimensions: getBoardPreviewDimensions,
  });
  const blob = await encodeWebP(canvas);
  return {
    blob,
    mimeType: PREVIEW_MIME_TYPE,
    width: canvas.width,
    height: canvas.height,
  };
};
