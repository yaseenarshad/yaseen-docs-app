import { MIME_TYPES } from "@excalidraw/common";
import {
  isGifPaused,
  isInitializedImageElement,
  loadHTMLImageElement,
} from "@excalidraw/element";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

import type { BinaryFiles, DataURL } from "../types";

/**
 * YAZ-3944 D4: a paused GIF is still in an SVG too (note embeds, SVG export): its first frame as a
 * PNG, for each paused GIF file. A GIF the browser cannot load stays as it is.
 */
export const getPausedGifStills = async (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles | null,
) => {
  const stills = new Map<FileId, DataURL>();
  for (const element of elements) {
    if (
      !isInitializedImageElement(element) ||
      !isGifPaused(element) ||
      stills.has(element.fileId)
    ) {
      continue;
    }
    const file = files?.[element.fileId];
    if (file?.mimeType !== MIME_TYPES.gif) {
      continue;
    }
    try {
      // an <img> outside the page draws the first frame
      const image = await loadHTMLImageElement(file.dataURL);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      stills.set(element.fileId, canvas.toDataURL(MIME_TYPES.png) as DataURL);
    } catch {
      // the GIF as it is
    }
  }
  return stills;
};
