import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  useEditorInterface,
  ExcalidrawAPIProvider,
  useExcalidrawAPI,
  getDataURL,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import Trans from "@excalidraw/excalidraw/components/Trans";
import {
  APP_NAME,
  EVENT,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import { t } from "@excalidraw/excalidraw/i18n";

import {
  GithubIcon,
  XBrandIcon,
  DiscordIcon,
  ExcalLogo,
  usersIcon,
  exportToPlus,
  share,
  youtubeIcon,
} from "@excalidraw/excalidraw/components/icons";
import { isElementLink } from "@excalidraw/element";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";
import type {
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";
import type { ResolvablePromise } from "@excalidraw/common/utils";

import { api } from "../convex/_generated/api";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useAtomWithInitialValue,
  appJotaiStore,
} from "./app-jotai";
import {
  FIREBASE_STORAGE_PREFIXES,
  isExcalidrawPlusSignedUser,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMenuItems } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import {
  ExportToExcalidrawPlus,
  exportToExcalidrawPlus,
} from "./components/ExportToExcalidrawPlus";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import { updateStaleImageStatuses } from "./data/FileManager";
import { backgroundRemovalClient } from "./background-removal/client";
import { removeImageBackgroundAndReplace } from "./background-removal/apply";
import { FileStatusStore } from "./data/fileStatusStore";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
  saveWritingPreferencesToLocalStorage,
} from "./data/localStorage";

import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import { CloudCopyAction, CloudStatus } from "./cloud/CloudStatus";
import { CloudAccount } from "./cloud/CloudAccount";
import { CloudShareDialog } from "./cloud/CloudShareDialog";
import { getCloudDocumentTitle } from "./cloud/cloudDocumentTitle";
import {
  classifyAppliedCloudSceneChange,
  getCloudSceneSemanticRevision,
  hasUnpersistedCloudElements,
  isSameCloudRoute,
  resolveCloudViewport,
  shouldApplyCloudScene,
} from "./cloud/cloudSceneSync";
import {
  cloudRouteOwnsScene,
  selectInitialLocalElements,
  shouldRunLocalSceneSync,
} from "./cloud/cloudSceneOwnership";
import { useCloudBoard } from "./cloud/useCloudBoard";
import { sanitizeCloudPresentationScene } from "./cloud/presentationScenePersistence";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { AIComponents } from "./components/AI";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";

import "./index.scss";

import { AppSidebar, AppSidebarLaunchers } from "./components/AppSidebar";

import { BoardDocEmbeddable } from "./docs/BoardDocEmbeddable";
import { BoardDocContentStore } from "./docs/docContentStore";
import { DocAutosaveScheduler } from "./docs/docAutosaveScheduler";
import { saveDocContent } from "./docs/docContentClient";
import { createBrowserDocCrashJournal } from "./docs/docCrashJournal";
import { createBrowserDocWriterCoordinator } from "./docs/docWriterCoordinator";
import { DOCS_ENABLED, DOCS_WRITABLE } from "./docs/docsMode";
import {
  DocAssetResolver,
  cleanupDocAsset,
  uploadDocAsset,
} from "./docs/docAssetClient";
import {
  getDocEmbeddableLink,
  getDocPlacementReference,
  isDocEmbeddableLink,
} from "./docs/docEmbeddableData";
import {
  DOC_CANVAS_DRAG_TYPE,
  activateOrInsertDocPlacement,
  decodeDocCanvasDragPayload,
  getDocDropScenePoint,
  hasDocCanvasDragType,
  insertDocPlacementAtPoint,
} from "./docs/docCanvasPlacement";

