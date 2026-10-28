import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KEYS, isWritableElement } from "@excalidraw/common";
import { DefaultSidebar, Sidebar } from "@excalidraw/excalidraw";
import { CaptureUpdateAction } from "@excalidraw/element";
import {
  file,
  frameToolIcon,
  FreedrawIcon,
  HamburgerMenuIcon,
  ImageIcon,
  LibraryIcon,
  presentationIcon,
  sidebarRightIcon,
} from "@excalidraw/excalidraw/components/icons";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import { useEditorInterface } from "@excalidraw/excalidraw/components/App";

import type {
  ExcalidrawImperativeAPI,
  SidebarTabName,
} from "@excalidraw/excalidraw/types";

import { composeBoardSort, splitBoardSort } from "../cloud/boardOrganizer";
import { useCloudProfileUsername } from "../cloud/CloudProfileContext";
import {
  readProfileSidebarDockPreference,
  writeProfileSidebarDockPreference,
} from "../cloud/sidebarDockPreference";
import {
  applyFramesVisibility,
  readFramesVisiblePreference,
  writeFramesVisiblePreference,
} from "../frames/framesVisibility";
import { ImageStudio } from "../image-studio/ImageStudio";
import { PresentationAnimationController } from "../presentation/PresentationAnimationController";

import { PresentationPlayer } from "../presentation/PresentationPlayer";
import { PresentationSidebar } from "../presentation/PresentationSidebar";
import { DocsPanelContainer } from "../docs/DocsPanel";

import "./AppSidebar.scss";

import { SavedComponents } from "./SavedComponents";
import {
  BOARD_PREVIEW_DWELL_MS,
  BoardPreviewOverlay,
} from "./boardPreviewOverlay";

import type { MouseEvent as ReactMouseEvent } from "react";
import type {
  BoardPreviewLoadState,
  BoardPreviewSummary,
} from "./boardPreviewOverlay";

import type { BoardSort, BoardSortCategory } from "../cloud/boardOrganizer";
import type { ResolvePresentationAnimation } from "../presentation/animationDomAdapter";

type BoardSummary = {
  _id: string;
  slug: string;
  title: string;
  folderId?: string;
  createdAt: number;
  updatedAt: number;
  preview: BoardPreviewSummary;
};

type BoardFolderSummary = {
  _id: string;
  name: string;
};

type BoardBrowserProps = {
  boards: BoardSummary[];
  folders: BoardFolderSummary[];
  activeSlug: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  isFolderListLoading: boolean;
  canLoadMore: boolean;
  errorMessage: string | null;
  search: string;
  sort: BoardSort;
  onSearchChange: (query: string) => void;
  onSortChange: (sort: BoardSort) => void;
  onLoadMore: () => void;
  onCreate: () => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onMove: (boardId: string, folderId: string | null) => Promise<void>;
  onDelete: (slug: string) => Promise<void>;
  onOpen: (slug: string) => Promise<void>;
};

type AppSidebarProps = BoardBrowserProps & {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  canInsertMedia: boolean;
  canEditSlides?: boolean;
  canManageDocs?: boolean;
  onActivateDoc?: (docId: string, title: string) => void;
  imageStudioSearchFocusRequest: number;
  resolvePresentationAnimation?: ResolvePresentationAnimation;
  footer?: React.ReactNode;
};

type ActiveBoardPreview = {
  board: BoardSummary;
  cacheKey: string;
  requestId: number;
  loadState: BoardPreviewLoadState;
};

const BOARD_PREVIEW_CAPABILITY_QUERY = "(hover: hover) and (pointer: fine)";

const supportsAutomaticBoardPreviews = () =>
  Boolean(window.matchMedia?.(BOARD_PREVIEW_CAPABILITY_QUERY).matches);

const getBoardPreviewCacheKey = (board: BoardSummary) => {
  if (board.preview.status === "legacy") {
    return `${board._id}:legacy`;
  }
  if (board.preview.status === "empty") {
    return `${board._id}:${board.preview.version}:empty`;
  }
  return `${board._id}:${board.preview.version}:${board.preview.url}`;
};

const shouldUseSaveSafeBoardNavigation = (
  event: ReactMouseEvent<HTMLAnchorElement>,
) => {
  const nativeEvent = event.nativeEvent as MouseEvent & {
    pointerType?: string;
    sourceCapabilities?: { firesTouchEvents?: boolean };
  };
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.detail === 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (nativeEvent.pointerType !== undefined &&
      nativeEvent.pointerType !== "mouse") ||
    nativeEvent.sourceCapabilities?.firesTouchEvents
  ) {
    return false;
  }
  const destination = new URL(event.currentTarget.href);
  return (
    destination.origin === window.location.origin &&
    !event.currentTarget.target &&
    !event.currentTarget.hasAttribute("download")
  );
};

