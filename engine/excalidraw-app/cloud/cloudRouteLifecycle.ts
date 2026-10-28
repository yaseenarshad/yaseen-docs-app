import type { CloudRoute } from "./cloudRoutes";

export type CloudRouteGeneration = {
  identity: string;
  generation: number;
};

export const getCloudRouteIdentity = (route: CloudRoute) =>
  route.kind === "owner"
    ? `owner:${route.slug}`
    : route.kind === "shared"
    ? `shared:${route.shareToken}`
    : "home";

export const isCurrentRouteCompletion = (
  started: CloudRouteGeneration,
  current: CloudRouteGeneration,
) =>
  started.identity === current.identity &&
  started.generation === current.generation;
