import { useMutation, useQuery } from "convex/react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { IMAGE_STUDIO_INSERTION } from "@excalidraw/excalidraw/data/viewportInsertion";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { api } from "../../convex/_generated/api";

import { importImageStudioFile, searchImageStudio } from "./api";
import { insertShape } from "./insertShape";
import { normalizeMediaItem } from "./mediaItem";
import { filterShapeCatalog, getShape, getSmartShapePreview } from "./shapes";

import "./ImageStudio.scss";

import type {
  ImageStudioItem,
  ImageStudioSearchSource,
  StoredMediaItem,
} from "../../image-studio/types";

type StudioView = "search" | "shapes" | "favorites" | "recent";

type ImageStudioProps = {
  excalidrawAPI: ExcalidrawImperativeAPI;
  canInsert: boolean;
  searchFocusRequest?: number;
};

const shapeItem = (id: string, title: string): ImageStudioItem => ({
  itemKey: `shape:${id}`,
  provider: "shape",
  providerId: id,
  kind: "shape",
  title,
  previewUrl: "",
  collectionName: "Shapes",
});

const dedupeItems = (items: ImageStudioItem[]) => [
  ...new Map(items.map((item) => [item.itemKey, item])).values(),
];

const hasAdvancedCursor = (current: string, next: string | null) => {
  if (next === null) {
    return true;
  }
  const currentPage = Number(current);
  const nextPage = Number(next);
  if (Number.isSafeInteger(currentPage) && Number.isSafeInteger(nextPage)) {
    return nextPage > currentPage;
  }
  return next !== current;
};

const restorePreview = (item: StoredMediaItem): ImageStudioItem => {
  const normalized = normalizeMediaItem(item);
  return {
    ...normalized,
    previewUrl:
      normalized.previewUrl ??
      (item.provider === "shape"
        ? ""
        : `/api/image-studio/preview/${item.provider}/${encodeURIComponent(
            item.providerId,
          )}`),
  };
};

const ShapePreview = ({ kind }: { kind: string }) => {
  const smartShape = getSmartShapePreview(kind);
  if (smartShape) {
    return (
      <svg viewBox={smartShape.viewBox} aria-hidden="true">
        {smartShape.closed ? (
          <polygon
            className="image-studio__shape-path--closed"
            points={smartShape.points}
          />
        ) : (
          <polyline
            className="image-studio__shape-path--open"
            points={smartShape.points}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    );
  }
  const points =
    kind === "triangle"
      ? "50,10 90,88 10,88"
      : kind === "hexagon"
      ? "25,10 75,10 94,50 75,90 25,90 6,50"
      : "50,5 61,36 95,38 68,58 78,91 50,71 22,91 32,58 5,38 39,36";
  if (kind === "rectangle") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <rect
          className="image-studio__shape-path--basic"
          x="10"
          y="20"
          width="80"
          height="60"
          rx="12"
        />
      </svg>
    );
  }
  if (kind === "ellipse") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <ellipse
          className="image-studio__shape-path--basic"
          cx="50"
          cy="50"
          rx="40"
          ry="34"
        />
      </svg>
    );
  }
  if (kind === "diamond") {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <polygon
          className="image-studio__shape-path--basic"
          points="50,7 93,50 50,93 7,50"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <polygon className="image-studio__shape-path--basic" points={points} />
    </svg>
  );
};

