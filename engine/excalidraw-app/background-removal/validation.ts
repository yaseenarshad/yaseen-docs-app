import { BACKGROUND_REMOVAL_MAX_PIXELS } from "./types";

import type { BackgroundRemovalMimeType } from "./types";

const supportedMimeTypes = new Set<BackgroundRemovalMimeType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const isBackgroundRemovalMimeType = (
  value: string,
): value is BackgroundRemovalMimeType =>
  supportedMimeTypes.has(value as BackgroundRemovalMimeType);

export const isAnimatedWebP = (bytes: Uint8Array) => {
  if (bytes.length < 16) {
    return false;
  }
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") {
    return false;
  }
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const chunk = ascii(offset, 4);
    if (chunk === "ANIM" || chunk === "ANMF") {
      return true;
    }
    const size =
      bytes[offset + 4] |
      (bytes[offset + 5] << 8) |
      (bytes[offset + 6] << 16) |
      (bytes[offset + 7] << 24);
    if (size < 0) {
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return false;
};

export const validateBackgroundRemovalSource = ({
  mimeType,
  width,
  height,
  bytes,
}: {
  mimeType: string;
  width?: number;
  height?: number;
  bytes?: Uint8Array;
}) => {
  if (!isBackgroundRemovalMimeType(mimeType)) {
    throw new Error("Choose one JPG, PNG, or static WebP image.");
  }
  if (mimeType === "image/webp" && bytes && isAnimatedWebP(bytes)) {
    throw new Error("Animated WebP images are not supported.");
  }
  if (
    width !== undefined &&
    height !== undefined &&
    (width <= 0 ||
      height <= 0 ||
      width * height > BACKGROUND_REMOVAL_MAX_PIXELS)
  ) {
    throw new Error("Images must be 10 megapixels or smaller.");
  }
};