import type { CollabAPI } from "./collab/Collab";
import type { Id } from "../convex/_generated/dataModel";
import type { DocSaveStatus } from "./docs/docAutosaveScheduler";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
  routeOwnsScene: boolean;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  let scene: Omit<
    RestoredDataState,
    // we're not storing files in the scene database/localStorage, and instead
    // fetch them async from a different store
    "files"
  > & {
    scrollToContent?: boolean;
  } = {
    elements: restoreElements(
      selectInitialLocalElements(localDataState?.elements, opts.routeOwnsScene),
      null,
      {
        repairBindings: true,
        deleteInvisibleElements: true,
      },
    ),
    appState: restoreAppState(localDataState?.appState, null),
  };

  let roomLinkData = opts.routeOwnsScene
    ? null
    : getCollaborationLinkData(window.location.href);
  const isExternalScene =
    !opts.routeOwnsScene && !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        const imported = await importFromBackend(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
        );

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported.elements, null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported.appState,
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
        };
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (!opts.routeOwnsScene && externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const validateAppEmbeddable: NonNullable<
  ExcalidrawProps["validateEmbeddable"]
> = (link) => (DOCS_ENABLED && isDocEmbeddableLink(link) ? true : undefined);

const getAppEmbeddableActivationMode: NonNullable<
  ExcalidrawProps["getEmbeddableActivationMode"]
> = (element) =>
  DOCS_ENABLED && getDocPlacementReference(element) ? "double" : "single";

const ExcalidrawWrapper = () => {
  const excalidrawAPI = useExcalidrawAPI();
  const onImageBackgroundRemoval = useCallback<
    NonNullable<ExcalidrawProps["onImageBackgroundRemoval"]>
  >(
    async (request) => {
      if (!excalidrawAPI) {
        throw new Error("The editor is not ready yet.");
      }
      await removeImageBackgroundAndReplace({
        api: excalidrawAPI,
        request,
        client: backgroundRemovalClient,
      });
    },
    [excalidrawAPI],
  );
  const cloud = useCloudBoard();
  const createBoardDocReadGrants = useMutation(api.boardDocs.createReadGrants);
  const createDocUploadGrant = useMutation(api.docContents.createUploadGrant);
  const commitDocUpload = useMutation(api.docContents.commitUpload);
  const abandonDocUpload = useMutation(api.docContents.abandonUpload);
  const createDoc = useMutation(api.docs.create);
  const restoreDoc = useMutation(api.docs.restore);
  const confirmDocPurge = useMutation(api.docs.confirmPurge);
  const createDocAssetUploadGrant = useMutation(
    api.docAssets.createUploadGrant,
  );
  const registerDocAssetUpload = useMutation(api.docAssets.registerUpload);
  const createDocAssetReadGrant = useMutation(api.docAssets.createReadGrant);
  const pendingDocAssetCleanup = useQuery(
    api.docAssets.pendingCleanup,
    DOCS_WRITABLE &&
      cloud.route.kind === "owner" &&
      cloud.openedBoard?.access === "owner"
      ? {}
      : "skip",
  );
  const pendingDocPurges = useQuery(
    api.docs.pendingPurges,
    DOCS_WRITABLE &&
      cloud.route.kind === "owner" &&
      cloud.openedBoard?.access === "owner"
      ? {}
      : "skip",
  );
  const docContentAccessRef = useRef<{
    boardId: Id<"diagrams"> | null;
    shareToken: string | null;
  } | null>(null);
  docContentAccessRef.current = !DOCS_ENABLED
    ? null
    : cloud.route.kind === "owner" && cloud.openedBoard?.access === "owner"
    ? { boardId: cloud.openedBoard.board._id, shareToken: null }
    : cloud.route.kind === "shared"
    ? { boardId: null, shareToken: cloud.route.shareToken }
    : null;
  const docAssetResolver = useMemo(
    () =>
      new DocAssetResolver(async (assetId) => {
        const access = docContentAccessRef.current;
        if (!access) {
          throw new Error("This Board is not available");
        }
        return await createDocAssetReadGrant({
          assetId,
          boardId: access.boardId,
          shareToken: access.shareToken,
        });
      }),
    [createDocAssetReadGrant],
  );
  const resolveDocAssetPath = useCallback(
    async (path: string) => await docAssetResolver.resolve(path),
    [docAssetResolver],
  );
  const uploadDocFiles = useCallback(
    async (docId: string, files: readonly File[], signal: AbortSignal) =>
      await Promise.all(
        files.map(
          async (file) =>
            (
              await uploadDocAsset({
                docId,
                file,
                signal,
                createGrant: async (args) =>
                  await createDocAssetUploadGrant({
                    ...args,
                    docId: args.docId as Id<"docs">,
                  }),
                register: registerDocAssetUpload,
              })
            ).markdown,
        ),
      ),
    [createDocAssetUploadGrant, registerDocAssetUpload],
  );
  useEffect(() => {
    for (const token of pendingDocAssetCleanup ?? []) {
      void cleanupDocAsset(token).catch((error) =>
        console.warn("Could not clean up an expired Doc attachment", error),
      );
    }
  }, [pendingDocAssetCleanup]);
  useEffect(() => {
    for (const purge of pendingDocPurges ?? []) {
      void fetch("/api/doc-content", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${purge.cleanupToken}` },
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error("Doc storage cleanup failed");
          }
          await confirmDocPurge(purge);
        })
        .catch((error) =>
          console.warn("Could not finish a pending Doc purge", error),
        );
    }
  }, [confirmDocPurge, pendingDocPurges]);
  const docContentStore = useMemo(
    () =>
      new BoardDocContentStore({
        createReadGrants: async (docIds) => {
          const access = docContentAccessRef.current;
          if (!access) {
            throw new Error("This Board is not available");
          }
          const response = await createBoardDocReadGrants({
            ...access,
            docIds: docIds as Id<"docs">[],
          });
          return {
            results: response.results.map((result) => ({
              ...result,
              docId: String(result.docId),
            })),
          };
        },
      }),
    [createBoardDocReadGrants],
  );
  const [docSaveStatuses, setDocSaveStatuses] = useState<
    Record<string, DocSaveStatus>
  >({});
  const [docConflicts, setDocConflicts] = useState<
    Record<string, { markdown: string; version: number }>
  >({});
  const docCrashJournal = useMemo(() => createBrowserDocCrashJournal(), []);
  const docAutosaveRef = useRef<DocAutosaveScheduler | null>(null);
  const docWriterCoordinator = useMemo(
    () =>
      createBrowserDocWriterCoordinator(async (docId) => {
        await docAutosaveRef.current?.flush(docId);
        return docContentStore.getSnapshot(docId).version;
      }),
    [docContentStore],
  );
  const docAutosave = useMemo(
    () =>
      new DocAutosaveScheduler({
        save: async ({ docId, markdown, expectedVersion }) =>
          await saveDocContent({
            docId,
            markdown,
            expectedVersion,
            createUploadGrant: (args) =>
              createDocUploadGrant({
                ...args,
                docId: args.docId as Id<"docs">,
              }),
            commitUpload: commitDocUpload,
            abandonUpload: abandonDocUpload,
          }),
        onStatus: (docId, status) =>
          setDocSaveStatuses((current) => ({ ...current, [docId]: status })),
        onSaved: ({ docId, markdown, version, hash }) =>
          docContentStore.acceptSaved(docId, markdown, version, hash),
        onConflict: ({ docId, markdown, version }) => {
          setDocConflicts((current) => ({
            ...current,
            [docId]: { markdown, version },
          }));
        },
        journal: docCrashJournal,
        runExclusive: docWriterCoordinator.runSaveExclusive,
      }),
    [
      abandonDocUpload,
      commitDocUpload,
      createDocUploadGrant,
      docContentStore,
      docCrashJournal,
      docWriterCoordinator,
    ],
  );
  docAutosaveRef.current = docAutosave;
  const loadLatestDoc = useCallback(
    (docId: string) => {
      const conflict = docConflicts[docId];
      docContentStore.invalidate(docId, conflict?.version);
      setDocConflicts((current) => {
        const next = { ...current };
        delete next[docId];
        return next;
      });
      setDocSaveStatuses((current) => ({ ...current, [docId]: "saved" }));
    },
    [docConflicts, docContentStore],
  );
  const saveDocConflictAsNew = useCallback(
    async (docId: string) => {
      const conflict = docConflicts[docId];
      if (!conflict || !excalidrawAPI) {
        return;
      }
      const created = await createDoc({ folderId: null });
      const activeId = excalidrawAPI.getAppState().activeEmbeddable?.element.id;
      const elements = excalidrawAPI.getSceneElements();
      const activeElement = elements.find((element) => element.id === activeId);
      const reference = activeElement
        ? getDocPlacementReference(activeElement)
        : null;
      if (!activeElement || reference?.docId !== docId) {
        throw new Error("The conflicted Doc card is no longer active");
      }
      const replacement = newElementWith(activeElement, {
        link: getDocEmbeddableLink(String(created.docId)),
        customData: {
          ...activeElement.customData,
          yaseenDoc: {
            docId: String(created.docId),
            titleSnapshot: created.title,
          },
        },
      });
      excalidrawAPI.updateScene({
        elements: elements.map((element) =>
          element.id === activeElement.id ? replacement : element,
        ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      docAutosave.queue(String(created.docId), conflict.markdown, 0);
      await docAutosave.flush(String(created.docId));
      setDocConflicts((current) => {
        const next = { ...current };
        delete next[docId];
        return next;
      });
    },
    [createDoc, docAutosave, docConflicts, excalidrawAPI],
  );
  const canManageDocs =
    DOCS_WRITABLE &&
    cloud.route.kind === "owner" &&
    cloud.openedBoard?.access === "owner";
  const activateDoc = useCallback(
    (docId: string, title: string) => {
      if (!excalidrawAPI || !canManageDocs) {
        return;
      }
      activateOrInsertDocPlacement(excalidrawAPI, { docId, title });
    },
    [canManageDocs, excalidrawAPI],
  );
  const boardDocsById = useMemo(
    () =>
      new Map(
        (cloud.boardDocManifest ?? []).map(
          (doc) => [String(doc.docId), doc] as const,
        ),
      ),
    [cloud.boardDocManifest],
  );
  const renderAppEmbeddable = useCallback<
    NonNullable<ExcalidrawProps["renderEmbeddable"]>
  >(
    (element, appState) => {
      if (!DOCS_ENABLED) {
        return null;
      }
      const reference = getDocPlacementReference(element);
      if (!reference) {
        return null;
      }
      const metadata = boardDocsById.get(reference.docId);
      const status = cloud.isBoardDocManifestLoading
        ? "loading"
        : !metadata
        ? "error"
        : metadata.lifecycle !== "active"
        ? "deleted"
        : metadata.version === 0
        ? "empty"
        : "ready";
      const active =
        appState.activeEmbeddable?.element.id === element.id &&
        appState.activeEmbeddable.state === "active";

      return (
        <BoardDocEmbeddable
          store={docContentStore}
          docId={reference.docId}
          boardId={String(cloud.openedBoard?.board._id ?? "unavailable")}
          elementId={element.id}
          docVersion={metadata?.version ?? 0}
          active={active}
          editable={canManageDocs}
          title={metadata?.title ?? reference.titleSnapshot}
          metadataStatus={status}
          autosave={canManageDocs ? docAutosave : undefined}
          journal={canManageDocs ? docCrashJournal : undefined}
          writerCoordinator={canManageDocs ? docWriterCoordinator : undefined}
          saveStatus={docSaveStatuses[reference.docId]}
          onLoadLatest={() => loadLatestDoc(reference.docId)}
          onSaveDraftAsNew={() => void saveDocConflictAsNew(reference.docId)}
          uploadFiles={uploadDocFiles}
          resolveAssetPath={resolveDocAssetPath}
          onRestore={
            canManageDocs && status === "deleted"
              ? () => void restoreDoc({ docId: reference.docId as Id<"docs"> })
              : undefined
          }
          onRemoveCard={
            canManageDocs && status === "deleted"
              ? () => {
                  if (!excalidrawAPI) {
                    return;
                  }
                  excalidrawAPI.updateScene({
                    elements: excalidrawAPI
                      .getSceneElementsIncludingDeleted()
                      .map((candidate) =>
                        candidate.id === element.id
                          ? newElementWith(candidate, { isDeleted: true })
                          : candidate,
                      ),
                    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
                  });
                }
              : undefined
          }
        />
      );
    },
    [
      boardDocsById,
      canManageDocs,
      cloud.isBoardDocManifestLoading,
      cloud.openedBoard?.board._id,
      docContentStore,
      docAutosave,
      docCrashJournal,
      docSaveStatuses,
      docWriterCoordinator,
      excalidrawAPI,
      loadLatestDoc,
      resolveDocAssetPath,
      restoreDoc,
      saveDocConflictAsNew,
      uploadDocFiles,
    ],
  );
  useLayoutEffect(() => {
    document.title = getCloudDocumentTitle(
      cloud.route,
      cloud.openedBoard?.access === "owner"
        ? cloud.openedBoard.board
        : undefined,
    );
  }, [cloud.openedBoard, cloud.route]);
  const routeOwnsScene = cloudRouteOwnsScene(cloud.route);
  const activeCloudRouteKey =
    cloud.route.kind === "owner"
      ? `owner:${cloud.route.slug}`
      : cloud.route.kind === "shared"
      ? `shared:${cloud.route.shareToken}`
      : null;
  useEffect(() => {
    void docAutosave.flush();
    docContentStore.reset();
    return () => {
      void docAutosave.flush();
      docContentStore.reset();
    };
  }, [activeCloudRouteKey, docAutosave, docContentStore]);
  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.hidden) {
        void docAutosave.flush();
      }
    };
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () =>
      document.removeEventListener("visibilitychange", flushWhenHidden);
  }, [docAutosave]);
  useEffect(() => () => docWriterCoordinator.close(), [docWriterCoordinator]);
  useEffect(() => {
    const warnOnUnsafeExit = (event: BeforeUnloadEvent) => {
      if (docAutosave.hasUnsafeExit()) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warnOnUnsafeExit);
    return () => window.removeEventListener("beforeunload", warnOnUnsafeExit);
  }, [docAutosave]);
  useEffect(() => {
    if (cloud.boardDocManifest) {
      docContentStore.updateManifest(
        cloud.boardDocManifest.map((doc) => ({
          docId: String(doc.docId),
          lifecycle: doc.lifecycle,
          version: doc.version,
          ...(doc.contentHash ? { contentHash: doc.contentHash } : {}),
        })),
      );
    }
  }, [cloud.boardDocManifest, docContentStore]);
  const lastWritingPreferencesRef = useRef<AppState | null>(null);
  const loadedCloudSceneRef = useRef<{
    routeKey: string;
    version: number;
  } | null>(null);
  const visibleCloudRouteRef = useRef<string | null>(null);
  const appliedCloudSceneRevisionRef = useRef<string | null>(null);
  const loadingCloudFileIdsRef = useRef(new Set<string>());

  const [errorMessage, setErrorMessage] = useState("");
  const [imageStudioSearchFocusRequest, setImageStudioSearchFocusRequest] =
    useState(0);
  const requestImageStudioSearchFocus = useCallback(() => {
    setImageStudioSearchFocusRequest((request) => request + 1);
  }, []);
  const isCollabDisabled = isRunningInIframe();

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  const [langCode, setLangCode] = useAppLangCode();

  const editorInterface = useEditorInterface();

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);
  const [isCloudShareOpen, setIsCloudShareOpen] = useState(false);
  const [cloudShareUrl, setCloudShareUrl] = useState<string | null>(null);

  useEffect(() => {
    if (routeOwnsScene) {
      LocalData.cancelSave();
      LocalData.pauseSave("cloud");
    } else {
      LocalData.resumeSave("cloud");
    }
    return () => LocalData.resumeSave("cloud");
  }, [routeOwnsScene]);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  useEffect(() => {
    if (
      !excalidrawAPI ||
      !activeCloudRouteKey ||
      visibleCloudRouteRef.current === activeCloudRouteKey
    ) {
      return;
    }
    cloud.discardPendingSave();
    appliedCloudSceneRevisionRef.current = getCloudSceneSemanticRevision(
      serializeAsJSON(
        [],
        {
          ...excalidrawAPI.getAppState(),
          viewModeEnabled: cloud.route.kind === "shared",
        },
        {},
        "database",
      ),
    );
    excalidrawAPI.updateScene({
      elements: [],
      appState: {
        viewModeEnabled: cloud.route.kind === "shared",
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    excalidrawAPI.resetFiles();
    loadingCloudFileIdsRef.current = new Set();
    visibleCloudRouteRef.current = activeCloudRouteKey;
  }, [activeCloudRouteKey, cloud, cloud.route.kind, excalidrawAPI]);

  useEffect(() => {
    if (!excalidrawAPI || !cloud.openedBoard) {
      return;
    }

    const routeKey = activeCloudRouteKey;
    if (!routeKey) {
      return;
    }
    const previous = loadedCloudSceneRef.current;
    const nextAppliedScene = {
      routeKey,
      version: cloud.openedBoard.version,
    };
    if (!shouldApplyCloudScene(previous, nextAppliedScene)) {
      return;
    }

    try {
      const scene = JSON.parse(
        sanitizeCloudPresentationScene(cloud.openedBoard.sceneJson),
      );
      const appState = excalidrawAPI.getAppState();
      const remoteElements = restoreElements(scene.elements, null, {
        repairBindings: true,
        deleteInvisibleElements: true,
      });
      const shouldPreserveViewport = isSameCloudRoute(previous, routeKey);
      const shouldMerge =
        cloud.openedBoard.access === "owner" && shouldPreserveViewport;
      const elements = shouldMerge
        ? reconcileElements(
            excalidrawAPI.getSceneElementsIncludingDeleted(),
            remoteElements as RemoteExcalidrawElement[],
            appState,
          )
        : remoteElements;
      const hasLocalMerge =
        shouldMerge && hasUnpersistedCloudElements(elements, remoteElements);
      const restoredAppState = resolveCloudViewport(
        {
          ...restoreAppState(scene.appState, appState),
          viewModeEnabled: cloud.isViewer,
        },
        appState,
        elements,
        shouldPreserveViewport,
      );
      const appliedSceneJson = serializeAsJSON(
        elements,
        restoredAppState,
        excalidrawAPI.getFiles(),
        "database",
      );

      if (shouldPreserveViewport) {
        cloud.discardPendingSave();
      } else {
        cloud.acceptSceneWithoutSave(appliedSceneJson);
      }
      appliedCloudSceneRevisionRef.current =
        getCloudSceneSemanticRevision(appliedSceneJson);
      loadedCloudSceneRef.current = nextAppliedScene;
      excalidrawAPI.updateScene({
        elements,
        appState: restoredAppState,
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      if (shouldMerge) {
        cloud.queueSave(
          appliedSceneJson,
          undefined,
          hasLocalMerge ? "server-merge" : "server-echo",
        );
      }
    } catch (error) {
      appliedCloudSceneRevisionRef.current = null;
      console.error("Could not restore cloud board", error);
      excalidrawAPI.updateScene({
        appState: {
          errorMessage: "The saved cloud board could not be opened.",
        },
      });
    }
  }, [activeCloudRouteKey, cloud, excalidrawAPI]);

  useEffect(() => {
    const requestedRouteKey = activeCloudRouteKey;
    if (!excalidrawAPI || !requestedRouteKey || cloud.assets.length === 0) {
      return;
    }
    const loadingFileIds = loadingCloudFileIdsRef.current;
    const currentFiles = excalidrawAPI.getFiles();
    const assetsToLoad = cloud.assets.filter(
      (asset) =>
        !currentFiles[asset.fileId as FileId] &&
        !loadingFileIds.has(asset.fileId),
    );
    if (assetsToLoad.length === 0) {
      return;
    }
    for (const asset of assetsToLoad) {
      loadingFileIds.add(asset.fileId);
    }
    void Promise.all(
      assetsToLoad.map(async (asset): Promise<BinaryFileData> => {
        const response = await fetch(asset.url);
        if (!response.ok) {
          throw new Error(`Could not load image (${response.status})`);
        }
        return {
          id: asset.fileId as FileId,
          mimeType: asset.mimeType as BinaryFileData["mimeType"],
          dataURL: await getDataURL(await response.blob()),
          created: asset.createdAt,
          lastRetrieved: Date.now(),
        };
      }),
    )
      .then((files) => {
        if (visibleCloudRouteRef.current === requestedRouteKey) {
          excalidrawAPI.addFiles(files);
        }
      })
      .catch((error) => {
        if (visibleCloudRouteRef.current !== requestedRouteKey) {
          return;
        }
        console.error("Could not load cloud images", error);
        excalidrawAPI.updateScene({
          appState: {
            errorMessage: "One or more cloud images could not be loaded.",
          },
        });
      })
      .finally(() => {
        for (const asset of assetsToLoad) {
          loadingFileIds.delete(asset.fileId);
        }
      });
  }, [activeCloudRouteKey, cloud.assets, excalidrawAPI]);

  // The clone is taken from what this viewer already has on canvas, so legacy
  // and migrated shared Boards travel the same path and the images are known
  // to be in memory. The source Board is only ever read.
  const copySharedBoard = useCallback(async () => {
    if (!excalidrawAPI) {
      return;
    }
    try {
      const { failedAssetFileIds } = await cloud.cloneSharedBoard({
        elements: excalidrawAPI.getSceneElements(),
        appState: excalidrawAPI.getAppState(),
        files: excalidrawAPI.getFiles(),
      });
      if (failedAssetFileIds.length > 0) {
        excalidrawAPI.setToast({
          message: `Copied, but ${failedAssetFileIds.length} image${
            failedAssetFileIds.length === 1 ? "" : "s"
          } could not be copied.`,
          closable: true,
          duration: 8000,
        });
      }
    } catch (error) {
      excalidrawAPI.updateScene({
        appState: {
          errorMessage:
            error instanceof Error
              ? error.message
              : "This board could not be copied.",
        },
      });
    }
  }, [cloud, excalidrawAPI]);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (data: ResolutionType<typeof initializeScene>, isInitialLoad = false) => {
      if (!data.scene || !excalidrawAPI) {
        return;
      }

      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          if (fileIds.length) {
            // Direct Firebase call (not through FileManager), so track manually
            FileStatusStore.updateStatuses(
              fileIds.map((id) => [id, "loading"]),
            );
          }
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
            FileStatusStore.updateStatuses([
              ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
              ...[...erroredFiles.keys()].map(
                (id) => [id, "error"] as [FileId, "error"],
              ),
            ]);
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(async ({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({
            currentFileIds: fileIds,
          });
        }
      }
    },
    [collabAPI, excalidrawAPI],
  );

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    initializeScene({
      collabAPI,
      excalidrawAPI,
      routeOwnsScene,
    }).then(async (data) => {
      if (!routeOwnsScene) {
        loadImages(data, /* isInitialLoad */ true);
      }
      initialStatePromiseRef.current.promise.resolve(data.scene);
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (routeOwnsScene) {
          return;
        }
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({
          collabAPI,
          excalidrawAPI,
          routeOwnsScene,
        }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              elements: restoreElements(data.scene.elements, null, {
                repairBindings: true,
              }),
              appState: restoreAppState(data.scene.appState, null),
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }
        });
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        const localSceneSyncEnabled = shouldRunLocalSceneSync({
          routeOwnsScene,
          documentHidden: document.hidden,
          collaborationActive: Boolean(collabAPI?.isCollaborating()),
        });
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          if (localSceneSyncEnabled) {
            excalidrawAPI.updateScene({
              ...localDataState,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (
          localSceneSyncEnabled &&
          isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)
        ) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      if (!routeOwnsScene) {
        LocalData.flushSave();
      }
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (!routeOwnsScene && (event.type === EVENT.BLUR || document.hidden)) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [
    isCollabDisabled,
    collabAPI,
    excalidrawAPI,
    setLangCode,
    loadImages,
    routeOwnsScene,
  ]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      if (!routeOwnsScene) {
        LocalData.flushSave();
      }

      if (
        excalidrawAPI &&
        !routeOwnsScene &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI, routeOwnsScene]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    // onChange runs only after the editor has restored its initial state.
    const previous = lastWritingPreferencesRef.current;
    if (
      previous?.writingMode !== appState.writingMode ||
      previous?.currentItemWritingStrokeWidth !==
        appState.currentItemWritingStrokeWidth
    ) {
      saveWritingPreferencesToLocalStorage(appState);
      lastWritingPreferencesRef.current = appState;
    }

    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!routeOwnsScene && !LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    const serializedCloudScene =
      cloud.openedBoard?.access === "owner"
        ? serializeAsJSON(elements, appState, files, "database")
        : null;
    // updateScene can report more than once as bindings and files settle.
    // Keep suppressing the applied semantic revision until a real local
    // element, app-state, or file change produces a different revision.
    const appliedCloudChange = serializedCloudScene
      ? classifyAppliedCloudSceneChange(
          appliedCloudSceneRevisionRef.current,
          serializedCloudScene,
        )
      : { suppress: false, nextAppliedRevision: null };
    appliedCloudSceneRevisionRef.current =
      appliedCloudChange.nextAppliedRevision;

    if (
      cloud.openedBoard?.access === "owner" &&
      serializedCloudScene &&
      !appliedCloudChange.suppress
    ) {
      cloud.queueAssets(files);
      cloud.queueSave(serializedCloudScene, {
        elements: [...elements],
        appState: { ...appState },
        files: { ...files },
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<ExcalidrawProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  const ExcalidrawPlusCommand = {
    label: "Excalidraw+",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: ["plus", "cloud", "server"],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_LP
        }/plus?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };
  const ExcalidrawPlusAppCommand = {
    label: "Sign up",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: [
      "excalidraw",
      "plus",
      "cloud",
      "server",
      "signin",
      "login",
      "signup",
    ],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_APP
        }?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };

  return (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
      onDragOverCapture={(event) => {
        if (
          canManageDocs &&
          event.target instanceof HTMLCanvasElement &&
          event.target.classList.contains("interactive") &&
          hasDocCanvasDragType(Array.from(event.dataTransfer.types))
        ) {
          event.preventDefault();
        }
      }}
      onDropCapture={(event) => {
        if (
          !canManageDocs ||
          !excalidrawAPI ||
          !(event.target instanceof HTMLCanvasElement) ||
          !event.target.classList.contains("interactive")
        ) {
          return;
        }
        const payload = decodeDocCanvasDragPayload(
          event.dataTransfer.getData(DOC_CANVAS_DRAG_TYPE),
        );
        if (!payload) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        insertDocPlacementAtPoint(
          excalidrawAPI,
          payload,
          getDocDropScenePoint(event, excalidrawAPI.getAppState()),
        );
      }}
    >
      <Excalidraw
        validateEmbeddable={validateAppEmbeddable}
        renderEmbeddable={renderAppEmbeddable}
        getEmbeddableActivationMode={getAppEmbeddableActivationMode}
        onChange={onChange}
        onImageBackgroundRemoval={onImageBackgroundRemoval}
        onExport={onExport}
        initialData={initialStatePromiseRef.current.promise}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        UIOptions={{
          canvasActions: {
            clearCanvas: false,
            toggleTheme: true,
            export: {
              onExportToBackend,
              renderCustomUI: excalidrawAPI
                ? (elements, appState, files) => {
                    return (
                      <ExportToExcalidrawPlus
                        elements={elements}
                        appState={appState}
                        files={files}
                        name={excalidrawAPI.getName()}
                        onError={(error) => {
                          excalidrawAPI?.updateScene({
                            appState: {
                              errorMessage: error.message,
                            },
                          });
                        }}
                        onSuccess={() => {
                          excalidrawAPI.updateScene({
                            appState: { openDialog: null },
                          });
                        }}
                      />
                    );
                  }
                : undefined,
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        viewModeEnabled={cloud.isViewer}
        // keyed off the route, not `isViewer`, which is false until shared
        // metadata resolves and would flicker the capability off
        viewModeSelectionEnabled={cloud.route.kind === "shared"}
        theme={editorTheme}
        onThemeChange={setAppTheme}
        renderTopLeftUI={() => (
          <AppSidebarLaunchers
            excalidrawAPI={excalidrawAPI}
            canManageDocs={canManageDocs}
            onRequestImageStudioSearch={requestImageStudioSearchFocus}
          />
        )}
        renderTopRightUI={(isMobile) => {
          return (
            <div className="excalidraw-ui-top-right">
              {!isMobile && (
                <CloudStatus
                  title={cloud.openedBoard?.board.title ?? "Cloud board"}
                  status={cloud.saveStatus}
                  errorMessage={cloud.errorMessage}
                  canRename={cloud.openedBoard?.access === "owner"}
                  onRename={cloud.renameOpenedBoard}
                  action={
                    cloud.canCopySharedBoard && excalidrawAPI ? (
                      <CloudCopyAction onCopy={copySharedBoard} />
                    ) : null
                  }
                />
              )}
              {!isMobile && collabAPI && !isCollabDisabled && (
                <>
                  {collabError.message && (
                    <CollabError collabError={collabError} />
                  )}
                  <LiveCollaborationTrigger
                    isCollaborating={isCollaborating}
                    onSelect={() => {
                      if (cloud.openedBoard?.access === "owner") {
                        setIsCloudShareOpen(true);
                      } else {
                        setShareDialogState({ isOpen: true, type: "share" });
                      }
                    }}
                    editorInterface={editorInterface}
                  />
                </>
              )}
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.setViewport({
              target: element.link,
              fit: "scale-down",
              animation: true,
            });
          }
        }}
      >
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={!isCollabDisabled}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
          {excalidrawAPI && (
            <OverwriteConfirmDialog.Action
              title={t("overwriteConfirm.action.excalidrawPlus.title")}
              actionLabel={t("overwriteConfirm.action.excalidrawPlus.button")}
              onClick={() => {
                exportToExcalidrawPlus(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                  excalidrawAPI.getName(),
                );
              }}
            >
              {t("overwriteConfirm.action.excalidrawPlus.description")}
            </OverwriteConfirmDialog.Action>
          )}
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}

        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="alertalert--warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {localStorageQuotaExceeded && (
          <div className="alert alert--danger">
            {t("alerts.localStorageQuotaExceeded")}
          </div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />
        {isCloudShareOpen && (
          <CloudShareDialog
            title={cloud.openedBoard?.board.title ?? "Cloud board"}
            initialUrl={cloudShareUrl}
            onClose={() => setIsCloudShareOpen(false)}
            onCreateLink={async () => {
              const url = await cloud.enableSharing();
              setCloudShareUrl(url);
              return url;
            }}
          />
        )}

        <AppSidebar
          boards={cloud.boards}
          folders={cloud.folders}
          activeSlug={cloud.route.kind === "owner" ? cloud.route.slug : null}
          isLoading={cloud.isBoardListLoading}
          isLoadingMore={cloud.isBoardListLoadingMore}
          isFolderListLoading={cloud.isFolderListLoading}
          canLoadMore={cloud.canLoadMoreBoards}
          errorMessage={cloud.boardListError}
          search={cloud.boardSearch}
          sort={cloud.boardSort}
          onSearchChange={cloud.setBoardSearch}
          onSortChange={cloud.setBoardSort}
          onLoadMore={cloud.loadMoreBoards}
          onCreate={cloud.createNewBoard}
          onCreateFolder={cloud.createFolder}
          onRenameFolder={cloud.renameFolder}
          onDeleteFolder={cloud.deleteFolder}
          onMove={cloud.moveBoardToFolder}
          onDelete={cloud.deleteBoard}
          onOpen={cloud.openBoard}
          excalidrawAPI={excalidrawAPI}
          canInsertMedia={
            cloud.route.kind === "owner" &&
            cloud.openedBoard?.access === "owner"
          }
          // Slide order/names live in the scene, so any board the user can
          // draw on (local or owned) can reorder; only shared view-mode links
          // are read-only.
          canEditSlides={cloud.route.kind !== "shared"}
          canManageDocs={
            DOCS_WRITABLE &&
            cloud.route.kind === "owner" &&
            cloud.openedBoard?.access === "owner"
          }
          onActivateDoc={activateDoc}
          imageStudioSearchFocusRequest={imageStudioSearchFocusRequest}
          resolvePresentationAnimation={cloud.resolvePresentationAnimation}
          footer={
            <CloudAccount
              menuItems={
                <AppMenuItems
                  onCollabDialogOpen={onCollabDialogOpen}
                  isCollaborating={isCollaborating}
                  isCollabEnabled={!isCollabDisabled}
                  theme={appTheme}
                  refresh={() => forceRefresh((prev) => !prev)}
                />
              }
            />
          }
        />

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },
            {
              label: "GitHub",
              icon: GithubIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: [
                "issues",
                "bugs",
                "requests",
                "report",
                "features",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://github.com/excalidraw/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.followUs"),
              icon: XBrandIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["twitter", "contact", "social", "community"],
              perform: () => {
                window.open(
                  "https://x.com/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.discordChat"),
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              icon: DiscordIcon,
              keywords: [
                "chat",
                "talk",
                "contact",
                "bugs",
                "requests",
                "report",
                "feedback",
                "suggestions",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://discord.gg/UexuTaE",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: "YouTube",
              icon: youtubeIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["features", "tutorials", "howto", "help", "community"],
              perform: () => {
                window.open(
                  "https://youtube.com/@excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            ...(isExcalidrawPlusSignedUser
              ? [
                  {
                    ...ExcalidrawPlusAppCommand,
                    label: "Sign in / Go to Excalidraw+",
                  },
                ]
              : [ExcalidrawPlusCommand, ExcalidrawPlusAppCommand]),

            {
              label: t("overwriteConfirm.action.excalidrawPlus.button"),
              category: DEFAULT_CATEGORIES.export,
              icon: exportToPlus,
              predicate: true,
              keywords: ["plus", "export", "save", "backup"],
              perform: () => {
                if (excalidrawAPI) {
                  exportToExcalidrawPlus(
                    excalidrawAPI.getSceneElements(),
                    excalidrawAPI.getAppState(),
                    excalidrawAPI.getFiles(),
                    excalidrawAPI.getName(),
                  );
                }
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>
    </div>
  );
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <ExcalidrawAPIProvider>
          <ExcalidrawWrapper />
        </ExcalidrawAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
