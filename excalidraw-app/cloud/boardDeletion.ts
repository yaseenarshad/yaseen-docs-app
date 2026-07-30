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
  removeBoard: (args: {
    boardId: BoardId;
  }) => Promise<{ assetDeleteToken: string | null }>;
  navigate: (destination: BoardDeletionDestination) => void;
  cleanupAssets: (assetDeleteToken: string) => Promise<void>;
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
  onCleanupError,
}: DeleteBoardAndCleanupOptions<BoardId>) => {
  const { assetDeleteToken } = await removeBoard({ boardId });

  if (isActive && isCurrentRouteCompletion(startedRoute, getCurrentRoute())) {
    navigate(destination);
  }

  if (!assetDeleteToken) {
    return;
  }

  try {
    await cleanupAssets(assetDeleteToken);
  } catch {
    onCleanupError();
  }
};
