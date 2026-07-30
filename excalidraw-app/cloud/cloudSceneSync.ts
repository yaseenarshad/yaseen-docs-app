import { getScrollToContentState } from "@excalidraw/excalidraw/scene";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export type AppliedCloudScene = {
  routeKey: string;
  version: number;
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

  const openingAppState = {
    ...localAppState,
    ...restoredAppState,
    width: localAppState.width,
    height: localAppState.height,
    offsetLeft: localAppState.offsetLeft,
    offsetTop: localAppState.offsetTop,
  };

  return {
    ...restoredAppState,
    ...getScrollToContentState(elements, openingAppState),
  };
};
