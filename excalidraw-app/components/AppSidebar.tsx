import { useEffect, useMemo, useRef, useState } from "react";

import { DefaultSidebar, Sidebar } from "@excalidraw/excalidraw";
import {
  file,
  ImageIcon,
  LibraryIcon,
  sidebarRightIcon,
} from "@excalidraw/excalidraw/components/icons";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";

import type {
  ExcalidrawImperativeAPI,
  SidebarTabName,
} from "@excalidraw/excalidraw/types";

import { composeBoardSort, splitBoardSort } from "../cloud/boardOrganizer";
import { ImageStudio } from "../image-studio/ImageStudio";

import "./AppSidebar.scss";

import { SavedComponents } from "./SavedComponents";

import type { MouseEvent as ReactMouseEvent } from "react";

import type { BoardSort, BoardSortCategory } from "../cloud/boardOrganizer";

type BoardSummary = {
  _id: string;
  slug: string;
  title: string;
  folderId?: string;
  createdAt: number;
  updatedAt: number;
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
  const sentinelRef = useRef<HTMLDivElement>(null);
  const moveHandleRefs = useRef(new Map<string, HTMLButtonElement>());
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
          onClick={(event) => {
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
                onClick={() =>
                  setOpenFolderMenuId((current) =>
                    current === folder._id ? null : folder._id,
                  )
                }
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
    <div className="board-browser">
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
    </div>
  );
};

const APP_SIDEBAR_LAUNCHERS = [
  { tab: "boards", label: "Boards", icon: file },
  { tab: "components", label: "Components", icon: LibraryIcon },
  { tab: "image-studio", label: "Image Studio", icon: ImageIcon },
] as const;

const LAST_APP_SIDEBAR_TAB_STORAGE_KEY =
  "yaseen-whiteboard-last-sidebar-section";

const APP_SIDEBAR_TABS = new Set<SidebarTabName>([
  "boards",
  "components",
  "image-studio",
  "library",
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
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}) => {
  const { openSidebar } = useUIAppState();
  const activeTab =
    openSidebar?.name === "default" ? openSidebar.tab ?? "boards" : null;

  const open = (tab: SidebarTabName) => {
    excalidrawAPI?.toggleSidebar({
      name: "default",
      tab,
      force: true,
    });
  };

  return (
    <nav className="app-sidebar-launchers" aria-label="Workspace panels">
      <div className="app-sidebar-launchers__direct">
        {APP_SIDEBAR_LAUNCHERS.map((launcher) => (
          <button
            key={launcher.tab}
            type="button"
            className="app-sidebar-launcher"
            aria-label={launcher.label}
            aria-pressed={activeTab === launcher.tab}
            title={launcher.label}
            disabled={!excalidrawAPI}
            onClick={() => open(launcher.tab)}
          >
            {launcher.icon}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="app-sidebar-launcher app-sidebar-launchers__compact"
        aria-label="Open workspace panel"
        aria-pressed={openSidebar?.name === "default"}
        title="Boards, Components, and Image Studio"
        disabled={!excalidrawAPI}
        onClick={() => open(activeTab ?? getRememberedSidebarTab())}
      >
        {sidebarRightIcon}
      </button>
    </nav>
  );
};

export const AppSidebar = ({
  excalidrawAPI,
  canInsertMedia,
  ...boardBrowserProps
}: AppSidebarProps) => {
  const { openSidebar } = useUIAppState();
  const didInitializeSidebarRef = useRef(false);

  useEffect(() => {
    if (!excalidrawAPI || didInitializeSidebarRef.current) {
      return;
    }
    didInitializeSidebarRef.current = true;
    excalidrawAPI.toggleSidebar({ name: null, force: false });
  }, [excalidrawAPI]);

  return (
    <>
      <DefaultSidebar.Trigger
        tab="boards"
        icon={sidebarRightIcon}
        title="Boards, library, and search"
        className="app-sidebar-generic-trigger"
      />
      <DefaultSidebar
        onStateChange={(state) => {
          if (state?.name === "default") {
            rememberSidebarTab(state.tab);
          }
        }}
      >
        <DefaultSidebar.TabTriggers>
          <Sidebar.TabTrigger
            tab="boards"
            aria-label="Boards"
            title="Boards"
            style={{ opacity: openSidebar?.tab === "boards" ? 1 : 0.4 }}
          >
            {file}
          </Sidebar.TabTrigger>
          <Sidebar.TabTrigger
            tab="components"
            aria-label="Components"
            title="Components"
            style={{ opacity: openSidebar?.tab === "components" ? 1 : 0.4 }}
          >
            {LibraryIcon}
          </Sidebar.TabTrigger>
          <Sidebar.TabTrigger
            tab="image-studio"
            aria-label="Image Studio"
            title="Image Studio"
            style={{ opacity: openSidebar?.tab === "image-studio" ? 1 : 0.4 }}
          >
            {ImageIcon}
          </Sidebar.TabTrigger>
        </DefaultSidebar.TabTriggers>
        <Sidebar.Tab tab="boards">
          <BoardBrowser {...boardBrowserProps} />
        </Sidebar.Tab>
        <Sidebar.Tab tab="components">
          {excalidrawAPI && <SavedComponents excalidrawAPI={excalidrawAPI} />}
        </Sidebar.Tab>
        <Sidebar.Tab tab="image-studio">
          {excalidrawAPI && (
            <ImageStudio
              excalidrawAPI={excalidrawAPI}
              canInsert={canInsertMedia}
            />
          )}
        </Sidebar.Tab>
      </DefaultSidebar>
    </>
  );
};
