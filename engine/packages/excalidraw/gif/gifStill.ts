import { MIME_TYPES } from "@excalidraw/common";
import {
  isGifPaused,
  isInitializedImageElement,
  loadHTMLImageElement,
} from "@excalidraw/element";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

import type { BinaryFiles, DataURL } from "../types";

/** YAZ-4130 6B4: the most stills the cache keeps. */
const GIF_STILLS_MAX = 50;

/**
 * YAZ-4071: the most bytes of still data URLs the cache keeps. A GIF shrunk to 800 px (D3) gives
 * a still of about 0.3 to 1.5 MB, but a GIF pasted at full size (D16) can give much more.
 */
export const GIF_STILLS_MAX_BYTES = 20 * 1024 * 1024;

/**
 * YAZ-4130 6B4: the stills made, by file ID, for the whole window. Each SVG render of a board
 * (a note embed, an export) asks again, so only the first one draws the frame. A change of the
 * GIF's bytes gives a new file ID, so a still is never old. A full cache (by count or by bytes)
 * drops the stills used longest ago.
 */
const stillsCache = new Map<FileId, DataURL>();
/** The length of all the cached data URLs (base64, so one byte for each letter). */
let stillsBytes = 0;

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
    const cached = stillsCache.get(element.fileId);
    if (cached) {
      // a still in use goes to the end
      stillsCache.delete(element.fileId);
      stillsCache.set(element.fileId, cached);
      stills.set(element.fileId, cached);
      continue;
    }
    try {
      // an <img> outside the page draws the first frame
      const image = await loadHTMLImageElement(file.dataURL);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      const still = canvas.toDataURL(MIME_TYPES.png) as DataURL;
      // a still bigger than the whole limit is not kept
      if (still.length <= GIF_STILLS_MAX_BYTES) {
        while (
          stillsCache.size >= GIF_STILLS_MAX ||
          stillsBytes + still.length > GIF_STILLS_MAX_BYTES
        ) {
          const [oldest, oldestStill] = stillsCache.entries().next().value!;
          stillsCache.delete(oldest);
          stillsBytes -= oldestStill.length;
        }
        stillsCache.set(element.fileId, still);
        stillsBytes += still.length;
      }
      stills.set(element.fileId, still);
    } catch {
      // the GIF as it is
    }
  }
  return stills;
};
