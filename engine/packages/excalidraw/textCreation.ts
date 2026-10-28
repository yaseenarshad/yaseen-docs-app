import { CORNER_RADIUS } from "@excalidraw/common";

const RESPONSIVE_TEXT_BASE_SIZE = 130;
const RESPONSIVE_TEXT_MIN_SIZE = 32;
const RESPONSIVE_TEXT_MAX_SIZE = 440;

export const getResponsiveTextFontSize = (zoom: number) => {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const exponent = safeZoom <= 1 ? -0.6 : -1.35;
  const fontSize = Math.round(
    RESPONSIVE_TEXT_BASE_SIZE * Math.pow(safeZoom, exponent),
  );

  return Math.min(
    RESPONSIVE_TEXT_MAX_SIZE,
    Math.max(RESPONSIVE_TEXT_MIN_SIZE, fontSize),
  );
};

export const getTextBackgroundRadiusForFontSize = (fontSize: number) => {
  const safeFontSize =
    Number.isFinite(fontSize) && fontSize > 0
      ? fontSize
      : RESPONSIVE_TEXT_BASE_SIZE;
  const radius = Math.round(
    (CORNER_RADIUS.default * safeFontSize) / RESPONSIVE_TEXT_BASE_SIZE,
  );

  return Math.min(CORNER_RADIUS.max, Math.max(CORNER_RADIUS.min, radius));
};

export const getResponsiveTextBackgroundRadius = (zoom: number) =>
  getTextBackgroundRadiusForFontSize(getResponsiveTextFontSize(zoom));

export const scaleTextBackgroundRadiusForFontSize = (
  radius: number,
  previousFontSize: number,
  nextFontSize: number,
) => {
  const safePreviousFontSize =
    Number.isFinite(previousFontSize) && previousFontSize > 0
      ? previousFontSize
      : RESPONSIVE_TEXT_BASE_SIZE;
  const safeNextFontSize =
    Number.isFinite(nextFontSize) && nextFontSize > 0
      ? nextFontSize
      : safePreviousFontSize;
  const safeRadius =
    Number.isFinite(radius) && radius >= 0
      ? radius
      : getTextBackgroundRadiusForFontSize(safePreviousFontSize);

  return Math.min(
    CORNER_RADIUS.max,
    Math.max(
      CORNER_RADIUS.min,
      Math.round((safeRadius * safeNextFontSize) / safePreviousFontSize),
    ),
  );
};
