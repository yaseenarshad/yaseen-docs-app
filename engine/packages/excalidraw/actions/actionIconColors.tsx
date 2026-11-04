/**
 * Yaseen Docs (YAZ-4351 1A): the paint actions for icon colors.
 *
 * `changeIconColors` and `changeIconOutline` paint each target icon from its
 * original (`paintIconElement`), add the new small SVG to `files` and swap the
 * element's `fileId` (D1). The file id is the SHA-1 of the bytes
 * (`generateIdFromFile`). The new picture loads before the swap, so the board
 * never shows the placeholder between two colors.
 *
 * A drag (`preview: true`) is `EVENTUALLY`; its release commits with
 * `IMMEDIATELY`, so a drag is one undo step (extra 27). A paint that finishes
 * after a newer one for the same element is dropped.
 */
import {
  CaptureUpdateAction,
  getIconInfo,
  getIconRecipe,
  iconOutlineWidth,
  isInitializedImageElement,
  newElementWith,
  normalizeSVG,
  paintIconElement,
  svgOfDataURL,
} from "@excalidraw/element";
import { MIME_TYPES } from "@excalidraw/common";

import type { CaptureUpdateActionType, IconRecipe } from "@excalidraw/element";
import type {
  ExcalidrawElement,
  FileId,
  InitializedExcalidrawImageElement,
} from "@excalidraw/element/types";

import {
  generateIdFromFile,
  getDataURL_sync,
  SVGStringToFile,
} from "../data/blob";

import { register } from "./register";

import type { AppClassProperties, AppState, BinaryFiles } from "../types";
import type { ActionResult } from "./types";

/** The longest wait for a new picture to load before the swap. */
const PRELOAD_TIMEOUT_MS = 1000;

export type IconTarget = InitializedExcalidrawImageElement;

/** The selected icons that can get colors (`kind` narrows to "one" or "many"). */
export const getIconTargets = (
  elements: readonly ExcalidrawElement[],
  appState: Pick<AppState, "selectedElementIds">,
  app: Pick<AppClassProperties, "files">,
  kind?: "one" | "many",
  elementIds?: readonly string[],
): IconTarget[] =>
  elements.filter((element): element is IconTarget => {
    if (
      element.isDeleted ||
      element.locked ||
      !isInitializedImageElement(element) ||
      !(elementIds
        ? elementIds.includes(element.id)
        : appState.selectedElementIds[element.id])
    ) {
      return false;
    }
    const info = getIconInfo(app.files[element.fileId]);
    return kind ? info.kind === kind : info.kind !== "photo";
  });

const EMPTY_RECIPE: IconRecipe = { colors: {}, outline: null };

/**
 * A copy of the element's recipe, or an empty one. The outline width is the one
 * the board shows now: it scales with a resize after the paint.
 */
export const currentIconRecipe = (
  element: IconTarget,
  files: BinaryFiles,
): IconRecipe => {
  const recipe = getIconRecipe(element);
  if (!recipe) {
    return { ...EMPTY_RECIPE, colors: {} };
  }
  const width = recipe.outline
    ? iconOutlineWidth(element, getIconInfo(files[element.fileId]))
    : 0;
  return {
    colors: { ...recipe.colors },
    ...(recipe.parts ? { parts: { ...recipe.parts } } : null),
    outline: recipe.outline && width > 0 ? { ...recipe.outline, width } : null,
  };
};

/** The latest paint for each element; an older paint that finishes later is dropped. */
const latestPaint = new Map<string, number>();
let paintCounter = 0;

const loadImage = (dataURL: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => resolve(null), PRELOAD_TIMEOUT_MS);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    image.src = dataURL;
  });

/**
 * Paints each target with the recipe `recipeFor` gives it, and returns the
 * action result: the new files and the changed elements.
 */
