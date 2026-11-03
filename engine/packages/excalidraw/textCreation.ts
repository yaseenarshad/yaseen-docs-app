import { CORNER_RADIUS } from "@excalidraw/common";

const RESPONSIVE_TEXT_BASE_SIZE = 130;

/**
 * The Docs app's "New text size on screen" (YAZ-4247): the px a new text shows
 * at, whatever the zoom. The app sets it from its canvas prefs.
 */
export const DEFAULT_NEW_TEXT_SCREEN_SIZE = 16;
let newTextScreenSize = DEFAULT_NEW_TEXT_SCREEN_SIZE;

export const setNewTextScreenSize = (px: number) => {
  newTextScreenSize =
    Number.isFinite(px) && px > 0 ? px : DEFAULT_NEW_TEXT_SCREEN_SIZE;
};

/**
 * The Docs app's "Wrap new text before the edge" (YAZ-4247): how many screen px
 * before the right edge of the visible canvas a click-started text starts to
 * wrap. 0 = at the edge (the default here; the app sets its own).
 */
let newTextWrapMargin = 0;

export const setNewTextWrapMargin = (px: number) => {
  newTextWrapMargin = Number.isFinite(px) && px >= 0 ? px : 0;
};

export const getNewTextWrapMargin = () => newTextWrapMargin;

/**
 * A new text's font size (YAZ-4247): the screen size over the zoom at the
 * moment the text is made, so it shows at the same px at every zoom. Old text
 * keeps its size. Two decimals.
 */
export const getResponsiveTextFontSize = (zoom: number) => {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.round((newTextScreenSize / safeZoom) * 100) / 100;
};

/**
 * The width a click-started text (auto-resizing) takes when it grows past the
 * right edge of the visible canvas (YAZ-4247): the room left to that edge, in
 * scene units; from then on it wraps. Null while it fits, or when less than
 * about eight characters (four font sizes) of room are left: it then keeps
 * growing, as before.
 */
export const wrapWidthAtEdge = (
  x: number,
  width: number,
  sceneRight: number,
  fontSize: number,
): number | null => {
  const room = sceneRight - x;
  return x + width > sceneRight && room >= fontSize * 4 ? room : null;
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
