export type ViewportInsertionRequest = {
  targetScreenSize: number;
  viewportFraction: number;
};

export const IMAGE_STUDIO_INSERTION: ViewportInsertionRequest = {
  targetScreenSize: 320,
  viewportFraction: 0.55,
};

type ViewportInsertionInput = {
  naturalWidth: number;
  naturalHeight: number;
  zoom: number;
  viewport: { width: number; height: number };
  offsets: Partial<{
    top: number;
    right: number;
    bottom: number;
    left: number;
  }>;
  request: ViewportInsertionRequest;
};

export const resolveViewportInsertion = ({
  naturalWidth,
  naturalHeight,
  zoom,
  viewport,
  offsets,
  request,
}: ViewportInsertionInput) => {
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    throw new Error("Image dimensions and zoom must be positive.");
  }

  const left = offsets.left ?? 0;
  const right = offsets.right ?? 0;
  const top = offsets.top ?? 0;
  const bottom = offsets.bottom ?? 0;
  const usableWidth = Math.max(1, viewport.width - left - right);
  const usableHeight = Math.max(1, viewport.height - top - bottom);

  const naturalLongestSide = Math.max(naturalWidth, naturalHeight);
  const targetScale = request.targetScreenSize / naturalLongestSide;
  const targetWidth = naturalWidth * targetScale;
  const targetHeight = naturalHeight * targetScale;
  const capScale = Math.min(
    1,
    (usableWidth * request.viewportFraction) / targetWidth,
    (usableHeight * request.viewportFraction) / targetHeight,
  );

  return {
    width: (targetWidth * capScale) / zoom,
    height: (targetHeight * capScale) / zoom,
    centerViewportX: left + usableWidth / 2,
    centerViewportY: top + usableHeight / 2,
  };
};
