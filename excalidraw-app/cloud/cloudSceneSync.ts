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
