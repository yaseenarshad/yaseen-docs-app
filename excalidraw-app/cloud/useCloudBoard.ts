import {
  useConvex,
  useMutation,
  usePaginatedQuery_experimental,
  useQuery,
} from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import { api } from "../../convex/_generated/api";
import {
  LEGACY_BOARD_SCENE_RAW_BYTES,
  MAX_BOARD_SCENE_RAW_BYTES,
} from "../../board-scenes/types";
import {
  BoardSceneSizeError,
  getBoardSceneRawSize,
  getBoardSceneSizeError,
} from "../../board-scenes/sizePolicy";
import { DOCS_ENABLED } from "../docs/docsMode";

import {
  getCanonicalOwnerPath,
  getLegacyOwnerReplacement,
  parseCloudRoute,
} from "./cloudRoutes";
import { deleteBoardAndCleanup } from "./boardDeletion";
import {
  cloneBoardIntoOwnAccount,
  requireSharedBoardTitle,
  shouldOfferBoardCopy,
  uploadClonedBoardAsset,
} from "./boardCloning";
import {
  getCloudRouteIdentity,
  isCurrentRouteCompletion,
} from "./cloudRouteLifecycle";
import {
  acceptCloudSceneWithoutSave,
  shouldQueueCloudSceneSave,
} from "./cloudSaveBaseline";
import {
  cleanupBoardSceneObjects,
  fetchBoardSceneObject,
  migrateBoardScene,
  readBoardScene,
  saveBoardScene,
  uploadBoardSceneObject,
} from "./boardScenePersistence";
import { createBrowserCloudTabSaveCoordinator } from "./cloudTabCoordination";
import { createBrowserCloudCrashJournal } from "./cloudCrashJournal";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
import {
  createBoardPreviewImage,
  getBoardPreviewDelay,
} from "./boardPreviewGeneration";
import { publishBoardPreview } from "./boardPreviewPublishing";
import { sanitizeCloudPresentationScene } from "./presentationScenePersistence";
import {
  cleanupPresentationAnimationObjects,
  publishPresentationAnimation as publishTrustedPresentationAnimation,
  uploadPresentationAnimationBlob,
} from "./presentationAnimationPublishing";

import {
  BOARD_SORT_STORAGE_KEY,
  dedupeBoards,
  getStoredBoardSort,
} from "./boardOrganizer";

import type { Id } from "../../convex/_generated/dataModel";
import type { BoardCloneSource } from "./boardCloning";
import type { BoardSort } from "./boardOrganizer";
import type { CloudRouteGeneration } from "./cloudRouteLifecycle";
import type { CloudRoute } from "./cloudRoutes";
import type {
  BoardPreviewImage,
  BoardPreviewScene,
} from "./boardPreviewGeneration";
import type { CloudSceneSaveOrigin } from "./cloudSaveBaseline";
import type { CloudTabSaveCoordinator } from "./cloudTabCoordination";
import type { CloudCrashJournal } from "./cloudCrashJournal";
import type {
  BoardSceneReadDependencies,
  BoardSceneSaveDependencies,
} from "./boardScenePersistence";

export type CloudSaveStatus =
  | "loading"
  | "saved"
  | "saving"
  | "conflict"
  | "error"
  | "viewer";

export const CLOUD_SAVE_DEBOUNCE_MS = 10_000;
export const CLOUD_SAVE_MAX_PENDING_MS = 60_000;
export const CLOUD_HANDOFF_VERSION_WAIT_MS = 5_000;
// The crash journal has to be durable long before the cloud save it protects,
// so it runs on a debounce short enough to survive an abrupt tab teardown.
export const CLOUD_CRASH_JOURNAL_DEBOUNCE_MS = 300;

const getRoute = () => parseCloudRoute(window.location.pathname);

// A trailing debounce alone lets an uninterrupted drawing session keep local
// edits unsaved forever, so cap how long the oldest pending change may wait.
export const getCloudSaveDelay = (now: number, pendingSince: number) =>
  Math.max(
    0,
    Math.min(
      CLOUD_SAVE_DEBOUNCE_MS,
      pendingSince + CLOUD_SAVE_MAX_PENDING_MS - now,
    ),
  );

type OpenedCloudScene = {
  boardId: Id<"diagrams">;
  sceneJson: string;
  version: number;
};

type BoardDocManifestSummary = {
  docId: Id<"docs">;
  title: string;
  lifecycle: "active" | "trashed" | "purged";
  version: number;
  contentSize: number;
  contentHash?: string;
};

/**
 * Both stores answer a save the same way, so the legacy `saved` result and an
 * object-storage commit are normalized before anything reacts to them. Only
 * `committed` advances the accepted version.
 */
type CloudBoardSaveOutcome =
  | { status: "upgrade-required" }
  | { status: "conflict"; version: number }
  | { status: "unchanged"; version: number; updatedAt: number }
  | {
      status: "committed";
      version: number;
      updatedAt: number;
      snapshotCreated: boolean;
    };

// The reactive subscription only carries metadata, so the opened Board is only
// complete once the scene for the board it describes has been fetched. The
// version reported is the scene's, never the metadata's: saving against a
// version whose scene this tab has not seen would silently drop peer edits.
const withCloudScene = <Metadata extends { board: { _id: Id<"diagrams"> } }>(
  metadata: Metadata | null | undefined,
  scene: OpenedCloudScene | null,
) => {
  if (metadata === null) {
    return null;
  }
  if (
    metadata === undefined ||
    scene === null ||
    scene.boardId !== metadata.board._id
  ) {
    return undefined;
  }
  return {
    ...metadata,
    sceneJson: scene.sceneJson,
    version: scene.version,
  };
};

