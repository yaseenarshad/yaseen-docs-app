import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";

import { migrateBoardScene } from "./boardScenePersistence";
import { sanitizeCloudPresentationScene } from "./presentationScenePersistence";

import type { BoardSceneSaveDependencies } from "./boardScenePersistence";
import type { CloudRoute } from "./cloudRoutes";

export const REVOKED_SHARED_BOARD_MESSAGE =
  "This shared board is no longer available. The share link may have been revoked.";

export const CLONE_COMMIT_FAILED_MESSAGE =
  "The copy could not be written to your account.";

export type BoardCloneSource = {
  title: string;
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

export type BoardAssetUploadDependencies<BoardId extends string> = {
  createUploadGrant: (args: {
    boardId: BoardId;
    fileId: string;
    mimeType: string;
    size: number;
  }) => Promise<{ token: string }>;
  registerUpload: (args: { token: string; etag: string }) => Promise<unknown>;
};

export type BoardCloneDependencies<BoardId extends string> = {
  createBoard: (args: {
    title: string;
  }) => Promise<{ boardId: BoardId; slug: string }>;
  removeBoard: (args: { boardId: BoardId }) => Promise<unknown>;
  uploadAsset: (args: {
    boardId: BoardId;
    file: BinaryFileData;
  }) => Promise<unknown>;
  sceneSave: BoardSceneSaveDependencies;
  navigate: (destination: { slug: string }) => void;
};

export type BoardCloneResult<BoardId extends string> = {
  boardId: BoardId;
  slug: string;
  failedAssetFileIds: string[];
};

/**
 * The button is hidden — never disabled — for anyone who cannot act on it, and
 * stays hidden while the account query is still resolving so a signed-in viewer
 * never sees it flicker in as an anonymous-looking control.
 */
export const shouldOfferBoardCopy = ({
  routeKind,
  isViewer,
  account,
}: {
  routeKind: CloudRoute["kind"];
  isViewer: boolean;
  account: { isAnonymous: boolean } | null | undefined;
}) => routeKind === "shared" && isViewer && account?.isAnonymous === false;

export const getBoardCopyTitle = (title: string) => `Copy of ${title}`;

/**
 * A revoked link stops resolving shared metadata, so the absence of an opened
 * viewer Board is what fails the clone closed before anything is created.
 */
export const requireSharedBoardTitle = (
  openedBoard: { access: string; board: { title: string } } | null | undefined,
) => {
  if (!openedBoard || openedBoard.access !== "viewer") {
    throw new Error(REVOKED_SHARED_BOARD_MESSAGE);
  }
  return openedBoard.board.title;
};

/**
 * Hosted animation references resolve against the *source* Board, so a clone
 * that kept them would throw "Presentation animation not found" on open. The
 * reference is dropped rather than re-pointed: animations are not copied in v1.
 */
export const stripPresentationAnimationReferences = <
  Element extends ExcalidrawElement,
>(
  elements: readonly Element[],
): Element[] =>
  elements.map((element) => {
    if (!element.customData || !("animationAsset" in element.customData)) {
      return element;
    }
    const { animationAsset: _animationAsset, ...customData } =
      element.customData;
    return { ...element, customData } as Element;
  });

const getReferencedFileIds = (elements: readonly ExcalidrawElement[]) => {
  const fileIds: string[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (!("fileId" in element) || !element.fileId || seen.has(element.fileId)) {
      continue;
    }
    seen.add(element.fileId);
    fileIds.push(element.fileId);
  }
  return fileIds;
};

/** The grant flow an owner's own image upload uses, pointed at the clone. */
export const uploadClonedBoardAsset = async <BoardId extends string>(
  { boardId, file }: { boardId: BoardId; file: BinaryFileData },
  dependencies: BoardAssetUploadDependencies<BoardId>,
) => {
  const blob = await (await fetch(file.dataURL)).blob();
  const { token } = await dependencies.createUploadGrant({
    boardId,
    fileId: file.id,
    mimeType: file.mimeType,
    size: blob.size,
  });
  const uploadResponse = await fetch("/api/assets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.mimeType,
    },
    body: blob,
  });
  const body = (await uploadResponse.json()) as {
    etag?: string;
    error?: string;
  };
  if (!uploadResponse.ok || !body.etag) {
    throw new Error(body.error || "Image copy failed");
  }
  await dependencies.registerUpload({ token, etag: body.etag });
};

/**
 * A partially illustrated copy is still a usable copy, so every image gets one
 * retry and a persistent failure is reported rather than aborting the clone.
 */
const copyBoardAssets = async <BoardId extends string>(
  boardId: BoardId,
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
  uploadAsset: BoardCloneDependencies<BoardId>["uploadAsset"],
) => {
  const failedAssetFileIds: string[] = [];
  for (const fileId of getReferencedFileIds(elements)) {
    const file = files[fileId];
    if (!file) {
      failedAssetFileIds.push(fileId);
      continue;
    }
    let failed = true;
    for (let attempt = 0; attempt < 2 && failed; attempt++) {
      try {
        await uploadAsset({ boardId, file });
        failed = false;
      } catch (cause) {
        console.warn("Could not copy a shared Board image", cause);
      }
    }
    if (failed) {
      failedAssetFileIds.push(fileId);
    }
  }
  return failedAssetFileIds;
};

const describeCause = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * A clone that cannot store its scene must not become the user's landing page,
 * so the empty Board row is removed. If that fails too, both failures are told.
 */
const discardStrandedClone = async <BoardId extends string>(
  boardId: BoardId,
  dependencies: BoardCloneDependencies<BoardId>,
  cause: unknown,
) => {
  const message = describeCause(cause);
  try {
    await dependencies.removeBoard({ boardId });
  } catch (removeCause) {
    return new Error(
      `${message} The empty copy could not be removed either: ${describeCause(
        removeCause,
      )}`,
    );
  }
  return new Error(message);
};

/**
 * Clones the Board a viewer currently has open into their own account.
 *
 * The source is the live editor state rather than the stored scene: it covers
 * legacy and migrated Boards through one path and guarantees the image bytes
 * are already in memory. The source Board itself is never written to.
 */
export const cloneBoardIntoOwnAccount = async <BoardId extends string>(
  source: BoardCloneSource,
  dependencies: BoardCloneDependencies<BoardId>,
): Promise<BoardCloneResult<BoardId>> => {
  const elements = stripPresentationAnimationReferences(
    source.elements.filter((element) => !element.isDeleted),
  );
  const sceneJson = sanitizeCloudPresentationScene(
    serializeAsJSON(elements, source.appState, source.files, "database"),
  );

  const { boardId, slug } = await dependencies.createBoard({
    title: getBoardCopyTitle(source.title),
  });

  const failedAssetFileIds = await copyBoardAssets(
    boardId,
    elements,
    source.files,
    dependencies.uploadAsset,
  );

  // A freshly created Board is legacy — it has no scene manifest yet — so its
  // first object-storage write has to be a migration, not a save.
  let commit;
  try {
    commit = await migrateBoardScene(
      { boardId, expectedVersion: 0, sceneJson },
      dependencies.sceneSave,
    );
  } catch (cause) {
    throw await discardStrandedClone(boardId, dependencies, cause);
  }
  if (commit.status !== "committed") {
    throw await discardStrandedClone(
      boardId,
      dependencies,
      new Error(CLONE_COMMIT_FAILED_MESSAGE),
    );
  }

  dependencies.navigate({ slug });
  return { boardId, slug, failedAssetFileIds };
};