export const paintIcons = async (
  app: AppClassProperties,
  targets: readonly IconTarget[],
  recipeFor: (element: IconTarget, current: IconRecipe) => IconRecipe | null,
  captureUpdate: CaptureUpdateActionType,
): Promise<ActionResult> => {
  const token = ++paintCounter;
  for (const target of targets) {
    latestPaint.set(target.id, token);
  }
  const files: BinaryFiles = {};
  const changes = new Map<string, Partial<InitializedExcalidrawImageElement>>();

  for (const target of targets) {
    const file = app.files[target.fileId];
    const recipe =
      file && recipeFor(target, currentIconRecipe(target, app.files));
    if (!file || !recipe) {
      continue;
    }
    let svg: string;
    let updates;
    try {
      const painted = paintIconElement(
        target,
        svgOfDataURL(file.dataURL),
        recipe,
      );
      svg = normalizeSVG(painted.svg);
      updates = painted.updates;
    } catch (error) {
      console.error(error);
      continue;
    }
    const fileId = (await generateIdFromFile(
      SVGStringToFile(svg, "icon.svg"),
    )) as FileId;
    if (!app.files[fileId] && !files[fileId]) {
      const dataURL = getDataURL_sync(svg, MIME_TYPES.svg);
      files[fileId] = {
        id: fileId,
        mimeType: MIME_TYPES.svg,
        dataURL,
        created: Date.now(),
        lastRetrieved: Date.now(),
      };
      if (!app.imageCache.has(fileId)) {
        const image = await loadImage(dataURL);
        if (image) {
          app.imageCache.set(fileId, {
            image,
            mimeType: MIME_TYPES.svg,
            iconKind: getIconInfo(files[fileId]).kind,
          });
        }
      }
    }
    changes.set(target.id, { ...updates, fileId });
  }

  if (targets.some((target) => latestPaint.get(target.id) !== token)) {
    return false;
  }
  for (const target of targets) {
    latestPaint.delete(target.id);
  }
  if (!changes.size) {
    return false;
  }
  return {
    // the scene as it is now: the paint was async
    elements: app.scene
      .getElementsIncludingDeleted()
      .map((element) =>
        changes.has(element.id)
          ? newElementWith(
              element as InitializedExcalidrawImageElement,
              changes.get(element.id)!,
            )
          : element,
      ),
    files,
    captureUpdate,
  };
};

/** Sets or clears one key of a color map (a color equal to the key clears it). */
const setKey = (
  map: Record<string, string>,
  key: string,
  color: string | null,
) => {
  if (color === null || color === key) {
    delete map[key];
  } else {
    map[key] = color;
  }
};

export type IconColorsChange = {
  /** a one-color icon's one color (several selected: all of them) */
  color?: string;
  /** an original color → a new color; null gives the original back */
  colors?: Record<string, string | null>;
  /** `colors` replaces the whole map (the tint) */
  replaceColors?: boolean;
  /** a part key (`"3"`, `"3:stroke"`) → a color; null removes it */
  parts?: Record<string, string | null>;
  /** "Reset colors": the original colors (the outline stays) */
  reset?: boolean;
  /** a drag: shown, and one undo step at its release */
  preview?: boolean;
  /** the icons to paint; else the selected ones */
  elementIds?: readonly string[];
};

const captureOf = (preview?: boolean) =>
  preview ? CaptureUpdateAction.EVENTUALLY : CaptureUpdateAction.IMMEDIATELY;

export const actionChangeIconColors = register<IconColorsChange>({
  name: "changeIconColors",
  label: "Icon color",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    if (!value) {
      return false;
    }
    const targets = getIconTargets(
      elements,
      appState,
      app,
      value.color !== undefined ? "one" : undefined,
      value.elementIds,
    );
    if (!targets.length) {
      return false;
    }
    return paintIcons(
      app,
      targets,
      (element, recipe) => {
        if (value.reset) {
          return { colors: {}, outline: recipe.outline };
        }
        if (value.color !== undefined) {
          const [only] = getIconInfo(app.files[element.fileId]).colors;
          recipe.colors = {};
          setKey(recipe.colors, only, value.color);
          delete recipe.parts;
          return recipe;
        }
        if (value.replaceColors) {
          recipe.colors = {};
        }
        for (const [key, color] of Object.entries(value.colors ?? {})) {
          setKey(recipe.colors, key, color);
        }
        if (value.parts) {
          const parts = { ...recipe.parts };
          for (const [key, color] of Object.entries(value.parts)) {
            if (color === null) {
              delete parts[key];
            } else {
              parts[key] = color;
            }
          }
          recipe.parts = parts;
        }
        return recipe;
      },
      captureOf(value.preview),
    );
  },
});

export type IconOutlineChange = {
  /** the outline color; with no outline yet, it starts one at the default width */
  color?: string;
  /** board pixels; 0 removes the outline */
  width?: number;
  preview?: boolean;
  elementIds?: readonly string[];
};

/** A new outline's width: about a twelfth of the icon's smaller side, at least 1 px. */
export const defaultIconOutlineWidth = (element: IconTarget) =>
  Math.max(1, Math.round(Math.min(element.width, element.height) / 12));

export const DEFAULT_ICON_OUTLINE_COLOR = "#ffffff";

export const actionChangeIconOutline = register<IconOutlineChange>({
  name: "changeIconOutline",
  label: "Icon outline",
  trackEvent: false,
  perform: (elements, appState, value, app) => {
    if (!value) {
      return false;
    }
    const targets = getIconTargets(
      elements,
      appState,
      app,
      undefined,
      value.elementIds,
    );
    if (!targets.length) {
      return false;
    }
    return paintIcons(
      app,
      targets,
      (element, recipe) => {
        const width =
          value.width ??
          (recipe.outline?.width || defaultIconOutlineWidth(element));
        recipe.outline =
          width > 0
            ? {
                color:
                  value.color ??
                  recipe.outline?.color ??
                  DEFAULT_ICON_OUTLINE_COLOR,
                width,
              }
            : null;
        return recipe;
      },
      captureOf(value.preview),
    );
  },
});
