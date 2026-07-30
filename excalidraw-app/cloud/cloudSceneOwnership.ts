import type { CloudRoute } from "./cloudRoutes";

export const cloudRouteOwnsScene = (route: CloudRoute) =>
  route.kind === "owner" || route.kind === "shared";

export const selectInitialLocalElements = <Element>(
  localElements: readonly Element[] | null | undefined,
  routeOwnsScene: boolean,
) => (routeOwnsScene ? [] : localElements);

export const shouldRunLocalSceneSync = ({
  routeOwnsScene,
  documentHidden,
  collaborationActive,
}: {
  routeOwnsScene: boolean;
  documentHidden: boolean;
  collaborationActive: boolean;
}) => !routeOwnsScene && !documentHidden && !collaborationActive;
