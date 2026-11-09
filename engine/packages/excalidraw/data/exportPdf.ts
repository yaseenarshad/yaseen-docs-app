import { exportToSvg } from "@excalidraw/utils/export";

import { DEFAULT_EXPORT_PADDING } from "@excalidraw/common";

import type {
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { AppState, BinaryFiles, UIAppState } from "../types";

/**
 * Yaseen Docs (YAZ-3943 D6, YAZ-4515): the SVG the host prints as the PDF, and its
 * size. The export box's PDF button and the host's automation export share it.
 * Background, Dark mode and Only selected apply; Scale and Embed scene do not
 * (one page the size of the drawing).
 */
export const exportPdfSvg = async (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: Readonly<UIAppState> | AppState,
  files: BinaryFiles,
  exportingFrame: NonDeleted<ExcalidrawFrameLikeElement> | null,
) => {
  const svg = await exportToSvg({
    elements,
    appState: { ...appState, exportScale: 1, exportEmbedScene: false },
    files,
    exportPadding: DEFAULT_EXPORT_PADDING,
    exportingFrame,
  });
  return {
    svg: svg.outerHTML,
    width: Number(svg.getAttribute("width")),
    height: Number(svg.getAttribute("height")),
  };
};
