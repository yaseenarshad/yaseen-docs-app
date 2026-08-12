import { isCurrentRouteCompletion } from "./cloudRouteLifecycle";

import type { CloudRouteGeneration } from "./cloudRouteLifecycle";

export type BoardDeletionDestination =
  | { kind: "owner"; slug: string }
  | { kind: "home" };

type DeleteBoardAndCleanupOptions<BoardId extends string> = {
  boardId: BoardId;
  destination: BoardDeletionDestination;
  isActive: boolean;
  startedRoute: CloudRouteGeneration;
  getCurrentRoute: () => CloudRouteGeneration;
  removeBoard: (args: { boardId: BoardId }) => Promise<{
    assetDeleteToken: string | null;
    sceneDeleteToken?: string | null;
  }>;
  navigate: (destination: BoardDeletionDestination) => void;
  cleanupAssets: (assetDeleteToken: string) => Promise<void>;
  cleanupScenes?: (sceneDeleteToken: string) => Promise<void>;
  onCleanupError: () => void;
};

export const deleteBoardAndCleanup = async <BoardId extends string>({
  boardId,
  destination,
  isActive,
  startedRoute,
  getCurrentRoute,
  removeBoard,
  navigate,
  cleanupAssets,
  cleanupScenes,
  onCleanupError,
}: DeleteBoardAndCleanupOptions<BoardId>) => {
  const { assetDeleteToken, sceneDeleteToken } = await removeBoard({ boardId });

  if (isActive && isCurrentRouteCompletion(startedRoute, getCurrentRoute())) {
    navigate(destination);
  }

  // Images and scene objects are separate capabilities, so one failing sweep
  // must not skip the other; deletion itself is already durable either way.
  let failed = false;
  const drain = async (
    token: string | null | undefined,
    cleanup: ((token: string) => Promise<void>) | undefined,
  ) => {
    if (!token || !cleanup) {
      return;
    }
    try {
      await cleanup(token);
    } catch {
      failed = true;
    }
  };

  await drain(assetDeleteToken, cleanupAssets);
  await drain(sceneDeleteToken, cleanupScenes);
  if (failed) {
    onCleanupError();
  }
};
