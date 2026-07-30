import { useEffect, useMemo, useRef, useState } from "react";

import { DefaultSidebar, Sidebar, THEME } from "@excalidraw/excalidraw";
import {
  file,
  ImageIcon,
  LibraryIcon,
  messageCircleIcon,
  presentationIcon,
  sidebarRightIcon,
} from "@excalidraw/excalidraw/components/icons";
import { LinkButton } from "@excalidraw/excalidraw/components/LinkButton";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { ImageStudio } from "../image-studio/ImageStudio";

import "./AppSidebar.scss";

import { SavedComponents } from "./SavedComponents";

import type { MouseEvent as ReactMouseEvent } from "react";

import type { BoardSort } from "../cloud/boardOrganizer";

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

type SidebarPromoCopyProps = {
  text: string;
};

const SidebarPromoCopy = (props: SidebarPromoCopyProps) => {
  return (
    <div className="app-sidebar-promo-copy">
      <div className="app-sidebar-promo-illustration" aria-hidden="true">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 300 250"
          className="app-sidebar-promo-heart"
        >
          <path
            d="M 145 75
           C 110 35, 60 55, 65 120
           C 70 180, 140 190, 215 200
           C 225 180, 260 110, 235 55
           C 210 -5, 140 20, 160 105"
            fill="none"
            stroke="#D06B64"
            strokeWidth="16"
            strokeLinecap="round"
          />
        </svg>

        <div className="app-sidebar-promo-trial-note excalifont">
          14 days of
          <br />
          free trial
        </div>
        <svg
          className="app-sidebar-promo-trial-arrow"
          viewBox="0 0 72 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M5 6C23 1 50 8 48 32"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M42 26L48 32L54 26"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="app-sidebar-promo-text">{props.text}</div>
    </div>
  );
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
          <span className="board-browser__thumbnail">{file}</span>
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
            <span>{children.length}</span>
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
        <select
          className="board-browser__sort"
          aria-label="Sort boards"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as BoardSort)}
        >
          <option value="modified-desc">Modified: newest</option>
          <option value="modified-asc">Modified: oldest</option>
          <option value="created-desc">Created: newest</option>
          <option value="created-asc">Created: oldest</option>
          <option value="name-asc">Name: A–Z</option>
          <option value="name-desc">Name: Z–A</option>
        </select>
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

export const AppSidebar = ({
  excalidrawAPI,
  canInsertMedia,
  ...boardBrowserProps
}: AppSidebarProps) => {
  const { theme, openSidebar } = useUIAppState();

  return (
    <>
      <DefaultSidebar.Trigger
        tab="boards"
        icon={sidebarRightIcon}
        title="Boards, library, and search"
      />
      <DefaultSidebar>
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
          <Sidebar.TabTrigger
            tab="comments"
            aria-label="Comments"
            title="Comments"
            style={{ opacity: openSidebar?.tab === "comments" ? 1 : 0.4 }}
          >
            {messageCircleIcon}
          </Sidebar.TabTrigger>
          <Sidebar.TabTrigger
            tab="presentation"
            aria-label="Presentation"
            title="Presentation"
            style={{ opacity: openSidebar?.tab === "presentation" ? 1 : 0.4 }}
          >
            {presentationIcon}
          </Sidebar.TabTrigger>
        </DefaultSidebar.TabTriggers>
        <Sidebar.Tab tab="boards">
          <BoardBrowser {...boardBrowserProps} />
        </Sidebar.Tab>
        <Sidebar.Tab tab="components">
          <SavedComponents onAdd={() => undefined} onInsert={() => undefined} />
        </Sidebar.Tab>
        <Sidebar.Tab tab="image-studio">
          {excalidrawAPI && (
            <ImageStudio
              excalidrawAPI={excalidrawAPI}
              canInsert={canInsertMedia}
            />
          )}
        </Sidebar.Tab>
        <Sidebar.Tab tab="comments">
          <div className="app-sidebar-promo-container">
            <div
              className="app-sidebar-promo-image"
              style={{
                ["--image-source" as any]: `url(/sidebar-comments-promo-${
                  theme === THEME.DARK ? "dark" : "light"
                }.jpg)`,
                opacity: 0.9,
              }}
            />
            <SidebarPromoCopy text="Make comments with Excalidraw+" />
            <LinkButton
              href={`${
                import.meta.env.VITE_APP_PLUS_LP
              }/plus?utm_source=excalidraw&utm_medium=app&utm_content=comments_promo#excalidraw-redirect`}
            >
              Sign up now
            </LinkButton>
          </div>
        </Sidebar.Tab>
        <Sidebar.Tab tab="presentation" className="px-3">
          <div className="app-sidebar-promo-container">
            <div
              className="app-sidebar-promo-image"
              style={{
                ["--image-source" as any]: `url(/sidebar-presentation-promo-${
                  theme === THEME.DARK ? "dark" : "light"
                }.jpg)`,
                opacity: 0.7,
              }}
            />
            <SidebarPromoCopy text="Create presentation with Excalidraw+" />
            <LinkButton
              href={`${
                import.meta.env.VITE_APP_PLUS_LP
              }/plus?utm_source=excalidraw&utm_medium=app&utm_content=presentations_promo#excalidraw-redirect`}
            >
              Sign up now
            </LinkButton>
          </div>
        </Sidebar.Tab>
      </DefaultSidebar>
    </>
  );
};
