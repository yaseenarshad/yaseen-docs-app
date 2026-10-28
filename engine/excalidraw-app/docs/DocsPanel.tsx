import {
  useMutation,
  usePaginatedQuery_experimental,
  useQuery,
} from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";

import {
  DOC_CANVAS_DRAG_TYPE,
  DOC_LIBRARY_REORDER_DRAG_TYPE,
  encodeDocCanvasDragPayload,
} from "./docCanvasPlacement";

import "./DocsPanel.scss";

import type { Id } from "../../convex/_generated/dataModel";
import type { DragEvent, KeyboardEvent } from "react";

export type DocLibrarySummary = {
  _id: string;
  title: string;
  folderId?: string;
  lifecycle: "active" | "trashed" | "purged";
  createdAt: number;
  updatedAt: number;
};

export type DocFolderSummary = {
  _id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type DocLibrarySort =
  | "name-asc"
  | "name-desc"
  | "created-desc"
  | "created-asc"
  | "modified-desc"
  | "modified-asc";

type DocsPanelProps = {
  docs: DocLibrarySummary[];
  folders: DocFolderSummary[];
  isLoading: boolean;
  isLoadingMore: boolean;
  canLoadMore: boolean;
  errorMessage: string | null;
  search: string;
  sort: DocLibrarySort;
  onSearchChange: (value: string) => void;
  onSortChange: (value: DocLibrarySort) => void;
  onLoadMore: () => void;
  onCreate: () => Promise<{ docId: string; title: string }>;
  onCreateFolder: (name: string) => Promise<void>;
  onRename: (docId: string, title: string) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onMove: (docId: string, folderId: string | null) => Promise<void>;
  onActivate: (docId: string, title: string) => void;
  trashDocs?: DocLibrarySummary[];
  onTrash?: (docId: string) => Promise<void>;
  onRestore?: (docId: string) => Promise<void>;
  onDeleteForever?: (docId: string) => Promise<void>;
};

const EXPANDED_DOC_FOLDERS_KEY = "yaseendraw-expanded-doc-folders";

const readExpandedFolders = () => {
  try {
    return JSON.parse(
      window.localStorage.getItem(EXPANDED_DOC_FOLDERS_KEY) ?? "{}",
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
};

export const DocsPanel = ({
  docs,
  folders,
  isLoading,
  isLoadingMore,
  canLoadMore,
  errorMessage,
  search,
  sort,
  onSearchChange,
  onSortChange,
  onLoadMore,
  onCreate,
  onCreateFolder,
  onRename,
  onRenameFolder,
  onDeleteFolder,
  onMove,
  onActivate,
  trashDocs = [],
  onTrash,
  onRestore,
  onDeleteForever,
}: DocsPanelProps) => {
  const [expanded, setExpanded] =
    useState<Record<string, boolean>>(readExpandedFolders);
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});
  const [draftFolderNames, setDraftFolderNames] = useState<
    Record<string, string>
  >({});
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [focusDocId, setFocusDocId] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const titleRefs = useRef(new Map<string, HTMLInputElement>());
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusDocId) {
      return;
    }
    const input = titleRefs.current.get(focusDocId);
    if (input) {
      input.focus();
      input.select();
      setFocusDocId(null);
    }
  }, [docs, focusDocId]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      !sentinel ||
      !canLoadMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onLoadMore();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMore, onLoadMore]);

  const docsByFolder = useMemo(() => {
    const grouped = new Map<string, DocLibrarySummary[]>();
    for (const doc of docs) {
      const key = doc.folderId ?? "unfiled";
      grouped.set(key, [...(grouped.get(key) ?? []), doc]);
    }
    return grouped;
  }, [docs]);

  const describeError = (cause: unknown) =>
    cause instanceof Error ? cause.message : "The Doc library could not update";

  const runAction = async (action: () => Promise<void>, success: string) => {
    setActionError(null);
    try {
      await action();
      setLiveMessage(success);
    } catch (cause) {
      setActionError(describeError(cause));
    }
  };

  const toggleFolder = (key: string) => {
    const next = { ...expanded, [key]: expanded[key] === false };
    setExpanded(next);
    try {
      window.localStorage.setItem(
        EXPANDED_DOC_FOLDERS_KEY,
        JSON.stringify(next),
      );
    } catch {
      // Expansion persistence is optional in restricted browsing modes.
    }
  };

  const commitDocTitle = async (doc: DocLibrarySummary) => {
    const title = (draftTitles[doc._id] ?? doc.title).trim();
    if (!title || title === doc.title) {
      setDraftTitles((current) => ({ ...current, [doc._id]: doc.title }));
      return;
    }
    await runAction(
      async () => await onRename(doc._id, title),
      `Renamed to ${title}`,
    );
  };

  const moveDoc = async (docId: string, folderId: string | null) =>
    await runAction(
      async () => await onMove(docId, folderId),
      folderId ? "Doc moved to folder" : "Doc moved to Unfiled",
    );

  const onDrop = (event: DragEvent, folderId: string | null) => {
    event.preventDefault();
    const docId = event.dataTransfer.getData(DOC_LIBRARY_REORDER_DRAG_TYPE);
    if (docId) {
      void moveDoc(docId, folderId);
    }
  };

  const renderDoc = (doc: DocLibrarySummary) => (
    <li
      key={doc._id}
      className="docs-panel__doc"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DOC_LIBRARY_REORDER_DRAG_TYPE, doc._id);
        event.dataTransfer.setData(
          DOC_CANVAS_DRAG_TYPE,
          encodeDocCanvasDragPayload({ docId: doc._id, title: doc.title }),
        );
      }}
    >
      <button
        type="button"
        className="docs-panel__open"
        aria-label={`Open ${doc.title}`}
        onClick={() => onActivate(doc._id, doc.title)}
      >
        ↗
      </button>
      <input
        ref={(node) => {
          if (node) {
            titleRefs.current.set(doc._id, node);
          } else {
            titleRefs.current.delete(doc._id);
          }
        }}
        aria-label={`Rename ${doc.title}`}
        value={draftTitles[doc._id] ?? doc.title}
        onChange={(event) =>
          setDraftTitles((current) => ({
            ...current,
            [doc._id]: event.target.value,
          }))
        }
        onBlur={() => void commitDocTitle(doc)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setDraftTitles((current) => ({ ...current, [doc._id]: doc.title }));
            event.currentTarget.blur();
          }
        }}
      />
      <select
        aria-label={`Move ${doc.title}`}
        value={doc.folderId ?? ""}
        onChange={(event) => void moveDoc(doc._id, event.target.value || null)}
      >
        <option value="">Unfiled</option>
        {folders.map((folder) => (
          <option key={folder._id} value={folder._id}>
            {folder.name}
          </option>
        ))}
      </select>
      {onTrash && (
        <button
          type="button"
          aria-label={`Move ${doc.title} to Trash`}
          onClick={() =>
            void runAction(
              async () => await onTrash(doc._id),
              `Moved ${doc.title} to Trash`,
            )
          }
        >
          Trash
        </button>
      )}
    </li>
  );

  const renderFolder = (folder: DocFolderSummary | null) => {
    const key = folder?._id ?? "unfiled";
    const name = folder?.name ?? "Unfiled";
    const children = docsByFolder.get(key) ?? [];
    const isOpen = expanded[key] !== false;
    return (
      <section
        key={key}
        className="docs-panel__folder"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => onDrop(event, folder?._id ?? null)}
      >
        <div className="docs-panel__folder-header">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${name}`}
            onClick={() => toggleFolder(key)}
          >
            {isOpen ? "▾" : "▸"}
          </button>
          {folder ? (
            <input
              aria-label={`Rename folder ${folder.name}`}
              value={draftFolderNames[folder._id] ?? folder.name}
              onChange={(event) =>
                setDraftFolderNames((current) => ({
                  ...current,
                  [folder._id]: event.target.value,
                }))
              }
              onBlur={() => {
                const nextName = (
                  draftFolderNames[folder._id] ?? folder.name
                ).trim();
                if (nextName && nextName !== folder.name) {
                  void runAction(
                    async () => await onRenameFolder(folder._id, nextName),
                    `Renamed folder to ${nextName}`,
                  );
                }
              }}
            />
          ) : (
            <strong>{name}</strong>
          )}
          <span>{children.length}</span>
          {folder && (
            <button
              type="button"
              aria-label={`Delete folder ${folder.name}`}
              onClick={() =>
                void runAction(
                  async () => await onDeleteFolder(folder._id),
                  `Deleted folder ${folder.name}`,
                )
              }
            >
              ×
            </button>
          )}
        </div>
        {isOpen && <ul>{children.map(renderDoc)}</ul>}
      </section>
    );
  };

  return (
    <div className="docs-panel" aria-label="Docs library">
      <div className="docs-panel__toolbar">
        <input
          type="search"
          aria-label="Search Docs"
          placeholder="Search Docs"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <select
          aria-label="Sort Docs"
          value={sort}
          onChange={(event) =>
            onSortChange(event.target.value as DocLibrarySort)
          }
        >
          <option value="modified-desc">Recently modified</option>
          <option value="modified-asc">Least recently modified</option>
          <option value="name-asc">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
          <option value="created-desc">Newest</option>
          <option value="created-asc">Oldest</option>
        </select>
        <button
          type="button"
          disabled={isCreating}
          onClick={() => {
            setIsCreating(true);
            setActionError(null);
            void onCreate()
              .then(({ docId, title }) => {
                setDraftTitles((current) => ({ ...current, [docId]: title }));
                setFocusDocId(docId);
                setLiveMessage(`Created ${title}`);
                onActivate(docId, title);
              })
              .catch((cause) => setActionError(describeError(cause)))
              .finally(() => setIsCreating(false));
          }}
        >
          {isCreating ? "Creating…" : "New Doc"}
        </button>
      </div>

      <form
        className="docs-panel__new-folder"
        onSubmit={(event) => {
          event.preventDefault();
          const name = newFolderName.trim();
          if (!name || isCreatingFolder) {
            return;
          }
          setIsCreatingFolder(true);
          void runAction(async () => {
            await onCreateFolder(name);
            setNewFolderName("");
          }, `Created folder ${name}`).finally(() =>
            setIsCreatingFolder(false),
          );
        }}
      >
        <input
          aria-label="New Doc folder name"
          placeholder="New folder"
          value={newFolderName}
          onChange={(event) => setNewFolderName(event.target.value)}
        />
        <button
          type="submit"
          disabled={isCreatingFolder || !newFolderName.trim()}
        >
          Add folder
        </button>
      </form>

      {(errorMessage || actionError) && (
        <div className="docs-panel__error" role="alert">
          {actionError ?? errorMessage}
        </div>
      )}
      {showTrash ? (
        trashDocs.length === 0 ? (
          <div className="docs-panel__empty">Trash is empty</div>
        ) : (
          <ul className="docs-panel__trash-list">
            {trashDocs.map((doc) => (
              <li className="docs-panel__trash-item" key={doc._id}>
                <span className="docs-panel__trash-title">{doc.title}</span>
                <button
                  type="button"
                  onClick={() =>
                    void runAction(
                      async () => await onRestore?.(doc._id),
                      `Restored ${doc.title}`,
                    )
                  }
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${doc.title} forever? This cannot be undone.`,
                      )
                    ) {
                      void runAction(
                        async () => await onDeleteForever?.(doc._id),
                        `Deleting ${doc.title} forever`,
                      );
                    }
                  }}
                >
                  Delete forever
                </button>
              </li>
            ))}
          </ul>
        )
      ) : isLoading ? (
        <div className="docs-panel__empty">Loading Docs…</div>
      ) : docs.length === 0 ? (
        <div className="docs-panel__empty">No Docs yet</div>
      ) : (
        <div className="docs-panel__folders">
          {renderFolder(null)}
          {folders.map((folder) => renderFolder(folder))}
        </div>
      )}
      <div ref={sentinelRef} className="docs-panel__sentinel" />
      {isLoadingMore && <div>Loading more Docs…</div>}
      {canLoadMore && (
        <button type="button" onClick={onLoadMore}>
          Load more Docs
        </button>
      )}
      <button
        type="button"
        className="docs-panel__trash"
        aria-pressed={showTrash}
        onClick={() => setShowTrash((current) => !current)}
      >
        {showTrash ? "Back to Docs" : `Trash (${trashDocs.length})`}
      </button>
      <div className="visually-hidden" aria-live="polite">
        {liveMessage}
      </div>
    </div>
  );
};

