export type AppliedCloudScene = {
  routeKey: string;
  version: number;
};

export const shouldApplyCloudScene = (
  previous: AppliedCloudScene | null,
  next: AppliedCloudScene,
) => previous?.routeKey !== next.routeKey || previous.version !== next.version;

export const shouldMergeCloudScene = (
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