export const ImageStudio = ({
  excalidrawAPI,
  canInsert,
  searchFocusRequest = 0,
}: ImageStudioProps) => {
  const [view, setView] = useState<StudioView>("search");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<ImageStudioSearchSource>("all");
  const [shapeQuery, setShapeQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [results, setResults] = useState<ImageStudioItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [insertingKey, setInsertingKey] = useState<string | null>(null);
  const [removingFavoriteKey, setRemovingFavoriteKey] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const searchRequestId = useRef(0);
  const searchRequestInFlight = useRef(false);
  const requestedCursors = useRef(new Set<string>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchGridRef = useRef<HTMLDivElement>(null);
  const searchSentinelRef = useRef<HTMLDivElement>(null);
  const loadNextPageRef = useRef<() => void>(() => {});
  const favorites = useQuery(api.mediaLibrary.listFavorites, {});
  const recent = useQuery(api.mediaLibrary.listRecent, {});
  const addFavorite = useMutation(api.mediaLibrary.addFavorite);
  const removeFavorite = useMutation(api.mediaLibrary.removeFavorite);
  const recordRecent = useMutation(api.mediaLibrary.recordRecent);

  const favoriteKeys = useMemo(
    () => new Set((favorites ?? []).map(({ itemKey }) => itemKey)),
    [favorites],
  );
  const shapes = useMemo(
    () =>
      filterShapeCatalog(shapeQuery).map(({ id, title }) =>
        shapeItem(id, title),
      ),
    [shapeQuery],
  );
  const displayedItems =
    view === "shapes"
      ? shapes
      : view === "favorites"
      ? (favorites ?? []).map(restorePreview)
      : view === "recent"
      ? (recent ?? []).map(restorePreview)
      : results;

  useEffect(() => {
    if (searchFocusRequest > 0) {
      setView("search");
    }
  }, [searchFocusRequest]);

  useEffect(() => {
    if (searchFocusRequest > 0 && view === "search") {
      searchInputRef.current?.focus();
    }
  }, [searchFocusRequest, view]);

  const runSearch = async ({
    append = false,
    retry = false,
    nextQuery = append ? searchedQuery : query.trim(),
    nextSource = source,
  }: {
    append?: boolean;
    retry?: boolean;
    nextQuery?: string;
    nextSource?: ImageStudioSearchSource;
  } = {}) => {
    if (nextQuery.length < 2) {
      setError("Type at least two characters.");
      return;
    }
    const requestedCursor = append ? cursor : null;
    if (
      append &&
      (!requestedCursor ||
        searchRequestInFlight.current ||
        (!retry && requestedCursors.current.has(requestedCursor)))
    ) {
      return;
    }
    const requestId = append
      ? searchRequestId.current
      : ++searchRequestId.current;
    searchRequestInFlight.current = true;
    setIsSearching(true);
    if (append) {
      requestedCursors.current.add(requestedCursor!);
      setPageError(null);
    } else {
      requestedCursors.current.clear();
      setError(null);
      setPageError(null);
      setResults([]);
      setCursor(null);
      setWarnings([]);
      setSearchedQuery(nextQuery);
    }
    try {
      const response = await searchImageStudio(
        nextQuery,
        nextSource,
        requestedCursor,
      );
      if (requestId !== searchRequestId.current) {
        return;
      }
      setResults((current) =>
        dedupeItems(
          append ? [...current, ...response.results] : response.results,
        ),
      );
      if (
        append &&
        requestedCursor &&
        !hasAdvancedCursor(requestedCursor, response.cursor)
      ) {
        setPageError(
          "Loading stopped because the next results page did not advance.",
        );
        return;
      }
      setCursor(response.cursor);
      setWarnings(response.warnings.map(({ message }) => message));
    } catch (cause) {
      if (requestId !== searchRequestId.current) {
        return;
      }
      const message =
        cause instanceof Error ? cause.message : "Image search failed";
      if (append) {
        setPageError(message);
      } else {
        setError(message);
      }
    } finally {
      if (requestId === searchRequestId.current) {
        searchRequestInFlight.current = false;
        setIsSearching(false);
      }
    }
  };

  loadNextPageRef.current = () => {
    void runSearch({ append: true });
  };

  useEffect(() => {
    const sentinel = searchSentinelRef.current;
    if (
      view !== "search" ||
      !cursor ||
      pageError ||
      isSearching ||
      requestedCursors.current.has(cursor) ||
      !sentinel ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadNextPageRef.current();
        }
      },
      {
        root: searchGridRef.current,
        rootMargin: "160px 0px",
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, isSearching, pageError, view]);

  const addItem = async (item: ImageStudioItem) => {
    if (!canInsert || insertingKey) {
      return;
    }
    setInsertingKey(item.itemKey);
    setError(null);
    try {
      if (item.provider === "shape") {
        const shape = getShape(item.providerId);
        if (!shape) {
          throw new Error("Shape not found");
        }
        insertShape(excalidrawAPI, shape);
      } else {
        const file = await importImageStudioFile(item);
        await excalidrawAPI.insertImages([file], undefined, undefined, {
          viewportSizing: IMAGE_STUDIO_INSERTION,
        });
      }
      await recordRecent({ item: normalizeMediaItem(item) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add item");
    } finally {
      setInsertingKey(null);
    }
  };

  const removeFavoriteItem = async (item: ImageStudioItem) => {
    if (removingFavoriteKey) {
      return;
    }
    setRemovingFavoriteKey(item.itemKey);
    setError(null);
    try {
      await removeFavorite({ itemKey: item.itemKey });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not remove favorite",
      );
    } finally {
      setRemovingFavoriteKey(null);
    }
  };

  return (
    <div className="image-studio">
      <header className="image-studio__header">
        <div>
          <span>IMAGE STUDIO</span>
          <strong>Add visuals</strong>
        </div>
      </header>
      <nav className="image-studio__nav" aria-label="Image Studio sections">
        {(["search", "shapes", "favorites", "recent"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            className={view === tab ? "is-active" : undefined}
            onClick={() => setView(tab)}
          >
            {tab === "search"
              ? "Search"
              : tab === "shapes"
              ? "Shapes"
              : tab === "favorites"
              ? "Favorites"
              : "Recent"}
          </button>
        ))}
      </nav>

      {view === "search" && (
        <form
          className="image-studio__search"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch({});
          }}
        >
          <select
            aria-label="Search source"
            value={source}
            onChange={(event) => {
              const nextSource = event.target.value as ImageStudioSearchSource;
              setSource(nextSource);
              if (searchedQuery) {
                void runSearch({
                  nextQuery: searchedQuery,
                  nextSource,
                });
              }
            }}
          >
            <option value="all">All</option>
            <option value="iconify">Iconify</option>
            <option value="pixabay">Pixabay</option>
          </select>
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Search graphics, icons, and logos"
            placeholder="Search graphics, icons, and logos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={isSearching}>
            {isSearching ? "…" : "Search"}
          </button>
        </form>
      )}
      {view === "shapes" && (
        <div className="image-studio__search">
          <input
            type="search"
            aria-label="Search shapes"
            placeholder="Search shapes"
            value={shapeQuery}
            onChange={(event) => setShapeQuery(event.target.value)}
          />
        </div>
      )}

      {!canInsert && (
        <div className="image-studio__notice">
          Open one of your boards to add visuals.
        </div>
      )}
      {warnings.length > 0 && view === "search" && (
        <div className="image-studio__warning">{warnings.join(" ")}</div>
      )}
      {error && <div className="image-studio__error">{error}</div>}

      <div className="image-studio__grid" ref={searchGridRef}>
        {displayedItems.map((item) => {
          const catalogShape =
            item.provider === "shape" ? getShape(item.providerId) : undefined;
          return (
            <article className="image-studio__card" key={item.itemKey}>
              <button
                type="button"
                className="image-studio__add"
                disabled={!canInsert || insertingKey !== null}
                onClick={() => void addItem(item)}
                aria-label={`Add ${item.title}`}
              >
                <span className="image-studio__preview">
                  {catalogShape ? (
                    <ShapePreview kind={catalogShape.preview} />
                  ) : (
                    <img src={item.previewUrl} alt="" loading="lazy" />
                  )}
                  {insertingKey === item.itemKey && (
                    <span className="image-studio__adding">Adding…</span>
                  )}
                </span>
                <span className="image-studio__meta">
                  <strong>{item.title}</strong>
                  <small>
                    {item.kind}
                    {item.collectionName ? ` · ${item.collectionName}` : ""}
                  </small>
                </span>
              </button>
              {view === "favorites" ? (
                <DropdownMenuPrimitive.Root>
                  <DropdownMenuPrimitive.Trigger asChild>
                    <button
                      type="button"
                      className="image-studio__favorite-menu-trigger"
                      aria-label={`More options for ${item.title}`}
                      disabled={removingFavoriteKey !== null}
                    >
                      •••
                    </button>
                  </DropdownMenuPrimitive.Trigger>
                  <DropdownMenuPrimitive.Portal>
                    <DropdownMenuPrimitive.Content
                      className="image-studio__favorite-menu"
                      align="end"
                      sideOffset={6}
                    >
                      <DropdownMenuPrimitive.Item
                        className="image-studio__favorite-menu-item"
                        disabled={removingFavoriteKey !== null}
                        onSelect={() => void removeFavoriteItem(item)}
                      >
                        {removingFavoriteKey === item.itemKey
                          ? "Removing…"
                          : "Remove from favorites"}
                      </DropdownMenuPrimitive.Item>
                    </DropdownMenuPrimitive.Content>
                  </DropdownMenuPrimitive.Portal>
                </DropdownMenuPrimitive.Root>
              ) : (
                <button
                  type="button"
                  className={
                    favoriteKeys.has(item.itemKey)
                      ? "image-studio__favorite is-active"
                      : "image-studio__favorite"
                  }
                  aria-label={
                    favoriteKeys.has(item.itemKey)
                      ? `Remove ${item.title} from favorites`
                      : `Add ${item.title} to favorites`
                  }
                  disabled={removingFavoriteKey !== null}
                  onClick={() => {
                    if (favoriteKeys.has(item.itemKey)) {
                      void removeFavoriteItem(item);
                    } else {
                      void addFavorite({ item: normalizeMediaItem(item) });
                    }
                  }}
                >
                  {favoriteKeys.has(item.itemKey) ? "★" : "☆"}
                </button>
              )}
            </article>
          );
        })}
        {view === "search" && cursor && results.length > 0 && (
          <div
            className="image-studio__search-sentinel"
            ref={searchSentinelRef}
            aria-hidden="true"
          />
        )}
      </div>

      {displayedItems.length === 0 && (
        <div className="image-studio__empty">
          {view === "search"
            ? "Search once, then add anything from the mixed results."
            : view === "favorites"
            ? "Star an item and it will stay available in every board."
            : view === "recent"
            ? "Items you add will appear here across every board."
            : shapeQuery
            ? "No shapes match your search."
            : "No items found."}
        </div>
      )}
      {view === "search" && pageError && cursor && (
        <>
          <div className="image-studio__error" role="alert">
            {pageError}
          </div>
          <button
            type="button"
            className="image-studio__retry"
            disabled={isSearching}
            onClick={() => void runSearch({ append: true, retry: true })}
          >
            {isSearching ? "Retrying…" : "Retry loading results"}
          </button>
        </>
      )}
      {view === "search" && isSearching && results.length > 0 && (
        <div className="image-studio__loading-more" role="status">
          Loading more…
        </div>
      )}
      <footer className="image-studio__footer">
        Graphics via Pixabay · icons via Iconify. Check source details and
        trademarks before publishing.
      </footer>
    </div>
  );
};