export const BoardBrowser = ({
  boards,
  folders,
  activeSlug,
  isLoading,
  isLoadingMore,
  isFolderListLoading,
  canLoadMore,
  errorMessage,
  search,
  sort,
  onSearchChange,
  onSortChange,
  onLoadMore,
  onCreate,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMove,
  onDelete,
  onOpen,
}: BoardBrowserProps) => {
  const sortParts = splitBoardSort(sort);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [openMenuSlug, setOpenMenuSlug] = useState<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [pendingMoveBoardId, setPendingMoveBoardId] = useState<string | null>(
    null,
  );
  const [moveDestination, setMoveDestination] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<ActiveBoardPreview | null>(
    null,
  );
  const sentinelRef = useRef<HTMLDivElement>(null);
  const boardBrowserRef = useRef<HTMLDivElement>(null);
  const moveHandleRefs = useRef(new Map<string, HTMLButtonElement>());
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreviewBoardIdRef = useRef<string | null>(null);
  const previewRequestIdRef = useRef(0);
  const activePreviewRef = useRef<ActiveBoardPreview | null>(null);
  const previewCacheRef = useRef(
    new Map<string, Exclude<BoardPreviewLoadState, "loading">>(),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(
        window.localStorage.getItem("yaseen-whiteboard-expanded-folders") ??
          "{}",
      ) as Record<string, boolean>;
    } catch {
      return {};
    }
  });

  const closePreview = useCallback(() => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    pendingPreviewBoardIdRef.current = null;
    previewRequestIdRef.current += 1;
    activePreviewRef.current = null;
    setActivePreview(null);
  }, []);

  const schedulePreview = useCallback(
    (board: BoardSummary, pointerType?: string) => {
      if (
        !supportsAutomaticBoardPreviews() ||
        openMenuSlug ||
        openFolderMenuId ||
        (pointerType !== undefined && pointerType !== "mouse")
      ) {
        return;
      }
      if (
        pendingPreviewBoardIdRef.current === board._id ||
        activePreviewRef.current?.board._id === board._id
      ) {
        return;
      }

      closePreview();
      const requestId = previewRequestIdRef.current;
      pendingPreviewBoardIdRef.current = board._id;
      previewTimerRef.current = setTimeout(() => {
        if (
          previewRequestIdRef.current !== requestId ||
          pendingPreviewBoardIdRef.current !== board._id
        ) {
          return;
        }
        previewTimerRef.current = null;
        pendingPreviewBoardIdRef.current = null;
        const cacheKey = getBoardPreviewCacheKey(board);
        const cachedLoadState = previewCacheRef.current.get(cacheKey);
        const nextPreview: ActiveBoardPreview = {
          board,
          cacheKey,
          requestId,
          loadState:
            board.preview.status === "available"
              ? cachedLoadState ?? "loading"
              : "loaded",
        };
        activePreviewRef.current = nextPreview;
        setActivePreview(nextPreview);
      }, BOARD_PREVIEW_DWELL_MS);
    },
    [closePreview, openFolderMenuId, openMenuSlug],
  );

  const updatePreviewImageState = useCallback(
    (
      requestId: number,
      cacheKey: string,
      loadState: Exclude<BoardPreviewLoadState, "loading">,
    ) => {
      const current = activePreviewRef.current;
      if (
        !current ||
        current.requestId !== requestId ||
        current.cacheKey !== cacheKey
      ) {
        return;
      }
      previewCacheRef.current.set(cacheKey, loadState);
      const next = { ...current, loadState };
      activePreviewRef.current = next;
      setActivePreview(next);
    },
    [],
  );
  const groups = useMemo(() => {
    const next = new Map<string, BoardSummary[]>();
    next.set("unfiled", []);
    for (const folder of folders) {
      next.set(folder._id, []);
    }
    for (const board of boards) {
      const key =
        board.folderId && next.has(board.folderId) ? board.folderId : "unfiled";
      next.get(key)!.push(board);
    }
    return next;
  }, [boards, folders]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !canLoadMore || isLoadingMore) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMore, isLoadingMore, onLoadMore]);

  useEffect(() => {
    closePreview();
  }, [activeSlug, closePreview]);

  useEffect(() => {
    const current = activePreviewRef.current;
    if (!current) {
      return;
    }
    const currentBoard = boards.find(
      (board) => board._id === current.board._id,
    );
    if (
      !currentBoard ||
      getBoardPreviewCacheKey(currentBoard) !== current.cacheKey
    ) {
      closePreview();
    }
  }, [boards, closePreview]);

  useEffect(() => {
    const closePreviewOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        (!activePreviewRef.current && !pendingPreviewBoardIdRef.current)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closePreview();
    };
    document.addEventListener("keydown", closePreviewOnEscape, true);
    return () =>
      document.removeEventListener("keydown", closePreviewOnEscape, true);
  }, [closePreview]);

  useEffect(
    () => () => {
      if (previewTimerRef.current !== null) {
        clearTimeout(previewTimerRef.current);
      }
      previewRequestIdRef.current += 1;
      activePreviewRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const cancelMove = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setOpenMenuSlug(null);
      setOpenFolderMenuId(null);
      setDragTargetKey(null);
      setLiveMessage("Move cancelled");
    };
    window.addEventListener("keydown", cancelMove);
    return () => window.removeEventListener("keydown", cancelMove);
  }, []);

  const setFolderExpanded = (key: string) => {
    setExpanded((current) => {
      const next = { ...current, [key]: current[key] === false };
      window.localStorage.setItem(
        "yaseen-whiteboard-expanded-folders",
        JSON.stringify(next),
      );
      return next;
    });
  };

  const moveBoard = async (board: BoardSummary, folderId: string | null) => {
    if (pendingMoveBoardId) {
      return;
    }
    setPendingMoveBoardId(board._id);
    setActionError(null);
    try {
      await onMove(board._id, folderId);
      const destination =
        folderId === null
          ? "Unfiled"
          : folders.find((folder) => folder._id === folderId)?.name ?? "folder";
      setLiveMessage(`${board.title} moved to ${destination}`);
      setOpenMenuSlug(null);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The board could not be moved.",
      );
    } finally {
      setPendingMoveBoardId(null);
      window.requestAnimationFrame(() =>
        moveHandleRefs.current.get(board._id)?.focus(),
      );
    }
  };

  const renderBoard = (board: BoardSummary) => {
    const isPending = pendingMoveBoardId === board._id;
    const dateKind = sort.startsWith("created") ? "Created" : "Modified";
    const formattedDate = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(sort.startsWith("created") ? board.createdAt : board.updatedAt);
    return (
      <div
        key={board._id}
        className={
          board.slug === activeSlug
            ? "board-browser__item board-browser__item--active"
            : "board-browser__item"
        }
        aria-busy={isPending}
        onPointerEnter={(event) => schedulePreview(board, event.pointerType)}
        onPointerLeave={closePreview}
      >
        <button
          ref={(node) => {
            if (node) {
              moveHandleRefs.current.set(board._id, node);
            } else {
              moveHandleRefs.current.delete(board._id);
            }
          }}
          type="button"
          draggable={!pendingMoveBoardId}
          className="board-browser__move"
          aria-label={`Move ${board.title}`}
          title="Drag or press Enter to move"
          onDragStart={(event) => {
            closePreview();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
              "application/x-yaseen-board-id",
              board._id,
            );
            setLiveMessage(`Moving ${board.title}`);
          }}
          onDragEnd={() => {
            setDragTargetKey(null);
            setLiveMessage("Move cancelled");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              closePreview();
              setOpenMenuSlug(board.slug);
              setMoveDestination(board.folderId ?? "");
            }
          }}
        >
          ⠿
        </button>
        <a
          className="board-browser__open"
          href={`/b/${encodeURIComponent(board.slug)}`}
          aria-label={`Open ${board.title}`}
          onFocus={() => schedulePreview(board)}
          onBlur={closePreview}
          onClick={(event) => {
            closePreview();
            if (!shouldUseSaveSafeBoardNavigation(event)) {
              return;
            }
            event.preventDefault();
            void onOpen(board.slug);
          }}
        >
          <span className="board-browser__details">
            <strong title={board.title}>{board.title}</strong>
            <span>
              {dateKind} {formattedDate}
            </span>
          </span>
        </a>
        <div className="board-browser__options">
          <button
            type="button"
            className="board-browser__more"
            aria-label={`More options for ${board.title}`}
            aria-expanded={openMenuSlug === board.slug}
            onClick={() => {
              closePreview();
              setOpenMenuSlug((current) =>
                current === board.slug ? null : board.slug,
              );
              setMoveDestination(board.folderId ?? "");
            }}
          >
            ⋯
          </button>
          {openMenuSlug === board.slug && (
            <div className="board-browser__menu">
              <label>
                Move to folder…
                <select
                  aria-label={`Move ${board.title} to folder`}
                  value={moveDestination}
                  disabled={Boolean(pendingMoveBoardId)}
                  onChange={(event) => setMoveDestination(event.target.value)}
                >
                  <option value="">Unfiled</option>
                  {folders.map((folder) => (
                    <option key={folder._id} value={folder._id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={Boolean(pendingMoveBoardId)}
                onClick={() => void moveBoard(board, moveDestination || null)}
              >
                {isPending ? "Moving…" : "Move board"}
              </button>
              <button
                type="button"
                disabled={deletingSlug === board.slug}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Delete “${board.title}”? This cannot be undone.`,
                    )
                  ) {
                    return;
                  }
                  setDeletingSlug(board.slug);
                  try {
                    await onDelete(board.slug);
                    setOpenMenuSlug(null);
                  } finally {
                    setDeletingSlug(null);
                  }
                }}
              >
                {deletingSlug === board.slug ? "Deleting…" : "Delete board"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderFolder = (folder: BoardFolderSummary | null, key: string) => {
    const name = folder?.name ?? "Unfiled";
    const children = groups.get(key) ?? [];
    const isExpanded = expanded[key] !== false;
    return (
      <section
        className={
          dragTargetKey === key
            ? "board-browser__folder board-browser__folder--drop-target"
            : "board-browser__folder"
        }
        key={key}
        onDragEnter={(event) => {
          if (
            event.dataTransfer.types.includes("application/x-yaseen-board-id")
          ) {
            setDragTargetKey(key);
          }
        }}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setDragTargetKey((current) => (current === key ? null : current));
          }
        }}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes("application/x-yaseen-board-id")
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragTargetKey(null);
          const boardId = event.dataTransfer.getData(
            "application/x-yaseen-board-id",
          );
          const board = boards.find((candidate) => candidate._id === boardId);
          if (board) {
            void moveBoard(board, folder?._id ?? null);
          }
        }}
      >
        <div className="board-browser__folder-row">
          <button
            type="button"
            className="board-browser__folder-toggle"
            aria-expanded={isExpanded}
            onClick={() => setFolderExpanded(key)}
          >
            <span aria-hidden="true">{isExpanded ? "⌄" : "›"}</span>
            <strong title={name}>{name}</strong>
          </button>
          {folder && (
            <div className="board-browser__options">
              <button
                type="button"
                className="board-browser__more"
                aria-label={`Folder options for ${name}`}
                aria-expanded={openFolderMenuId === folder._id}
                onClick={() => {
                  closePreview();
                  setOpenFolderMenuId((current) =>
                    current === folder._id ? null : folder._id,
                  );
                }}
              >
                ⋯
              </button>
              {openFolderMenuId === folder._id && (
                <div className="board-browser__menu">
                  <button
                    type="button"
                    onClick={async () => {
                      const nextName = window.prompt(
                        "Rename folder",
                        folder.name,
                      );
                      if (!nextName) {
                        return;
                      }
                      try {
                        await onRenameFolder(folder._id, nextName);
                        setOpenFolderMenuId(null);
                      } catch (error) {
                        setActionError(
                          error instanceof Error
                            ? error.message
                            : "The folder could not be renamed.",
                        );
                      }
                    }}
                  >
                    Rename folder
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Delete “${folder.name}”? Its boards will move to Unfiled.`,
                        )
                      ) {
                        return;
                      }
                      setActionError(null);
                      try {
                        await onDeleteFolder(folder._id);
                        setOpenFolderMenuId(null);
                      } catch (error) {
                        setActionError(
                          error instanceof Error
                            ? error.message
                            : "The folder could not be deleted.",
                        );
                      }
                    }}
                  >
                    Delete folder
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {isExpanded && (
          <div className="board-browser__folder-boards">
            {children.map(renderBoard)}
          </div>
        )}
      </section>
    );
  };

  return (
    <div ref={boardBrowserRef} className="board-browser">
      <div className="board-browser__heading">
        <div>
          <strong>Your boards</strong>
          <span>Saved automatically</span>
        </div>
        <div className="board-browser__create-actions">
          <button
            type="button"
            disabled={isCreatingFolder}
            onClick={async () => {
              const name = window.prompt("New folder name");
              if (!name) {
                return;
              }
              setIsCreatingFolder(true);
              setActionError(null);
              try {
                await onCreateFolder(name);
              } catch (error) {
                setActionError(
                  error instanceof Error
                    ? error.message
                    : "The folder could not be created.",
                );
              } finally {
                setIsCreatingFolder(false);
              }
            }}
          >
            {isCreatingFolder ? "Creating…" : "New folder"}
          </button>
          <button
            type="button"
            disabled={isCreating}
            onClick={async () => {
              setIsCreating(true);
              try {
                await onCreate();
              } finally {
                setIsCreating(false);
              }
            }}
          >
            {isCreating ? "Creating…" : "+ New board"}
          </button>
        </div>
      </div>
      <div className="board-browser__filters">
        <input
          className="board-browser__search"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search all boards"
          aria-label="Search all boards"
        />
        <div className="board-browser__sort-controls">
          <select
            className="board-browser__sort"
            aria-label="Sort category"
            value={sortParts.category}
            onChange={(event) =>
              onSortChange(
                composeBoardSort(
                  event.target.value as BoardSortCategory,
                  sortParts.direction,
                ),
              )
            }
          >
            <option value="name">Name</option>
            <option value="created">Created</option>
            <option value="modified">Modified</option>
          </select>
          <button
            type="button"
            className="board-browser__sort-direction"
            aria-label={`Sort ${
              sortParts.direction === "asc" ? "ascending" : "descending"
            }`}
            title={`Sort ${
              sortParts.direction === "asc" ? "ascending" : "descending"
            }`}
            onClick={() =>
              onSortChange(
                composeBoardSort(
                  sortParts.category,
                  sortParts.direction === "asc" ? "desc" : "asc",
                ),
              )
            }
          >
            <span aria-hidden="true">
              {sortParts.direction === "asc" ? "↑" : "↓"}
            </span>
          </button>
        </div>
      </div>
      {(actionError || errorMessage) && (
        <div className="board-browser__error" role="alert">
          {actionError || errorMessage}
          {errorMessage && (
            <button type="button" onClick={onLoadMore}>
              Retry
            </button>
          )}
        </div>
      )}
      <div className="visually-hidden" aria-live="polite">
        {liveMessage}
      </div>
      <div className="board-browser__list">
        {isLoading ? (
          <div className="board-browser__empty">Loading boards…</div>
        ) : boards.length === 0 && !search ? (
          <>
            {renderFolder(null, "unfiled")}
            {folders.map((folder) => renderFolder(folder, folder._id))}
            <div className="board-browser__empty">No boards yet</div>
          </>
        ) : (
          <>
            {search && boards.length === 0 && (
              <div className="board-browser__empty">No matching boards</div>
            )}
            {renderFolder(null, "unfiled")}
            {folders.map((folder) => renderFolder(folder, folder._id))}
          </>
        )}
        {isFolderListLoading && (
          <div className="board-browser__empty">Loading folders…</div>
        )}
        <div ref={sentinelRef} className="board-browser__sentinel" />
        {isLoadingMore && (
          <div className="board-browser__loading-more">
            Loading more boards…
          </div>
        )}
      </div>
      {activePreview && (
        <BoardPreviewOverlay
          boardId={activePreview.board._id}
          title={activePreview.board.title}
          preview={activePreview.board.preview}
          loadState={activePreview.loadState}
          anchorRef={boardBrowserRef}
          onImageLoad={() =>
            updatePreviewImageState(
              activePreview.requestId,
              activePreview.cacheKey,
              "loaded",
            )
          }
          onImageError={() =>
            updatePreviewImageState(
              activePreview.requestId,
              activePreview.cacheKey,
              "failed",
            )
          }
        />
      )}
    </div>
  );
};

