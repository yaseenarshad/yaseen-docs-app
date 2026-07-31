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
