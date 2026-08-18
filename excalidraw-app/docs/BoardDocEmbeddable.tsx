import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { DocEmbeddable } from "./DocEmbeddable";
import {
  readDocPlacementViewState,
  writeDocPlacementViewState,
} from "./docPlacementViewState";

import type { BoardDocContentStore } from "./docContentStore";
import type {
  DocAutosaveScheduler,
  DocSaveStatus,
} from "./docAutosaveScheduler";
import type { DocCrashJournal } from "./docCrashJournal";
import type { DocWriterCoordinator } from "./docWriterCoordinator";

type BoardDocEmbeddableProps = {
  store: BoardDocContentStore;
  docId: string;
  title: string;
  active: boolean;
  editable: boolean;
  metadataStatus: "loading" | "ready" | "empty" | "error" | "deleted";
  autosave?: DocAutosaveScheduler;
  saveStatus?: DocSaveStatus;
  journal?: DocCrashJournal;
  writerCoordinator?: DocWriterCoordinator;
  onLoadLatest?: () => void;
  onSaveDraftAsNew?: () => void;
  boardId: string;
  elementId: string;
  docVersion: number;
  uploadFiles?: (
    docId: string,
    files: readonly File[],
    signal: AbortSignal,
  ) => Promise<string[]>;
  resolveAssetPath?: (path: string) => Promise<string>;
  onRestore?: () => void;
  onRemoveCard?: () => void;
};

export const BoardDocEmbeddable = ({
  store,
  docId,
  title,
  active,
  editable,
  metadataStatus,
  autosave,
  saveStatus,
  journal,
  writerCoordinator,
  onLoadLatest,
  onSaveDraftAsNew,
  boardId,
  elementId,
  docVersion,
  uploadFiles,
  resolveAssetPath,
  onRestore,
  onRemoveCard,
}: BoardDocEmbeddableProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(docId, listener),
    () => store.getSnapshot(docId),
    () => store.getSnapshot(docId),
  );
  const [viewState, setViewState] = useState(() =>
    readDocPlacementViewState(boardId, elementId, docVersion),
  );
  useEffect(() => {
    setViewState(readDocPlacementViewState(boardId, elementId, docVersion));
  }, [boardId, docVersion, elementId]);
  const updateViewState = useCallback(
    (
      update: Partial<Pick<typeof viewState, "collapsedKeys" | "scrollTop">>,
    ) => {
      setViewState((current) => {
        const next = { ...current, ...update, docVersion };
        writeDocPlacementViewState(boardId, elementId, next);
        return next;
      });
    },
    [boardId, docVersion, elementId],
  );
  const collapsedOutlineKeys = useMemo(
    () => new Set(viewState.collapsedKeys),
    [viewState.collapsedKeys],
  );
  const handleCollapsedOutlineKeysChange = useCallback(
    (collapsedKeys: readonly string[]) =>
      updateViewState({ collapsedKeys: [...collapsedKeys] }),
    [updateViewState],
  );
  const handleScrollTopChange = useCallback(
    (scrollTop: number) => updateViewState({ scrollTop }),
    [updateViewState],
  );
  const handleUploadFiles = useCallback(
    async (files: readonly File[], signal: AbortSignal) =>
      uploadFiles ? await uploadFiles(docId, files, signal) : [],
    [docId, uploadFiles],
  );

  useEffect(() => {
    if (active) {
      store.request(docId, "active");
      void writerCoordinator?.claimWriter(docId);
    }
    return () => writerCoordinator?.release(docId);
  }, [active, docId, store, writerCoordinator]);

  useEffect(() => {
    if (!active || !editable || !journal || snapshot.status === "loading") {
      return;
    }
    let cancelled = false;
    void journal
      .claim(docId, { version: snapshot.version }, async (task) => await task())
      .then((entry) => {
        if (!cancelled && entry) {
          store.updateDraft(docId, entry.markdown);
          autosave?.queue(docId, entry.markdown, entry.baseVersion);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    active,
    autosave,
    docId,
    editable,
    journal,
    snapshot.status,
    snapshot.version,
    store,
  ]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || active || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        store.request(docId, "visible");
        observer.disconnect();
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [active, docId, store]);

  const status =
    metadataStatus !== "ready"
      ? metadataStatus
      : snapshot.status === "ready"
      ? "ready"
      : snapshot.status === "empty"
      ? "empty"
      : snapshot.status === "deleted"
      ? "deleted"
      : snapshot.status === "error"
      ? "error"
      : "loading";

  return (
    <div ref={rootRef} className="yaseendraw-board-doc-placement">
      <DocEmbeddable
        active={active}
        readonly={!editable}
        title={title}
        status={status}
        saveStatus={saveStatus}
        onRetrySave={() => void autosave?.retryNow()}
        onLoadLatest={onLoadLatest}
        onSaveDraftAsNew={onSaveDraftAsNew}
        onRestore={onRestore}
        onRemoveCard={onRemoveCard}
        onUploadFiles={editable && uploadFiles ? handleUploadFiles : undefined}
        resolveAssetPath={resolveAssetPath}
        collapsedOutlineKeys={collapsedOutlineKeys}
        onCollapsedOutlineKeysChange={handleCollapsedOutlineKeysChange}
        initialScrollTop={viewState.scrollTop}
        onScrollTopChange={handleScrollTopChange}
        markdown={snapshot.markdown}
        onMarkdownChange={(markdown) => {
          store.updateDraft(docId, markdown);
          autosave?.queue(docId, markdown, snapshot.version);
        }}
        onDeactivate={async (markdown) => {
          if (markdown !== store.getSnapshot(docId).markdown) {
            store.updateDraft(docId, markdown);
            autosave?.queue(docId, markdown, snapshot.version);
          }
          await autosave?.flush(docId);
        }}
      />
    </div>
  );
};