const APP_SIDEBAR_LAUNCHERS = [
  { tab: "boards", label: "Boards", shortLabel: "Boards", icon: file },
  { tab: "docs", label: "Docs", shortLabel: "Docs", icon: file },
  {
    tab: "components",
    label: "Components",
    shortLabel: "Components",
    icon: LibraryIcon,
  },
  {
    tab: "image-studio",
    label: "Image Studio",
    shortLabel: "Images",
    icon: ImageIcon,
  },
  {
    tab: "presentation",
    label: "Presentation",
    shortLabel: "Present",
    icon: presentationIcon,
  },
] as const;

const LAST_APP_SIDEBAR_TAB_STORAGE_KEY =
  "yaseen-whiteboard-last-sidebar-section";

const APP_SIDEBAR_TABS = new Set<SidebarTabName>([
  "boards",
  "docs",
  "components",
  "image-studio",
  "presentation",
  "search",
]);

const getRememberedSidebarTab = (): SidebarTabName => {
  try {
    const rememberedTab = window.localStorage.getItem(
      LAST_APP_SIDEBAR_TAB_STORAGE_KEY,
    );
    return rememberedTab && APP_SIDEBAR_TABS.has(rememberedTab)
      ? rememberedTab
      : "boards";
  } catch {
    return "boards";
  }
};