export const useCloudBoard = () => {
  const [route, setRoute] = useState<CloudRoute>(getRoute);
  const [boardSearch, setBoardSearch] = useState("");
  const [boardSort, setBoardSortState] = useState<BoardSort>(() =>
    getStoredBoardSort(window.localStorage.getItem(BOARD_SORT_STORAGE_KEY)),
  );
  const routeIdentity = getCloudRouteIdentity(route);
  const currentRouteRef = useRef<CloudRouteGeneration>({
    identity: routeIdentity,
    generation: 0,
  });
  if (currentRouteRef.current.identity !== routeIdentity) {
    currentRouteRef.current = {
      identity: routeIdentity,
      generation: currentRouteRef.current.generation + 1,
    };
  }
  const [saveStatus, setSaveStatus] = useState<CloudSaveStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sceneRawSize, setSceneRawSize] = useState<number | null>(null);
  const [sceneSizeError, setSceneSizeError] =
    useState<ReturnType<typeof getBoardSceneSizeError>>(null);
  const [journalDegraded, setJournalDegraded] = useState(false);
  const blockedSizeRef = useRef<{
    sceneJson: string;
    error: NonNullable<ReturnType<typeof getBoardSceneSizeError>>;
  } | null>(null);
  const [openedScene, setOpenedScene] = useState<OpenedCloudScene | null>(null);
  const openedSceneRef = useRef<OpenedCloudScene | null>(null);
  const sceneRequestRef = useRef(0);
  const convex = useConvex();
  const convexRef = useRef(convex);
  convexRef.current = convex;
  const ensureDefault = useMutation(api.boards.ensureDefault);
  const createBoard = useMutation(api.boards.create);
  const removeBoard = useMutation(api.boards.remove);
  const renameBoard = useMutation(api.boards.rename);
  const saveBoard = useMutation(api.boards.save);
  const setSharing = useMutation(api.boards.setSharing);
  const moveToFolder = useMutation(api.boards.moveToFolder);
  const createFolderMutation = useMutation(api.boardFolders.create);
  const renameFolderMutation = useMutation(api.boardFolders.rename);
  const removeFolderMutation = useMutation(api.boardFolders.remove);
  const createSceneUploadGrant = useMutation(api.boardScenes.createUploadGrant);
  const commitSceneUpload = useMutation(api.boardScenes.commitUpload);
  const abandonSceneUpload = useMutation(api.boardScenes.abandonUpload);
  const createSceneReadGrant = useMutation(api.boardScenes.createReadGrant);
  const createAssetUploadGrant = useMutation(api.boardAssets.createUploadGrant);
  const registerAssetUpload = useMutation(api.boardAssets.registerUpload);
  const createPreviewUploadGrant = useMutation(
    api.boardPreviews.createUploadGrant,
  );
  const registerPreviewUpload = useMutation(api.boardPreviews.registerUpload);
  const recordEmptyPreview = useMutation(api.boardPreviews.recordEmpty);
  const createPresentationAnimationReadGrant = useMutation(
    api.presentationAnimations.createReadGrant,
  );
  const createPresentationAnimationUploadGrant = useMutation(
    api.presentationAnimations.createUploadGrant,
  );
  const registerPresentationAnimationUpload = useMutation(
    api.presentationAnimations.registerUpload,
  );
  const abandonPresentationAnimationUpload = useMutation(
    api.presentationAnimations.abandonUpload,
  );
  const versionRef = useRef(0);
  const observedVersionRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const saveInFlightBoardIdRef = useRef<Id<"diagrams"> | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewRequestRef = useRef(0);
  const lastPreviewStartedAtRef = useRef(new Map<string, number>());
  const pendingSceneRef = useRef<{
    boardId: Id<"diagrams">;
    route: CloudRouteGeneration;
    sceneJson: string;
    rawSize: number;
    previewScene?: BoardPreviewScene;
    recoveryAttempt: 0 | 1;
  } | null>(null);
  const pendingSinceRef = useRef<number | null>(null);
  const conflictRecoveryRef = useRef<{
    boardId: Id<"diagrams">;
    route: CloudRouteGeneration;
    sceneJson: string;
    requiredVersion: number;
  } | null>(null);
  const blockedConflictRef = useRef<{
    boardId: Id<"diagrams">;
    route: CloudRouteGeneration;
    sceneJson: string;
  } | null>(null);
  const acceptedSceneRef = useRef<string | null>(null);
  const uploadedFileIdsRef = useRef(new Set<string>());
  const uploadingFileIdsRef = useRef(new Set<string>());
  const flushSaveRef = useRef<() => Promise<boolean>>(async () => true);
  const saveCoordinatorRef = useRef<CloudTabSaveCoordinator | null>(null);
  const requiredVersionByBoardRef = useRef(new Map<string, number>());
  const requiredVersionTimerByBoardRef = useRef(new Map<string, number>());
  const navigationRequestRef = useRef(0);
  const crashJournalRef = useRef<CloudCrashJournal | null>(null);
  // Boards this tab knows are stored in object storage. A Board this tab just
  // migrated belongs here before the reactive metadata catches up, so the save
  // that follows cannot fall back to the legacy document it no longer owns.
  const sceneManifestBoardsRef = useRef(new Set<string>());
  const migrationAttemptedRef = useRef(new Set<string>());
  const drainedCleanupTokensRef = useRef(new Set<string>());
  const journalTimerRef = useRef<number | null>(null);
  const journalEntryRef = useRef<{
    boardId: Id<"diagrams">;
    sceneJson: string;
    baseVersion: number;
  } | null>(null);

  const getCrashJournal = useCallback(
    () => (crashJournalRef.current ??= createBrowserCloudCrashJournal()),
    [],
  );

  const sceneSaveDependencies = useMemo<BoardSceneSaveDependencies>(
    () => ({
      createUploadGrant: async ({ boardId, docRefs, ...manifest }) =>
        await createSceneUploadGrant({
          ...manifest,
          boardId: boardId as Id<"diagrams">,
          ...(docRefs
            ? {
                docRefs: docRefs.map((ref) => ({
                  ...ref,
                  docId: ref.docId as Id<"docs">,
                })),
              }
            : null),
        }),
      upload: uploadBoardSceneObject,
      commitUpload: commitSceneUpload,
      abandonUpload: abandonSceneUpload,
      cleanup: cleanupBoardSceneObjects,
    }),
    [abandonSceneUpload, commitSceneUpload, createSceneUploadGrant],
  );

  const sceneReadDependencies = useMemo<BoardSceneReadDependencies>(
    () => ({
      createReadGrant: async (args) =>
        await createSceneReadGrant(
          "boardId" in args
            ? { boardId: args.boardId as Id<"diagrams"> }
            : { shareToken: args.shareToken },
        ),
      fetchObject: fetchBoardSceneObject,
    }),
    [createSceneReadGrant],
  );

  const writeJournalEntry = useCallback(
    (entry: NonNullable<typeof journalEntryRef.current>) => {
      journalEntryRef.current = null;
      const journal = getCrashJournal();
      void journal.write({ ...entry, savedAt: Date.now() }).then(() => {
        setJournalDegraded(journal.isDegraded());
      });
    },
    [getCrashJournal],
  );

  const scheduleJournalWrite = useCallback(
    (entry: NonNullable<typeof journalEntryRef.current>) => {
      journalEntryRef.current = entry;
      if (journalTimerRef.current !== null) {
        window.clearTimeout(journalTimerRef.current);
      }
      journalTimerRef.current = window.setTimeout(() => {
        journalTimerRef.current = null;
        const pending = journalEntryRef.current;
        if (pending) {
          writeJournalEntry(pending);
        }
      }, CLOUD_CRASH_JOURNAL_DEBOUNCE_MS);
    },
    [writeJournalEntry],
  );

  // Anything that ends this tab's ownership of a pending scene writes the
  // journal out rather than dropping it: the edit is still unsaved either way.
  const flushJournalWrite = useCallback(() => {
    if (journalTimerRef.current !== null) {
      window.clearTimeout(journalTimerRef.current);
      journalTimerRef.current = null;
    }
    const pending = journalEntryRef.current;
    if (pending) {
      writeJournalEntry(pending);
    }
  }, [writeJournalEntry]);

  const clearJournalEntry = useCallback(
    (boardId: Id<"diagrams">) => {
      if (journalTimerRef.current !== null) {
        window.clearTimeout(journalTimerRef.current);
        journalTimerRef.current = null;
      }
      journalEntryRef.current = null;
      void getCrashJournal().clear(boardId);
    },
    [getCrashJournal],
  );

  const requireObservedVersion = useCallback(
    (boardId: Id<"diagrams">, version: number) => {
      const previousRequired =
        requiredVersionByBoardRef.current.get(boardId) ?? 0;
      requiredVersionByBoardRef.current.set(
        boardId,
        Math.max(previousRequired, version),
      );
      const previousTimer = requiredVersionTimerByBoardRef.current.get(boardId);
      if (previousTimer !== undefined) {
        window.clearTimeout(previousTimer);
      }
      const timer = window.setTimeout(() => {
        requiredVersionTimerByBoardRef.current.delete(boardId);
        requiredVersionByBoardRef.current.delete(boardId);
        const recovery = conflictRecoveryRef.current;
        if (recovery?.boardId === boardId) {
          const pending = pendingSceneRef.current;
          conflictRecoveryRef.current = null;
          blockedConflictRef.current = {
            boardId,
            route: recovery.route,
            sceneJson:
              pending?.boardId === boardId
                ? pending.sceneJson
                : recovery.sceneJson,
          };
          pendingSceneRef.current = null;
          pendingSinceRef.current = null;
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
          setSaveStatus("conflict");
          setErrorMessage(
            "The latest change from another tab could not be loaded. Your local edit is still on this canvas; copy or export it before reloading.",
          );
          return;
        }
        if (
          pendingSceneRef.current?.boardId === boardId &&
          saveTimerRef.current === null
        ) {
          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null;
            void flushSaveRef.current();
          }, 0);
        }
      }, CLOUD_HANDOFF_VERSION_WAIT_MS);
      requiredVersionTimerByBoardRef.current.set(boardId, timer);
    },
    [],
  );

  useEffect(() => {
    const coordinator = createBrowserCloudTabSaveCoordinator({
      onRemoteClaim: ({ boardId }) => {
        const pendingBoardId = pendingSceneRef.current?.boardId;
        if (
          pendingBoardId === boardId ||
          saveInFlightBoardIdRef.current === boardId
        ) {
          void flushSaveRef.current();
        }
      },
      onRemoteSaveComplete: ({ boardId, version }) => {
        if (version <= observedVersionRef.current) {
          return;
        }
        requireObservedVersion(boardId as Id<"diagrams">, version);
      },
    });
    saveCoordinatorRef.current = coordinator;
    return () => {
      if (saveCoordinatorRef.current === coordinator) {
        saveCoordinatorRef.current = null;
      }
      coordinator.close();
    };
  }, [requireObservedVersion]);

  const ownedBoardMetadata = useQuery(
    api.boards.openMineMetadata,
    route.kind === "owner" ? { slug: route.slug } : "skip",
  );
  const paginatedBoards = usePaginatedQuery_experimental({
    query: api.boards.listMinePaginated,
    args: { sort: boardSort, query: boardSearch },
    initialNumItems: 40,
  });
  const boards = useMemo(
    () => dedupeBoards(paginatedBoards.data ?? []),
    [paginatedBoards.data],
  );
  const folders = useQuery(api.boardFolders.listMine, {});
  const pendingSceneCleanupTokens = useQuery(
    api.boardScenes.pendingCleanup,
    route.kind === "owner" ? {} : "skip",
  );
  const sharedBoardMetadata = useQuery(
    api.boards.openSharedMetadata,
    route.kind === "shared" ? { shareToken: route.shareToken } : "skip",
  );
  // Only a real account can be given a copy: an anonymous viewer's session is
  // throwaway, so the clone would land somewhere they can never get back to.
  const account = useQuery(
    api.account.current,
    route.kind === "shared" ? {} : "skip",
  );
  const currentOwnedBoardMetadata =
    route.kind === "owner" &&
    ownedBoardMetadata &&
    ownedBoardMetadata.board.slug !== route.slug
      ? undefined
      : ownedBoardMetadata;
  const openedBoardMetadata =
    route.kind === "owner"
      ? currentOwnedBoardMetadata
      : route.kind === "shared"
      ? sharedBoardMetadata
      : undefined;
  const boardDocManifestPage = useQuery(
    api.boardDocs.listManifestPage,
    DOCS_ENABLED && route.kind === "owner" && currentOwnedBoardMetadata
      ? {
          boardId: currentOwnedBoardMetadata.board._id,
          shareToken: null,
          cursor: null,
        }
      : DOCS_ENABLED && route.kind === "shared" && sharedBoardMetadata
      ? { boardId: null, shareToken: route.shareToken, cursor: null }
      : "skip",
  );
  const [additionalBoardDocManifest, setAdditionalBoardDocManifest] = useState<
    BoardDocManifestSummary[]
  >([]);
  const [isBoardDocManifestPaging, setIsBoardDocManifestPaging] =
    useState(false);
  const manifestOwnerBoardId =
    route.kind === "owner" && currentOwnedBoardMetadata
      ? currentOwnedBoardMetadata.board._id
      : null;
  const manifestShareToken =
    route.kind === "shared" && sharedBoardMetadata ? route.shareToken : null;
  const manifestNextCursor = boardDocManifestPage?.nextCursor ?? null;
  const manifestPageIsDone = boardDocManifestPage?.isDone ?? true;
  const manifestPageSignature =
    boardDocManifestPage?.page
      .map(
        (doc) =>
          `${doc.docId}:${doc.version}:${doc.lifecycle}:${doc.title}:${
            doc.contentHash ?? ""
          }`,
      )
      .join("|") ?? "missing";
  useEffect(() => {
    let cancelled = false;
    setAdditionalBoardDocManifest((current) =>
      current.length === 0 ? current : [],
    );
    if (manifestPageSignature === "missing" || manifestPageIsDone) {
      setIsBoardDocManifestPaging(false);
      return;
    }
    const access =
      manifestOwnerBoardId !== null
        ? { boardId: manifestOwnerBoardId, shareToken: null }
        : manifestShareToken !== null
        ? { boardId: null, shareToken: manifestShareToken }
        : null;
    if (!access) {
      return;
    }
    setIsBoardDocManifestPaging(true);
    void (async () => {
      const pages: BoardDocManifestSummary[] = [];
      let cursor = manifestNextCursor;
      while (cursor && !cancelled) {
        const page = await convexRef.current.query(
          api.boardDocs.listManifestPage,
          {
            ...access,
            cursor,
          },
        );
        pages.push(...page.page);
        cursor = page.nextCursor;
      }
      if (!cancelled) {
        setAdditionalBoardDocManifest(pages);
        setIsBoardDocManifestPaging(false);
      }
    })().catch(() => {
      if (!cancelled) {
        setIsBoardDocManifestPaging(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    manifestNextCursor,
    manifestOwnerBoardId,
    manifestPageIsDone,
    manifestPageSignature,
    manifestShareToken,
  ]);
  const boardDocManifest = useMemo(
    () =>
      boardDocManifestPage
        ? [...boardDocManifestPage.page, ...additionalBoardDocManifest]
        : undefined,
    [additionalBoardDocManifest, boardDocManifestPage],
  );
  const currentOwnedBoard = useMemo(
    () => withCloudScene(currentOwnedBoardMetadata, openedScene),
    [currentOwnedBoardMetadata, openedScene],
  );
  const currentSharedBoard = useMemo(
    () => withCloudScene(sharedBoardMetadata, openedScene),
    [openedScene, sharedBoardMetadata],
  );
  const openedBoard =
    route.kind === "owner"
      ? currentOwnedBoard
      : route.kind === "shared"
      ? currentSharedBoard
      : undefined;
  const ownedAssets = useQuery(
    api.boardAssets.listMine,
    route.kind === "owner" && currentOwnedBoard
      ? { boardId: currentOwnedBoard.board._id }
      : "skip",
  );
  const sharedAssets = useQuery(
    api.boardAssets.listShared,
    route.kind === "shared" ? { shareToken: route.shareToken } : "skip",
  );
  const assets =
    route.kind === "owner"
      ? ownedAssets
      : route.kind === "shared"
      ? sharedAssets
      : undefined;

  // Board versions only ever move forward, so a scene that is not newer than
  // the one already held is a lagging subscription or a superseded fetch.
  const acceptOpenedScene = useCallback((scene: OpenedCloudScene) => {
    const known = openedSceneRef.current;
    if (known?.boardId === scene.boardId && known.version >= scene.version) {
      return;
    }
    openedSceneRef.current = scene;
    setOpenedScene(scene);
  }, []);

  useEffect(() => {
    flushJournalWrite();
    versionRef.current = 0;
    observedVersionRef.current = 0;
    sceneRequestRef.current += 1;
    openedSceneRef.current = null;
    setOpenedScene(null);
    pendingSceneRef.current = null;
    pendingSinceRef.current = null;
    conflictRecoveryRef.current = null;
    blockedConflictRef.current = null;
    requiredVersionByBoardRef.current.clear();
    blockedSizeRef.current = null;
    setSceneRawSize(null);
    setSceneSizeError(null);
    for (const timer of requiredVersionTimerByBoardRef.current.values()) {
      window.clearTimeout(timer);
    }
    requiredVersionTimerByBoardRef.current.clear();
    acceptedSceneRef.current = null;
    uploadedFileIdsRef.current = new Set();
    uploadingFileIdsRef.current = new Set();
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    previewRequestRef.current += 1;
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setSaveStatus("loading");
    setErrorMessage(null);
  }, [flushJournalWrite, routeIdentity]);

  // Declared after the route reset so a route change clears the previous scene
  // before this effect can start a fetch the reset would immediately discard.
  useEffect(() => {
    const metadata = openedBoardMetadata;
    if (!metadata) {
      return;
    }
    const boardId = metadata.board._id;
    const known = openedSceneRef.current;
    if (known?.boardId === boardId && known.version >= metadata.version) {
      return;
    }
    const startedRoute = { ...currentRouteRef.current };
    const requestId = ++sceneRequestRef.current;
    const isCurrentRequest = () =>
      requestId === sceneRequestRef.current &&
      isCurrentRouteCompletion(startedRoute, currentRouteRef.current);
    // A Board that carries a manifest is stored in R2 and its legacy document
    // is off limits; a Board without one is still a legacy read.
    const loadScene = metadata.sceneManifest
      ? route.kind === "owner"
        ? async () => ({
            boardId,
            ...(await readBoardScene({ boardId }, sceneReadDependencies)),
          })
        : route.kind === "shared"
        ? async () => ({
            boardId,
            ...(await readBoardScene(
              { shareToken: route.shareToken },
              sceneReadDependencies,
            )),
          })
        : null
      : route.kind === "owner"
      ? async () =>
          await convex.query(api.boards.openMineScene, {
            slug: route.slug,
          })
      : route.kind === "shared"
      ? async () =>
          await convex.query(api.boards.openSharedScene, {
            shareToken: route.shareToken,
          })
      : null;
    if (!loadScene) {
      return;
    }
    void loadScene()
      .then((scene) => {
        if (!isCurrentRequest() || !scene || scene.boardId !== boardId) {
          return;
        }
        acceptOpenedScene(scene);
      })
      .catch((cause) => {
        if (!isCurrentRequest()) {
          return;
        }
        setSaveStatus("error");
        setErrorMessage(
          cause instanceof Error ? cause.message : "Could not open this board",
        );
      });
  }, [
    acceptOpenedScene,
    convex,
    openedBoardMetadata,
    route,
    sceneReadDependencies,
  ]);

  // A Board whose scene is already in object storage is remembered for the rest
  // of the session: the reactive metadata is the source, but a save must never
  // wait on it to learn the legacy document is gone.
  useEffect(() => {
    if (openedBoardMetadata?.sceneManifest) {
      sceneManifestBoardsRef.current.add(openedBoardMetadata.board._id);
    }
  }, [openedBoardMetadata]);

  // Lazy migration: the owner who just opened a legacy Board re-registers that
  // exact scene as its first R2 object, at the same version and without
  // touching the modified time. It is invisible, it takes the same same-Board
  // exclusive section a save takes so only one tab performs it, and a failure
  // simply leaves the Board legacy for the next open to retry.
  useEffect(() => {
    const metadata = openedBoardMetadata;
    const scene = openedScene;
    if (
      route.kind !== "owner" ||
      !metadata ||
      metadata.access !== "owner" ||
      metadata.sceneManifest ||
      !scene ||
      scene.boardId !== metadata.board._id
    ) {
      return;
    }
    const boardId = metadata.board._id;
    if (
      migrationAttemptedRef.current.has(boardId) ||
      sceneManifestBoardsRef.current.has(boardId)
    ) {
      return;
    }
    migrationAttemptedRef.current.add(boardId);
    const migrate = async () =>
      await migrateBoardScene(
        {
          boardId,
          expectedVersion: scene.version,
          sceneJson: scene.sceneJson,
        },
        sceneSaveDependencies,
      );
    void (
      saveCoordinatorRef.current?.runSaveExclusive(boardId, migrate) ??
      migrate()
    )
      .then((result) => {
        if (result.status === "committed") {
          sceneManifestBoardsRef.current.add(boardId);
        }
      })
      .catch(() => undefined);
  }, [openedBoardMetadata, openedScene, route.kind, sceneSaveDependencies]);

  // Retired scene objects are swept opportunistically: the capability is
  // bounded, deleting is idempotent, and a failure is never user-facing.
  useEffect(() => {
    for (const token of pendingSceneCleanupTokens ?? []) {
      if (drainedCleanupTokensRef.current.has(token)) {
        continue;
      }
      drainedCleanupTokensRef.current.add(token);
      void cleanupBoardSceneObjects(token).catch((error) =>
        console.warn("Could not clean up a retired Board scene object", error),
      );
    }
  }, [pendingSceneCleanupTokens]);

  useEffect(() => {
    const handlePopState = () => {
      navigationRequestRef.current += 1;
      void flushSaveRef.current();
      setRoute(getRoute());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const flushPendingSave = () => {
      flushJournalWrite();
      void flushSaveRef.current();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave();
      }
    };
    window.addEventListener("pagehide", flushPendingSave);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushPendingSave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushJournalWrite]);

  // Closing a Board mid-edit is normally safe: the pending scene is journaled
  // locally within a fraction of a second and replayed the next time this Board
  // opens, so an ordinary unsaved edit is never worth interrupting a close for.
  // Two states break that promise, and only while an edit is actually pending:
  // a save that is failing, which leaves the edit reachable only from this
  // machine's journal until this machine reopens the Board, and a journal whose
  // writes are failing, which leaves it nowhere at all.
  const isClosingRisky = useCallback(() => {
    const pending = pendingSceneRef.current;
    const hasPending =
      pending &&
      isCurrentRouteCompletion(pending.route, currentRouteRef.current);
    const hasInFlight =
      saveInFlightRef.current !== null &&
      saveInFlightBoardIdRef.current === openedBoard?.board._id;
    if (!hasPending && !hasInFlight) {
      return false;
    }
    // The journal is only consulted, never created: an unload is the last
    // moment to be opening IndexedDB, and no journal yet means no failed write.
    return (
      saveStatus === "error" || (crashJournalRef.current?.isDegraded() ?? false)
    );
  }, [openedBoard?.board._id, saveStatus]);

  // The handler decides nothing else and starts no work, so the pagehide flush
  // that follows a confirmed leave runs exactly as it did before.
  useEffect(() => {
    if (route.kind !== "owner" || openedBoard?.access !== "owner") {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isClosingRisky()) {
        return;
      }
      // The browser owns the wording; a handler only opts the dialog in.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isClosingRisky, openedBoard?.access, route.kind]);

  useEffect(() => {
    if (route.kind !== "owner" || !route.isLegacyPath) {
      return;
    }
    const replacement = getLegacyOwnerReplacement(
      route,
      window.location.search,
      window.location.hash,
    );
    if (replacement) {
      window.history.replaceState({}, "", replacement);
      setRoute({ ...route, isLegacyPath: false });
    }
  }, [route]);

  useEffect(() => {
    if (route.kind !== "home") {
      return;
    }
    const startedRoute = { ...currentRouteRef.current };
    let cancelled = false;
    void ensureDefault({})
      .then(({ slug }) => {
        if (
          cancelled ||
          !isCurrentRouteCompletion(startedRoute, currentRouteRef.current)
        ) {
          return;
        }
        const nextRoute = {
          kind: "owner",
          slug,
          isLegacyPath: false,
        } as const;
        window.history.replaceState({}, "", getCanonicalOwnerPath(slug));
        setRoute(nextRoute);
      })
      .catch((cause) => {
        if (
          !cancelled &&
          isCurrentRouteCompletion(startedRoute, currentRouteRef.current)
        ) {
          setSaveStatus("error");
          setErrorMessage(
            cause instanceof Error
              ? cause.message
              : "Could not create a cloud board",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ensureDefault, route.kind]);

  useEffect(() => {
    if (openedBoard) {
      versionRef.current = openedBoard.version;
      observedVersionRef.current = openedBoard.version;
      const requiredVersion = requiredVersionByBoardRef.current.get(
        openedBoard.board._id,
      );
      if (
        requiredVersion !== undefined &&
        openedBoard.version >= requiredVersion
      ) {
        requiredVersionByBoardRef.current.delete(openedBoard.board._id);
        const timer = requiredVersionTimerByBoardRef.current.get(
          openedBoard.board._id,
        );
        if (timer !== undefined) {
          window.clearTimeout(timer);
          requiredVersionTimerByBoardRef.current.delete(openedBoard.board._id);
        }
      }
      acceptedSceneRef.current = acceptCloudSceneWithoutSave(
        sanitizeCloudPresentationScene(openedBoard.sceneJson),
      );
      const hasActiveConflict =
        openedBoard.access === "owner" &&
        (conflictRecoveryRef.current?.boardId === openedBoard.board._id ||
          blockedConflictRef.current?.boardId === openedBoard.board._id);
      if (
        !hasActiveConflict &&
        !pendingSceneRef.current &&
        saveInFlightBoardIdRef.current !== openedBoard.board._id
      ) {
        setSaveStatus(openedBoard.access === "viewer" ? "viewer" : "saved");
        setErrorMessage(null);
      }
    } else if (openedBoard === null) {
      setSaveStatus("error");
      setErrorMessage("This board does not exist or you do not have access.");
    }
  }, [openedBoard, route]);

  useEffect(() => {
    for (const asset of assets ?? []) {
      uploadedFileIdsRef.current.add(asset.fileId);
    }
  }, [assets]);

  const scheduleBoardPreview = useCallback(
    (request: {
      boardId: Id<"diagrams">;
      route: CloudRouteGeneration;
      sourceVersion: number;
      scene: BoardPreviewScene;
    }) => {
      const requestId = ++previewRequestRef.current;
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
      }
      const now = Date.now();
      const lastStartedAt =
        lastPreviewStartedAtRef.current.get(request.boardId) ?? null;
      previewTimerRef.current = window.setTimeout(() => {
        previewTimerRef.current = null;
        const isCurrent = () =>
          previewRequestRef.current === requestId &&
          isCurrentRouteCompletion(request.route, currentRouteRef.current);
        if (!isCurrent()) {
          return;
        }
        lastPreviewStartedAtRef.current.set(request.boardId, Date.now());
        void publishBoardPreview(
          {
            boardId: request.boardId,
            sourceVersion: request.sourceVersion,
            scene: request.scene,
            isCurrent,
          },
          {
            createImage: createBoardPreviewImage,
            createUploadGrant: async (args) =>
              await createPreviewUploadGrant({
                ...args,
                boardId: args.boardId as Id<"diagrams">,
              }),
            upload: async (token: string, preview: BoardPreviewImage) => {
              const response = await fetch("/api/assets", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": preview.mimeType,
                },
                body: preview.blob,
              });
              const body = (await response.json()) as {
                etag?: string;
                error?: string;
              };
              if (!response.ok || !body.etag) {
                throw new Error(body.error || "Board preview upload failed");
              }
              return { etag: body.etag };
            },
            registerUpload: registerPreviewUpload,
            recordEmpty: async (args) =>
              await recordEmptyPreview({
                boardId: args.boardId as Id<"diagrams">,
                sourceVersion: args.sourceVersion,
              }),
            cleanup: async (token: string) => {
              const response = await fetch("/api/assets", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!response.ok) {
                throw new Error("Board preview cleanup failed");
              }
            },
            onCleanupError: (error) =>
              console.warn("Could not clean up an old Board preview", error),
          },
        ).catch((error) => {
          if (isCurrent()) {
            console.warn("Could not generate the saved Board preview", error);
          }
        });
      }, getBoardPreviewDelay(now, lastStartedAt));
    },
    [createPreviewUploadGrant, recordEmptyPreview, registerPreviewUpload],
  );

  const blockOversizedSave = useCallback(
    (pending: NonNullable<typeof pendingSceneRef.current>) => {
      const error =
        pending.rawSize > MAX_BOARD_SCENE_RAW_BYTES
          ? new BoardSceneSizeError(pending.rawSize).data
          : blockedSizeRef.current?.sceneJson === pending.sceneJson
          ? blockedSizeRef.current.error
          : null;
      if (!error) {
        return false;
      }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingSinceRef.current = null;
      setSceneSizeError(error);
      setSaveStatus("error");
      setErrorMessage(
        "Latest changes aren’t saved. Export a backup or reduce this board’s size.",
      );
      return true;
    },
    [],
  );

  const settleSaveStatus = useCallback(() => {
    const pending = pendingSceneRef.current;
    if (pending && blockOversizedSave(pending)) {
      return;
    }
    setSaveStatus(pending ? "saving" : "saved");
    setErrorMessage(null);
  }, [blockOversizedSave]);

  const flushSave = useCallback(async () => {
    const inFlight = saveInFlightRef.current;
    if (inFlight) {
      const didSave = await inFlight;
      if (didSave && pendingSceneRef.current !== null) {
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        return await flushSaveRef.current();
      }
      return didSave;
    }
    if (!openedBoard || openedBoard.access !== "owner") {
      return true;
    }
    const pending = pendingSceneRef.current;
    if (
      !pending ||
      pending.boardId !== openedBoard.board._id ||
      !isCurrentRouteCompletion(pending.route, currentRouteRef.current)
    ) {
      return true;
    }
    const requiredVersion = requiredVersionByBoardRef.current.get(
      pending.boardId,
    );
    if (blockOversizedSave(pending)) {
      return false;
    }
    if (
      requiredVersion !== undefined &&
      observedVersionRef.current < requiredVersion
    ) {
      setSaveStatus("saving");
      setErrorMessage("Waiting for the latest change from another tab…");
      return false;
    }
    pendingSceneRef.current = null;
    pendingSinceRef.current = null;
    setSaveStatus("saving");
    const savePromise = (async () => {
      // Which store owns this Board is decided inside the exclusive section, so
      // a migration that just finished in this tab is never raced by a save
      // that still believes the legacy document is authoritative.
      const runSave = async (): Promise<CloudBoardSaveOutcome> => {
        // A large import/edit must migrate its saved baseline first, never send
        // its body through the legacy Convex-document mutation.
        if (
          !sceneManifestBoardsRef.current.has(pending.boardId) &&
          pending.rawSize > LEGACY_BOARD_SCENE_RAW_BYTES
        ) {
          const baseline = openedSceneRef.current;
          if (
            !baseline ||
            baseline.boardId !== pending.boardId ||
            baseline.version !== versionRef.current
          ) {
            throw new Error(
              "Could not prepare this board for a larger save. Your edits are still here; try again.",
            );
          }
          const migration = await migrateBoardScene(
            {
              boardId: pending.boardId,
              expectedVersion: baseline.version,
              sceneJson: baseline.sceneJson,
            },
            sceneSaveDependencies,
          );
          if (migration.status !== "committed") {
            return migration;
          }
          sceneManifestBoardsRef.current.add(pending.boardId);
        }
        if (sceneManifestBoardsRef.current.has(pending.boardId)) {
          return await saveBoardScene(
            {
              boardId: pending.boardId,
              expectedVersion: versionRef.current,
              sceneJson: pending.sceneJson,
              acceptedDocRefsHash: openedBoard.sceneManifest?.docRefsHash,
            },
            sceneSaveDependencies,
          );
        }
        const saved = await saveBoard({
          boardId: pending.boardId,
          clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
          expectedVersion: versionRef.current,
          sceneJson: pending.sceneJson,
        });
        return saved.status === "saved"
          ? {
              status: "committed",
              version: saved.version,
              updatedAt: saved.updatedAt,
              snapshotCreated: false,
            }
          : saved;
      };
      try {
        const result = await (saveCoordinatorRef.current?.runSaveExclusive(
          pending.boardId,
          runSave,
        ) ?? runSave());
        if (!isCurrentRouteCompletion(pending.route, currentRouteRef.current)) {
          return false;
        }
        if (result.status === "conflict") {
          if (pending.recoveryAttempt === 1) {
            conflictRecoveryRef.current = null;
            blockedConflictRef.current = {
              boardId: pending.boardId,
              route: pending.route,
              sceneJson: pending.sceneJson,
            };
            setSaveStatus("conflict");
            setErrorMessage(
              "This board is still changing in another tab. Your local edit is still on this canvas; wait for the other tab or copy/export it before reloading.",
            );
            return false;
          }
          conflictRecoveryRef.current = {
            boardId: pending.boardId,
            route: pending.route,
            sceneJson: pending.sceneJson,
            requiredVersion: result.version,
          };
          requireObservedVersion(pending.boardId, result.version);
          setSaveStatus("conflict");
          setErrorMessage(
            "This board changed in another tab. Your local edit is preserved while the latest version is reconciled.",
          );
          return false;
        }
        if (result.status === "upgrade-required") {
          setSaveStatus("error");
          setErrorMessage(
            "This tab is outdated and cannot save safely. Reload the page before editing.",
          );
          return false;
        }
        // A binding echo: the stored scene already means exactly this, so it is
        // adopted as the baseline without a version, an upload, a peer
        // announcement or a preview. Nothing is owed, so the journal is spent.
        if (result.status === "unchanged") {
          clearJournalEntry(pending.boardId);
          const queuedDuringEcho = pendingSceneRef.current;
          if (queuedDuringEcho?.boardId === pending.boardId) {
            scheduleJournalWrite({
              boardId: queuedDuringEcho.boardId,
              sceneJson: queuedDuringEcho.sceneJson,
              baseVersion: versionRef.current,
            });
          }
          conflictRecoveryRef.current = null;
          blockedConflictRef.current = null;
          acceptedSceneRef.current = acceptCloudSceneWithoutSave(
            pending.sceneJson,
          );
          settleSaveStatus();
          return true;
        }
        // The committed scene is durable, so the journaled copy of it is spent.
        // An edit that arrived while this save was in flight is not: it is
        // rejournaled against the version the commit just established.
        versionRef.current = result.version;
        clearJournalEntry(pending.boardId);
        const queuedDuringSave = pendingSceneRef.current;
        if (queuedDuringSave?.boardId === pending.boardId) {
          scheduleJournalWrite({
            boardId: queuedDuringSave.boardId,
            sceneJson: queuedDuringSave.sceneJson,
            baseVersion: result.version,
          });
        }
        conflictRecoveryRef.current = null;
        blockedConflictRef.current = null;
        acceptedSceneRef.current = acceptCloudSceneWithoutSave(
          pending.sceneJson,
        );
        // This tab already holds the scene it just wrote, so adopting it here
        // keeps the metadata subscription from triggering a scene re-fetch.
        acceptOpenedScene({
          boardId: pending.boardId,
          sceneJson: pending.sceneJson,
          version: result.version,
        });
        saveCoordinatorRef.current?.announceSaveComplete({
          boardId: pending.boardId,
          generation: pending.route.generation,
          version: result.version,
        });
        settleSaveStatus();
        if (pending.previewScene) {
          scheduleBoardPreview({
            boardId: pending.boardId,
            route: pending.route,
            sourceVersion: result.version,
            scene: pending.previewScene,
          });
        }
        return true;
      } catch (cause) {
        if (!isCurrentRouteCompletion(pending.route, currentRouteRef.current)) {
          return false;
        }
        const sizeError = getBoardSceneSizeError(cause);
        if (sizeError) {
          pendingSceneRef.current ??= pending;
          blockedSizeRef.current = {
            sceneJson: pending.sceneJson,
            error: sizeError,
          };
          if (blockOversizedSave(pendingSceneRef.current)) {
            return false;
          }
        } else if (pending.recoveryAttempt === 1) {
          conflictRecoveryRef.current = null;
          blockedConflictRef.current = {
            boardId: pending.boardId,
            route: pending.route,
            sceneJson: pending.sceneJson,
          };
        } else {
          pendingSceneRef.current ??= pending;
        }
        setSaveStatus("error");
        setErrorMessage(
          cause instanceof Error ? cause.message : "Cloud save failed",
        );
        return false;
      }
    })();
    saveInFlightRef.current = savePromise;
    saveInFlightBoardIdRef.current = pending.boardId;
    try {
      return await savePromise;
    } finally {
      if (saveInFlightRef.current === savePromise) {
        saveInFlightRef.current = null;
        saveInFlightBoardIdRef.current = null;
      }
    }
  }, [
    acceptOpenedScene,
    blockOversizedSave,
    clearJournalEntry,
    openedBoard,
    requireObservedVersion,
    saveBoard,
    sceneSaveDependencies,
    scheduleBoardPreview,
    scheduleJournalWrite,
    settleSaveStatus,
  ]);

  flushSaveRef.current = flushSave;

  const queueSave = useCallback(
    (
      sceneJson: string,
      previewScene?: BoardPreviewScene,
      origin: CloudSceneSaveOrigin = "local",
    ) => {
      if (!openedBoard || openedBoard.access !== "owner") {
        return;
      }
      const persistedSceneJson = sanitizeCloudPresentationScene(sceneJson);
      const rawSize = getBoardSceneRawSize(persistedSceneJson);
      setSceneRawSize(rawSize);
      if (blockedSizeRef.current?.sceneJson !== persistedSceneJson) {
        blockedSizeRef.current = null;
        setSceneSizeError(null);
      }
      // Only a Board this tab owns is journaled: a shared route is read-only
      // here and has no pending scene of its own to recover.
      const journalsThisRoute = route.kind === "owner";
      const recovery = conflictRecoveryRef.current;
      const blockedConflict = blockedConflictRef.current;
      const matchesCurrentBoard = (candidate: {
        boardId: Id<"diagrams">;
        route: CloudRouteGeneration;
      }) =>
        candidate.boardId === openedBoard.board._id &&
        isCurrentRouteCompletion(candidate.route, currentRouteRef.current);
      if (
        origin === "server-merge" &&
        blockedConflict &&
        matchesCurrentBoard(blockedConflict)
      ) {
        setSaveStatus("conflict");
        setErrorMessage(
          "This board is still changing in another tab. Your local edit is still on this canvas; wait for the other tab or copy/export it before reloading.",
        );
        return;
      }
      if (
        !shouldQueueCloudSceneSave(
          acceptedSceneRef.current,
          persistedSceneJson,
          origin,
        )
      ) {
        if (origin === "server-echo") {
          acceptedSceneRef.current =
            acceptCloudSceneWithoutSave(persistedSceneJson);
          conflictRecoveryRef.current = null;
          blockedConflictRef.current = null;
        }
        pendingSceneRef.current = null;
        pendingSinceRef.current = null;
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        if (journalsThisRoute) {
          clearJournalEntry(openedBoard.board._id);
        }
        setSaveStatus("saved");
        setSceneSizeError(null);
        setErrorMessage(null);
        return;
      }
      pendingSceneRef.current = {
        boardId: openedBoard.board._id,
        route: { ...currentRouteRef.current },
        sceneJson: persistedSceneJson,
        rawSize,
        previewScene,
        recoveryAttempt:
          origin === "server-merge" &&
          recovery &&
          matchesCurrentBoard(recovery) &&
          versionRef.current >= recovery.requiredVersion
            ? 1
            : 0,
      };
      if (journalsThisRoute) {
        scheduleJournalWrite({
          boardId: openedBoard.board._id,
          sceneJson: persistedSceneJson,
          baseVersion: versionRef.current,
        });
      }
      if (blockOversizedSave(pendingSceneRef.current)) {
        return;
      }
      if (origin === "local") {
        if (recovery && matchesCurrentBoard(recovery)) {
          recovery.sceneJson = persistedSceneJson;
        } else {
          conflictRecoveryRef.current = null;
        }
        blockedConflictRef.current = null;
        saveCoordinatorRef.current?.claimWriter({
          boardId: openedBoard.board._id,
          generation: currentRouteRef.current.generation,
          version: versionRef.current,
        });
      }
      const now = Date.now();
      const pendingSince = (pendingSinceRef.current ??= now);
      setSaveStatus("saving");
      setErrorMessage(null);
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      const isRecoveryRetry = pendingSceneRef.current.recoveryAttempt === 1;
      if (isRecoveryRetry) {
        conflictRecoveryRef.current = null;
      }
      saveTimerRef.current = window.setTimeout(
        () => {
          saveTimerRef.current = null;
          void flushSave();
        },
        isRecoveryRetry ? 0 : getCloudSaveDelay(now, pendingSince),
      );
    },
    [
      blockOversizedSave,
      clearJournalEntry,
      flushSave,
      openedBoard,
      route.kind,
      scheduleJournalWrite,
    ],
  );

  // Dropping the pending save does not make the scene it held saved, so the
  // journal is written out rather than cleared: every caller either leaves the
  // Board (the edit stays recoverable) or immediately re-queues a scene that
  // supersedes it.
  const discardPendingSave = useCallback(() => {
    flushJournalWrite();
    pendingSceneRef.current = null;
    pendingSinceRef.current = null;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [flushJournalWrite]);

  // A journaled scene re-enters through queueSave, exactly like a local edit,
  // so echo suppression, writer coordination and conflict handling apply to it
  // unchanged. A draft too large to upload must be restored locally so the
  // user can reduce or export it without first needing a successful save.
  const restoreJournaledScene = useCallback(
    (restoreOversizedDraft?: (sceneJson: string) => void) => {
      if (route.kind !== "owner" || openedBoard?.access !== "owner") {
        return;
      }
      const boardId = openedBoard.board._id;
      const serverVersion = openedBoard.version;
      const startedRoute = { ...currentRouteRef.current };
      void getCrashJournal()
        .claim({
          boardId,
          serverVersion,
          runExclusive: (task) =>
            saveCoordinatorRef.current?.runSaveExclusive(boardId, task) ??
            task(),
        })
        .then((entry) => {
          if (!entry) {
            return;
          }
          // Claiming took the entry out of the journal to keep a second tab from
          // replaying it too. A tab that then declines to replay it is holding
          // the only copy of an unsaved edit, so it hands the entry back instead
          // of spending it: the next open reclassifies it against the version
          // that is current by then.
          if (
            !isCurrentRouteCompletion(startedRoute, currentRouteRef.current) ||
            versionRef.current !== serverVersion
          ) {
            void getCrashJournal().write(entry);
            return;
          }
          queueSave(entry.sceneJson);
          if (
            getBoardSceneRawSize(
              sanitizeCloudPresentationScene(entry.sceneJson),
            ) > MAX_BOARD_SCENE_RAW_BYTES
          ) {
            restoreOversizedDraft?.(entry.sceneJson);
            flushJournalWrite();
            return;
          }
          // Recovered work waits on a round trip to become visible again, so it
          // skips the editing debounce instead of risking a second teardown.
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
          void flushSaveRef.current();
        })
        .catch(() => undefined);
    },
    [flushJournalWrite, getCrashJournal, openedBoard, queueSave, route.kind],
  );

  const acceptSceneWithoutSave = useCallback(
    (
      sceneJson: string,
      restoreOversizedDraft?: (sceneJson: string) => void,
    ) => {
      discardPendingSave();
      acceptedSceneRef.current = acceptCloudSceneWithoutSave(
        sanitizeCloudPresentationScene(sceneJson),
      );
      setSceneRawSize(
        getBoardSceneRawSize(sanitizeCloudPresentationScene(sceneJson)),
      );
      setSceneSizeError(null);
      blockedSizeRef.current = null;
      setSaveStatus(openedBoard?.access === "viewer" ? "viewer" : "saved");
      restoreJournaledScene(restoreOversizedDraft);
    },
    [discardPendingSave, openedBoard?.access, restoreJournaledScene],
  );

  useEffect(
    () => () => {
      flushJournalWrite();
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
      }
      for (const timer of requiredVersionTimerByBoardRef.current.values()) {
        window.clearTimeout(timer);
      }
      requiredVersionTimerByBoardRef.current.clear();
      requiredVersionByBoardRef.current.clear();
      previewRequestRef.current += 1;
    },
    [flushJournalWrite],
  );

  const enableSharing = useCallback(async () => {
    if (!openedBoard || openedBoard.access !== "owner") {
      return null;
    }
    const result = await setSharing({
      boardId: openedBoard.board._id,
      enabled: true,
    });
    if (!result.shareToken) {
      return null;
    }
    return `${window.location.origin}/s/${result.shareToken}`;
  }, [openedBoard, setSharing]);

  const resolvePresentationAnimation = useCallback(
    async (reference: { assetId: string; version: number }) => {
      if (!openedBoard) {
        throw new Error("Open a cloud board to load this animation");
      }
      const grant = await createPresentationAnimationReadGrant(
        route.kind === "owner" && openedBoard.access === "owner"
          ? {
              diagramId: openedBoard.board._id,
              assetId: reference.assetId,
              version: reference.version,
            }
          : route.kind === "shared" && openedBoard.access === "viewer"
          ? {
              shareToken: route.shareToken,
              assetId: reference.assetId,
              version: reference.version,
            }
          : (() => {
              throw new Error("This board cannot authorize animations");
            })(),
      );
      return { url: grant.path, expiresAt: grant.expiresAt };
    },
    [createPresentationAnimationReadGrant, openedBoard, route],
  );

  const publishPresentationAnimation = useCallback(
    async (input: {
      assetId: string;
      version: number;
      sourceElementId: string;
      slideId: string;
      html: string;
      previewFileId?: string;
      replacementForVersion?: number;
    }) => {
      if (!openedBoard || openedBoard.access !== "owner") {
        throw new Error("Only the board owner can publish animations");
      }
      return await publishTrustedPresentationAnimation(
        { ...input, diagramId: openedBoard.board._id },
        {
          createUploadGrant: async (manifest) =>
            await createPresentationAnimationUploadGrant({
              ...manifest,
              diagramId: manifest.diagramId as Id<"diagrams">,
            }),
          upload: uploadPresentationAnimationBlob,
          registerUpload: registerPresentationAnimationUpload,
          abandonUpload: abandonPresentationAnimationUpload,
          cleanup: cleanupPresentationAnimationObjects,
        },
      );
    },
    [
      abandonPresentationAnimationUpload,
      createPresentationAnimationUploadGrant,
      openedBoard,
      registerPresentationAnimationUpload,
    ],
  );

  const openBoard = useCallback(
    async (slug: string) => {
      if (route.kind === "owner" && route.slug === slug) {
        return;
      }
      const navigationRequest = ++navigationRequestRef.current;
      const didSave = await flushSave();
      if (!didSave || navigationRequest !== navigationRequestRef.current) {
        return;
      }
      setSaveStatus("loading");
      setErrorMessage(null);
      window.history.pushState({}, "", getCanonicalOwnerPath(slug));
      setRoute({ kind: "owner", slug, isLegacyPath: false });
    },
    [flushSave, route],
  );

  const createNewBoard = useCallback(async () => {
    const navigationRequest = ++navigationRequestRef.current;
    const didSave = await flushSave();
    if (!didSave) {
      return;
    }
    const result = await createBoard({ title: "Untitled board" });
    if (navigationRequest !== navigationRequestRef.current) {
      return;
    }
    setSaveStatus("loading");
    setErrorMessage(null);
    window.history.pushState({}, "", getCanonicalOwnerPath(result.slug));
    setRoute({
      kind: "owner",
      slug: result.slug,
      isLegacyPath: false,
    });
  }, [createBoard, flushSave]);

  const deleteBoard = useCallback(
    async (slug: string) => {
      const startedRoute = { ...currentRouteRef.current };
      const board = boards?.find((candidate) => candidate.slug === slug);
      if (!board) {
        return;
      }
      const isActive = route.kind === "owner" && route.slug === slug;
      if (isActive) {
        const didSave = await flushSave();
        if (!didSave) {
          return;
        }
      }
      const fallback = boards?.find((candidate) => candidate.slug !== slug);
      await deleteBoardAndCleanup({
        boardId: board._id,
        destination: fallback
          ? { kind: "owner", slug: fallback.slug }
          : { kind: "home" },
        isActive,
        startedRoute,
        getCurrentRoute: () => currentRouteRef.current,
        removeBoard,
        navigate: (destination) => {
          if (destination.kind === "owner") {
            window.history.replaceState(
              {},
              "",
              getCanonicalOwnerPath(destination.slug),
            );
            setRoute({
              kind: "owner",
              slug: destination.slug,
              isLegacyPath: false,
            });
          } else {
            window.history.replaceState({}, "", "/");
            setRoute({ kind: "home" });
          }
          setSaveStatus("loading");
          setErrorMessage(null);
        },
        cleanupAssets: async (assetDeleteToken) => {
          const response = await fetch("/api/assets", {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${assetDeleteToken}`,
            },
          });
          if (!response.ok) {
            throw new Error("Image cleanup failed");
          }
        },
        cleanupScenes: cleanupBoardSceneObjects,
        onCleanupError: () =>
          setErrorMessage(
            "The board was deleted, but some stored data could not be cleaned up.",
          ),
      });
    },
    [boards, flushSave, removeBoard, route],
  );

  const renameOpenedBoard = useCallback(
    async (title: string) => {
      if (!openedBoard || openedBoard.access !== "owner") {
        return;
      }
      await renameBoard({
        boardId: openedBoard.board._id,
        title,
      });
    },
    [openedBoard, renameBoard],
  );

  const setBoardSort = useCallback((sort: BoardSort) => {
    window.localStorage.setItem(BOARD_SORT_STORAGE_KEY, sort);
    setBoardSortState(sort);
  }, []);

  const createFolder = useCallback(
    async (name: string) => {
      await createFolderMutation({ name });
    },
    [createFolderMutation],
  );

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      await renameFolderMutation({
        folderId: folderId as Id<"boardFolders">,
        name,
      });
    },
    [renameFolderMutation],
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      await removeFolderMutation({
        folderId: folderId as Id<"boardFolders">,
      });
    },
    [removeFolderMutation],
  );

  const moveBoardToFolder = useCallback(
    async (boardId: string, folderId: string | null) => {
      await moveToFolder({
        boardId: boardId as Id<"diagrams">,
        folderId: folderId as Id<"boardFolders"> | null,
      });
    },
    [moveToFolder],
  );

  const queueAssets = useCallback(
    (files: BinaryFiles) => {
      if (!openedBoard || openedBoard.access !== "owner") {
        return;
      }
      for (const file of Object.values(files)) {
        const startedRoute = { ...currentRouteRef.current };
        const boardId = openedBoard.board._id;
        const uploadedFileIds = uploadedFileIdsRef.current;
        const uploadingFileIds = uploadingFileIdsRef.current;
        if (uploadedFileIds.has(file.id) || uploadingFileIds.has(file.id)) {
          continue;
        }
        uploadingFileIds.add(file.id);
        void (async () => {
          try {
            const response = await fetch(file.dataURL);
            const blob = await response.blob();
            const { token } = await createAssetUploadGrant({
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
            if (!uploadResponse.ok) {
              const body = (await uploadResponse.json()) as {
                error?: string;
              };
              throw new Error(body.error || "Image upload failed");
            }
            const body = (await uploadResponse.json()) as { etag: string };
            await registerAssetUpload({ token, etag: body.etag });
            uploadedFileIds.add(file.id);
          } catch (cause) {
            if (
              isCurrentRouteCompletion(startedRoute, currentRouteRef.current)
            ) {
              setSaveStatus("error");
              setErrorMessage(
                cause instanceof Error ? cause.message : "Image upload failed",
              );
            }
          } finally {
            uploadingFileIds.delete(file.id);
          }
        })();
      }
    },
    [createAssetUploadGrant, openedBoard, registerAssetUpload],
  );

  const cloneSharedBoard = useCallback(
    async (source: Omit<BoardCloneSource, "title">) => {
      const title = requireSharedBoardTitle(openedBoard);
      return await cloneBoardIntoOwnAccount(
        { ...source, title },
        {
          createBoard,
          removeBoard,
          uploadAsset: async ({ boardId, file }) =>
            await uploadClonedBoardAsset(
              { boardId, file },
              {
                createUploadGrant: createAssetUploadGrant,
                registerUpload: registerAssetUpload,
              },
            ),
          sceneSave: sceneSaveDependencies,
          navigate: ({ slug }) => {
            setSaveStatus("loading");
            setErrorMessage(null);
            window.history.pushState({}, "", getCanonicalOwnerPath(slug));
            setRoute({ kind: "owner", slug, isLegacyPath: false });
          },
        },
      );
    },
    [
      createAssetUploadGrant,
      createBoard,
      openedBoard,
      registerAssetUpload,
      removeBoard,
      sceneSaveDependencies,
    ],
  );

  return useMemo(
    () => ({
      route,
      openedBoard,
      saveStatus,
      errorMessage,
      sceneRawSize,
      sceneSizeError,
      isLocalBackupUnavailable:
        journalDegraded &&
        (pendingSceneRef.current !== null || saveInFlightRef.current !== null),
      queueSave,
      discardPendingSave,
      acceptSceneWithoutSave,
      flushSave,
      enableSharing,
      resolvePresentationAnimation,
      publishPresentationAnimation,
      boards,
      isBoardListLoading:
        paginatedBoards.status === "pending" && boards.length === 0,
      isBoardListLoadingMore:
        paginatedBoards.status === "pending" && boards.length > 0,
      boardListError:
        paginatedBoards.status === "error"
          ? paginatedBoards.error.message
          : null,
      canLoadMoreBoards: paginatedBoards.canLoadMore,
      loadMoreBoards: () => paginatedBoards.loadMore(40),
      boardSearch,
      setBoardSearch,
      boardSort,
      setBoardSort,
      folders: folders ?? [],
      isFolderListLoading: folders === undefined,
      createFolder,
      renameFolder,
      deleteFolder,
      moveBoardToFolder,
      openBoard,
      createNewBoard,
      deleteBoard,
      renameOpenedBoard,
      assets: assets ?? [],
      boardDocManifest,
      isBoardDocManifestLoading:
        openedBoardMetadata !== undefined &&
        (boardDocManifestPage === undefined || isBoardDocManifestPaging),
      queueAssets,
      isViewer: openedBoard?.access === "viewer",
      isReady: openedBoard !== undefined && openedBoard !== null,
      canCopySharedBoard: shouldOfferBoardCopy({
        routeKind: route.kind,
        isViewer: openedBoard?.access === "viewer",
        account,
      }),
      cloneSharedBoard,
    }),
    [
      account,
      cloneSharedBoard,
      enableSharing,
      resolvePresentationAnimation,
      publishPresentationAnimation,
      boards,
      paginatedBoards,
      boardSearch,
      boardSort,
      setBoardSort,
      folders,
      createFolder,
      renameFolder,
      deleteFolder,
      moveBoardToFolder,
      errorMessage,
      sceneRawSize,
      sceneSizeError,
      journalDegraded,
      flushSave,
      assets,
      boardDocManifest,
      boardDocManifestPage,
      isBoardDocManifestPaging,
      openedBoardMetadata,
      createNewBoard,
      deleteBoard,
      openedBoard,
      openBoard,
      queueAssets,
      queueSave,
      discardPendingSave,
      acceptSceneWithoutSave,
      renameOpenedBoard,
      route,
      saveStatus,
    ],
  );
};
