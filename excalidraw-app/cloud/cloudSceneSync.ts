import { zoomToFitBounds } from "@excalidraw/excalidraw";
import { getNormalizedZoom } from "@excalidraw/excalidraw/scene";
import { getCommonBounds, getNonDeletedElements } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export type AppliedCloudScene = {
  routeKey: string;
  version: number;
};

type VersionedCloudElement = {
  id: string;
  version?: number;
  versionNonce?: number;
  isDeleted?: boolean;
};

export const hasUnpersistedCloudElements = (
  reconciledElements: readonly VersionedCloudElement[],
  persistedElements: readonly VersionedCloudElement[],
) => {
  const persistedById = new Map(
    persistedElements.map((element) => [element.id, element]),
  );
  for (const element of reconciledElements) {
    const persisted = persistedById.get(element.id);
    if (!persisted) {
      if (element.isDeleted !== true) {
        return true;
      }
      continue;
    }
    const version = element.version ?? 0;
    const persistedVersion = persisted.version ?? 0;
    if (version > persistedVersion) {
      return true;
    }
    if (
      version === persistedVersion &&
      element.versionNonce !== persisted.versionNonce
    ) {
      return true;
    }
  }
  return false;
};

export const shouldApplyCloudScene = (
  previous: AppliedCloudScene | null,
  next: AppliedCloudScene,
) => previous?.routeKey !== next.routeKey || previous.version !== next.version;

export const isSameCloudRoute = (
  previous: AppliedCloudScene | null,
  routeKey: string,
) => previous !== null && previous.routeKey === routeKey;

type CloudViewport = {
  scrollX: number;
  scrollY: number;
  zoom: {
    value: number;
  };
};

export const preserveCloudViewport = <AppState extends CloudViewport>(
  restoredAppState: AppState,
  localAppState: CloudViewport,
  shouldPreserve: boolean,
): AppState =>
  shouldPreserve
    ? {
        ...restoredAppState,
        scrollX: localAppState.scrollX,
        scrollY: localAppState.scrollY,
        zoom: localAppState.zoom,
      }
    : restoredAppState;

export const resolveCloudViewport = <RestoredAppState extends CloudViewport>(
  restoredAppState: RestoredAppState,
  localAppState: AppState,
  elements: readonly ExcalidrawElement[],
  shouldPreserve: boolean,
): RestoredAppState => {
  if (shouldPreserve) {
    return preserveCloudViewport(restoredAppState, localAppState, true);
  }

  const visibleElements = getNonDeletedElements(elements);
  if (visibleElements.length === 0) {
    return {
      ...restoredAppState,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: getNormalizedZoom(1) },
    };
  }

  const openingAppState = {
    ...localAppState,
    ...restoredAppState,
    width: localAppState.width,
    height: localAppState.height,
    offsetLeft: localAppState.offsetLeft,
    offsetTop: localAppState.offsetTop,
  };
  const fittedAppState = zoomToFitBounds({
    bounds: getCommonBounds(visibleElements),
    appState: openingAppState,
    fit: "scale-down",
  }).appState;

  return {
    ...restoredAppState,
    scrollX: fittedAppState.scrollX,
    scrollY: fittedAppState.scrollY,
    zoom: fittedAppState.zoom,
  };
};
