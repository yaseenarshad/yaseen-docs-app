import {
  useMutation,
  usePaginatedQuery_experimental,
  useQuery,
} from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import { api } from "../../convex/_generated/api";

import {
  getCanonicalOwnerPath,
  getLegacyOwnerReplacement,
  parseCloudRoute,
} from "./cloudRoutes";
import { deleteBoardAndCleanup } from "./boardDeletion";
import {
  getCloudRouteIdentity,
  isCurrentRouteCompletion,
} from "./cloudRouteLifecycle";
import {
  acceptCloudSceneWithoutSave,
  shouldQueueCloudSceneSave,
} from "./cloudSaveBaseline";
import { createBrowserCloudTabSaveCoordinator } from "./cloudTabCoordination";
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
import type { BoardSort } from "./boardOrganizer";
import type { CloudRouteGeneration } from "./cloudRouteLifecycle";
import type { CloudRoute } from "./cloudRoutes";
import type {
  BoardPreviewImage,
  BoardPreviewScene,
} from "./boardPreviewGeneration";
import type { CloudSceneSaveOrigin } from "./cloudSaveBaseline";
import type { CloudTabSaveCoordinator } from "./cloudTabCoordination";

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

const getRoute = () => parseCloudRoute(window.location.pathname);

// A trailing debounce alone lets an uninterrupted drawing session keep local
// edits unsaved forever, so cap how long the oldest pending change may wait.
export const getCloudSaveDelay = (now: number, pendingSince: number) =>
  Math.max(
    0,
    Math.min(CLOUD_SAVE_DEBOUNCE_MS, pendingSince + CLOUD_SAVE_MAX_PENDING_MS - now),
  );

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

  const ownedBoard = useQuery(
    api.boards.openMine,
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
  const sharedBoard = useQuery(
    api.boards.openShared,
    route.kind === "shared" ? { shareToken: route.shareToken } : "skip",
  );
  const currentOwnedBoard =
    route.kind === "owner" && ownedBoard && ownedBoard.board.slug !== route.slug
      ? undefined
      : ownedBoard;
  const openedBoard =
    route.kind === "owner"
      ? currentOwnedBoard
      : route.kind === "shared"
      ? sharedBoard
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

  useEffect(() => {
    versionRef.current = 0;
    observedVersionRef.current = 0;
    pendingSceneRef.current = null;
    pendingSinceRef.current = null;
    conflictRecoveryRef.current = null;
    blockedConflictRef.current = null;
    requiredVersionByBoardRef.current.clear();
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
  }, [routeIdentity]);

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
  }, []);

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
      if (!hasActiveConflict) {
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
      try {
        const result = await (saveCoordinatorRef.current?.runSaveExclusive(
          pending.boardId,
          async () =>
            await saveBoard({
              boardId: pending.boardId,
              clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
              expectedVersion: versionRef.current,
              sceneJson: pending.sceneJson,
            }),
        ) ??
          saveBoard({
            boardId: pending.boardId,
            clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
            expectedVersion: versionRef.current,
            sceneJson: pending.sceneJson,
          }));
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
        versionRef.current = result.version;
        conflictRecoveryRef.current = null;
        blockedConflictRef.current = null;
        acceptedSceneRef.current = acceptCloudSceneWithoutSave(
          pending.sceneJson,
        );
        saveCoordinatorRef.current?.announceSaveComplete({
          boardId: pending.boardId,
          generation: pending.route.generation,
          version: result.version,
        });
        setSaveStatus("saved");
        setErrorMessage(null);
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
        if (pending.recoveryAttempt === 1) {
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
  }, [openedBoard, requireObservedVersion, saveBoard, scheduleBoardPreview]);

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
        setSaveStatus("saved");
        return;
      }
      pendingSceneRef.current = {
        boardId: openedBoard.board._id,
        route: { ...currentRouteRef.current },
        sceneJson: persistedSceneJson,
        previewScene,
        recoveryAttempt:
          origin === "server-merge" &&
          recovery &&
          matchesCurrentBoard(recovery) &&
          versionRef.current >= recovery.requiredVersion
            ? 1
            : 0,
      };
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
    [flushSave, openedBoard],
  );

  const discardPendingSave = useCallback(() => {
    pendingSceneRef.current = null;
    pendingSinceRef.current = null;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const acceptSceneWithoutSave = useCallback(
    (sceneJson: string) => {
      discardPendingSave();
      acceptedSceneRef.current = acceptCloudSceneWithoutSave(
        sanitizeCloudPresentationScene(sceneJson),
      );
      setSaveStatus(openedBoard?.access === "viewer" ? "viewer" : "saved");
    },
    [discardPendingSave, openedBoard?.access],
  );

  useEffect(
    () => () => {
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
    [],
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
        onCleanupError: () =>
          setErrorMessage(
            "The board was deleted, but some stored images could not be cleaned up.",
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

  return useMemo(
    () => ({
      route,
      openedBoard,
      saveStatus,
      errorMessage,
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
      queueAssets,
      isViewer: openedBoard?.access === "viewer",
      isReady: openedBoard !== undefined && openedBoard !== null,
    }),
    [
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
      flushSave,
      assets,
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