const rememberSidebarTab = (tab: SidebarTabName | undefined) => {
  if (!tab || !APP_SIDEBAR_TABS.has(tab)) {
    return;
  }
  try {
    window.localStorage.setItem(LAST_APP_SIDEBAR_TAB_STORAGE_KEY, tab);
  } catch {
    // Storage may be unavailable in privacy-restricted contexts.
  }
};

export const AppSidebarLaunchers = ({
  excalidrawAPI,
  canManageDocs = false,
  onRequestImageStudioSearch,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  canManageDocs?: boolean;
  onRequestImageStudioSearch?: () => void;
}) => {
  const { openSidebar, writingMode } = useUIAppState();
  const activeTab =
    openSidebar?.name === "default" ? openSidebar.tab ?? "boards" : null;
  const [framesVisible, setFramesVisible] = useState(
    readFramesVisiblePreference,
  );

  useEffect(() => {
    if (excalidrawAPI) {
      applyFramesVisibility(excalidrawAPI, framesVisible);
    }
  }, [excalidrawAPI, framesVisible]);

  const open = (tab: SidebarTabName) => {
    excalidrawAPI?.toggleSidebar({
      name: "default",
      tab,
      force: true,
    });
  };

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const tab =
        key === "b"
          ? "boards"
          : key === "d" && canManageDocs
          ? "docs"
          : key === "c"
          ? "components"
          : key === "f"
          ? "image-studio"
          : null;
      const secondaryPrimaryModifier =
        KEYS.CTRL_OR_CMD === "metaKey" ? event.ctrlKey : event.metaKey;
      const target = event.target;

      if (
        !tab ||
        !event[KEYS.CTRL_OR_CMD] ||
        secondaryPrimaryModifier ||
        event.shiftKey ||
        event.altKey ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229
      ) {
        return;
      }

      const isEditableTarget =
        isWritableElement(target) ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest("[contenteditable='true']") !== null));
      const isActivePanelToggle = activeTab === tab;
      const isTargetWithinActivePanel =
        isActivePanelToggle &&
        target instanceof HTMLElement &&
        target.closest(".default-sidebar") !== null;

      if (isTargetWithinActivePanel) {
        event.preventDefault();
        event.stopPropagation();
        excalidrawAPI.toggleSidebar({
          name: "default",
          tab,
          force: false,
        });
        return;
      }

      const appState = excalidrawAPI.getAppState();
      const hasNativeSelection = Boolean(
        window.getSelection() && !window.getSelection()?.isCollapsed,
      );
      const hasActiveGesture = Boolean(
        appState.newElement ||
          appState.multiElement ||
          appState.selectionElement ||
          appState.resizingElement ||
          appState.selectedLinearElement ||
          appState.editingFrame ||
          appState.croppingElementId ||
          appState.cursorButton === "down" ||
          appState.selectedElementsAreBeingDragged ||
          appState.isResizing ||
          appState.isRotating,
      );

      if (
        isEditableTarget ||
        hasNativeSelection ||
        appState.editingTextElement ||
        appState.openDialog ||
        hasActiveGesture ||
        Object.keys(appState.selectedElementIds).length > 0
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const shouldOpen = !isActivePanelToggle;
      excalidrawAPI.toggleSidebar({
        name: "default",
        tab,
        force: shouldOpen,
      });
      if (tab === "image-studio" && shouldOpen) {
        onRequestImageStudioSearch?.();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeTab, canManageDocs, excalidrawAPI, onRequestImageStudioSearch]);

  return (
    <nav
      className={`app-sidebar-launchers${
        openSidebar?.name === "default"
          ? " app-sidebar-launchers--panel-open"
          : ""
      }`}
      aria-label="Workspace panels"
    >
      <button
        type="button"
        className="app-sidebar-launcher app-sidebar-launchers__boards-menu"
        aria-label={
          activeTab ? "Close workspace panel" : "Open workspace panel"
        }
        aria-pressed={openSidebar?.name === "default"}
        title={activeTab ? "Close workspace panel" : "Open Your Boards"}
        disabled={!excalidrawAPI}
        onClick={() => {
          excalidrawAPI?.toggleSidebar({
            name: "default",
            tab: "boards",
            force: !activeTab,
          });
        }}
      >
        {HamburgerMenuIcon}
      </button>
      <div className="app-sidebar-launchers__direct">
        {APP_SIDEBAR_LAUNCHERS.filter(
          (launcher) => launcher.tab !== "docs" || canManageDocs,
        ).map((launcher) => (
          <button
            key={launcher.tab}
            type="button"
            className="app-sidebar-launcher app-sidebar-launcher--quiet"
            aria-label={launcher.label}
            aria-pressed={activeTab === launcher.tab}
            title={launcher.label}
            disabled={!excalidrawAPI}
            onClick={() => open(launcher.tab)}
          >
            {launcher.icon}
            <span className="app-sidebar-launcher__label">
              {launcher.shortLabel}
            </span>
          </button>
        ))}
      </div>
      <div className="app-sidebar-launchers__modes">
        <button
          type="button"
          className="app-sidebar-launcher app-sidebar-launcher--quiet"
          aria-label="Writing mode"
          aria-pressed={!!writingMode}
          title={writingMode ? "Turn off Writing mode" : "Turn on Writing mode"}
          disabled={!excalidrawAPI}
          onClick={() => {
            excalidrawAPI?.updateScene({
              appState: { writingMode: !writingMode },
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }}
        >
          {FreedrawIcon}
          <span className="app-sidebar-launcher__label">Writing</span>
        </button>
        <button
          type="button"
          className="app-sidebar-launcher app-sidebar-launcher--quiet app-sidebar-launcher--toggle"
          aria-label="Show frames"
          aria-pressed={framesVisible}
          title={framesVisible ? "Hide frames" : "Show frames"}
          disabled={!excalidrawAPI}
          onClick={() => {
            const nextVisible = !framesVisible;
            setFramesVisible(nextVisible);
            writeFramesVisiblePreference(nextVisible);
          }}
        >
          {frameToolIcon}
          <span className="app-sidebar-launcher__label">Frames</span>
        </button>
      </div>
      <button
        type="button"
        className="app-sidebar-launcher app-sidebar-launchers__compact"
        aria-label="Open last workspace panel"
        aria-pressed={openSidebar?.name === "default"}
        title="Boards, Docs, Components, Images, and Presentation"
        disabled={!excalidrawAPI}
        onClick={() => open(activeTab ?? getRememberedSidebarTab())}
      >
        {sidebarRightIcon}
      </button>
    </nav>
  );
};

export const openBoardFromSidebar = async (
  slug: string,
  onOpen: (slug: string) => Promise<void>,
  closeSidebar: () => void,
  keepOpen: boolean,
) => {
  await onOpen(slug);
  if (!keepOpen) {
    closeSidebar();
  }
};

export const AppSidebar = ({
  excalidrawAPI,
  canInsertMedia,
  canEditSlides = canInsertMedia,
  canManageDocs = false,
  onActivateDoc,
  imageStudioSearchFocusRequest,
  resolvePresentationAnimation,
  footer,
  ...boardBrowserProps
}: AppSidebarProps) => {
  const { openSidebar, defaultSidebarDockedPreference } = useUIAppState();
  const editorInterface = useEditorInterface();
  const profileUsername = useCloudProfileUsername();
  const didInitializeSidebarRef = useRef(false);
  const [presentationSession, setPresentationSession] = useState<{
    initialFrameId: string | null;
  } | null>(null);

  useEffect(() => {
    if (!excalidrawAPI || didInitializeSidebarRef.current) {
      return;
    }
    didInitializeSidebarRef.current = true;
    excalidrawAPI.toggleSidebar({ name: null, force: false });
  }, [excalidrawAPI]);

  useEffect(() => {
    if (!excalidrawAPI || !profileUsername) {
      return;
    }
    const docked = readProfileSidebarDockPreference(profileUsername);
    if (excalidrawAPI.getAppState().defaultSidebarDockedPreference !== docked) {
      excalidrawAPI.updateScene({
        appState: { defaultSidebarDockedPreference: docked },
      });
    }
  }, [excalidrawAPI, profileUsername]);

  const keepOpenAfterBoardNavigation =
    defaultSidebarDockedPreference &&
    editorInterface.canFitSidebar &&
    editorInterface.formFactor !== "phone";

  const openBoard = useCallback(
    (slug: string) =>
      openBoardFromSidebar(
        slug,
        boardBrowserProps.onOpen,
        () => excalidrawAPI?.toggleSidebar({ name: null, force: false }),
        keepOpenAfterBoardNavigation,
      ),
    [boardBrowserProps.onOpen, excalidrawAPI, keepOpenAfterBoardNavigation],
  );

  return (
    <>
      <DefaultSidebar.Trigger hidden />
      <DefaultSidebar
        hideLibrary
        headerStart={
          <button
            type="button"
            className="app-sidebar-panel-toggle"
            aria-label="Close workspace panel"
            title="Close workspace panel"
            onClick={() =>
              excalidrawAPI?.toggleSidebar({ name: null, force: false })
            }
          >
            {HamburgerMenuIcon}
          </button>
        }
        onDock={(docked) => {
          if (profileUsername) {
            writeProfileSidebarDockPreference(profileUsername, docked);
          }
        }}
        onStateChange={(state) => {
          if (state?.name === "default") {
            rememberSidebarTab(state.tab);
          }
        }}
      >
        <DefaultSidebar.TabTriggers>
          <Sidebar.TabTrigger
            tab="boards"
            className="app-sidebar-tab-trigger"
            aria-label="Boards"
            title="Boards"
            style={{ opacity: openSidebar?.tab === "boards" ? 1 : 0.4 }}
          >
            {file}
            <span className="app-sidebar-tab-label">Boards</span>
          </Sidebar.TabTrigger>
          {canManageDocs && (
            <Sidebar.TabTrigger
              tab="docs"
              className="app-sidebar-tab-trigger"
              aria-label="Docs"
              title="Docs"
              style={{ opacity: openSidebar?.tab === "docs" ? 1 : 0.4 }}
            >
              {file}
              <span className="app-sidebar-tab-label">Docs</span>
            </Sidebar.TabTrigger>
          )}
          <Sidebar.TabTrigger
            tab="components"
            className="app-sidebar-tab-trigger"
            aria-label="Components"
            title="Components"
            style={{ opacity: openSidebar?.tab === "components" ? 1 : 0.4 }}
          >
            {LibraryIcon}
            <span className="app-sidebar-tab-label">Components</span>
          </Sidebar.TabTrigger>
          <Sidebar.TabTrigger
            tab="image-studio"
            className="app-sidebar-tab-trigger"
            aria-label="Image Studio"
            title="Image Studio"
            style={{ opacity: openSidebar?.tab === "image-studio" ? 1 : 0.4 }}
          >
            {ImageIcon}
            <span className="app-sidebar-tab-label">Images</span>
          </Sidebar.TabTrigger>
          <Sidebar.TabTrigger
            tab="presentation"
            className="app-sidebar-tab-trigger"
            aria-label="Presentation"
            title="Presentation"
            style={{ opacity: openSidebar?.tab === "presentation" ? 1 : 0.4 }}
          >
            {presentationIcon}
            <span className="app-sidebar-tab-label">Present</span>
          </Sidebar.TabTrigger>
        </DefaultSidebar.TabTriggers>
        <Sidebar.Tab tab="boards">
          <BoardBrowser {...boardBrowserProps} onOpen={openBoard} />
        </Sidebar.Tab>
        {canManageDocs && (
          <Sidebar.Tab tab="docs">
            {openSidebar?.tab === "docs" && (
              <DocsPanelContainer onActivate={onActivateDoc} />
            )}
          </Sidebar.Tab>
        )}
        <Sidebar.Tab tab="components">
          {excalidrawAPI && <SavedComponents excalidrawAPI={excalidrawAPI} />}
        </Sidebar.Tab>
        <Sidebar.Tab tab="image-studio">
          {excalidrawAPI && (
            <ImageStudio
              excalidrawAPI={excalidrawAPI}
              canInsert={canInsertMedia}
              searchFocusRequest={imageStudioSearchFocusRequest}
            />
          )}
        </Sidebar.Tab>
        <Sidebar.Tab tab="presentation">
          {excalidrawAPI && (
            <PresentationSidebar
              excalidrawAPI={excalidrawAPI}
              canEdit={canEditSlides}
              onStartPresentation={(initialFrameId) => {
                setPresentationSession({ initialFrameId });
                excalidrawAPI.toggleSidebar({ name: null, force: false });
              }}
            />
          )}
        </Sidebar.Tab>
        {footer && <div className="app-sidebar-footer">{footer}</div>}
      </DefaultSidebar>
      {excalidrawAPI && (
        <PresentationAnimationController
          excalidrawAPI={excalidrawAPI}
          resolvePresentationAnimation={resolvePresentationAnimation}
        />
      )}
      {presentationSession && excalidrawAPI && (
        <PresentationPlayer
          excalidrawAPI={excalidrawAPI}
          initialFrameId={presentationSession.initialFrameId}
          onExit={() => setPresentationSession(null)}
        />
      )}
    </>
  );
};