const DOC_SORT_STORAGE_KEY = "yaseendraw-doc-sort";

const readDocSort = (): DocLibrarySort => {
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(DOC_SORT_STORAGE_KEY);
  } catch {
    // Fall back to the default in privacy-restricted browsing modes.
  }
  return value === "name-asc" ||
    value === "name-desc" ||
    value === "created-desc" ||
    value === "created-asc" ||
    value === "modified-asc"
    ? value
    : "modified-desc";
};

export const DocsPanelContainer = ({
  onActivate,
}: {
  onActivate?: (docId: string, title: string) => void;
}) => {
  const [search, setSearch] = useState("");
  const [sort, setSortState] = useState<DocLibrarySort>(readDocSort);
  const paginated = usePaginatedQuery_experimental({
    query: api.docs.listMinePaginated,
    args: { sort, query: search },
    initialNumItems: 40,
  });
  const trashPaginated = usePaginatedQuery_experimental({
    query: api.docs.listTrashPaginated,
    args: {},
    initialNumItems: 100,
  });
  const folders = useQuery(api.docFolders.listMine, {});
  const createDoc = useMutation(api.docs.create);
  const renameDoc = useMutation(api.docs.rename);
  const moveDoc = useMutation(api.docs.moveToFolder);
  const createFolder = useMutation(api.docFolders.create);
  const renameFolder = useMutation(api.docFolders.rename);
  const removeFolder = useMutation(api.docFolders.remove);
  const trashDoc = useMutation(api.docs.trash);
  const restoreDoc = useMutation(api.docs.restore);
  const deleteDocForever = useMutation(api.docs.deleteForever);

  const setSort = useCallback((next: DocLibrarySort) => {
    try {
      window.localStorage.setItem(DOC_SORT_STORAGE_KEY, next);
    } catch {
      // Sorting still works for this session when persistence is unavailable.
    }
    setSortState(next);
  }, []);

  return (
    <DocsPanel
      docs={(paginated.data ?? []) as DocLibrarySummary[]}
      folders={(folders ?? []) as DocFolderSummary[]}
      isLoading={paginated.status === "pending" && !paginated.data?.length}
      isLoadingMore={
        paginated.status === "pending" && Boolean(paginated.data?.length)
      }
      canLoadMore={paginated.canLoadMore}
      errorMessage={
        paginated.status === "error" ? paginated.error.message : null
      }
      search={search}
      sort={sort}
      onSearchChange={setSearch}
      onSortChange={setSort}
      onLoadMore={() => paginated.loadMore(40)}
      onCreate={async () => {
        const created = await createDoc({ folderId: null });
        return { docId: created.docId, title: created.title };
      }}
      onCreateFolder={async (name) => {
        await createFolder({ name });
      }}
      onRename={async (docId, title) => {
        const result = await renameDoc({ docId: docId as Id<"docs">, title });
        if (result.status === "conflict") {
          throw new Error(
            "A Doc with that title already exists in this folder",
          );
        }
      }}
      onRenameFolder={async (folderId, name) => {
        await renameFolder({ folderId: folderId as Id<"docFolders">, name });
      }}
      onDeleteFolder={async (folderId) => {
        const result = await removeFolder({
          folderId: folderId as Id<"docFolders">,
        });
        if (result.status === "conflict") {
          throw new Error(
            "Rename the conflicting Docs before deleting this folder",
          );
        }
      }}
      onMove={async (docId, folderId) => {
        const result = await moveDoc({
          docId: docId as Id<"docs">,
          folderId: folderId as Id<"docFolders"> | null,
        });
        if (result.status === "conflict") {
          throw new Error("A Doc with that title already exists there");
        }
      }}
      onActivate={(docId, title) => onActivate?.(docId, title)}
      trashDocs={(trashPaginated.data ?? []) as DocLibrarySummary[]}
      onTrash={async (docId) => {
        await trashDoc({ docId: docId as Id<"docs"> });
      }}
      onRestore={async (docId) => {
        await restoreDoc({ docId: docId as Id<"docs"> });
      }}
      onDeleteForever={async (docId) => {
        await deleteDocForever({
          docId: docId as Id<"docs">,
        });
      }}
    />
  );
};
