import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { api } from "../../convex/_generated/api";

import { importImageStudioFile, searchImageStudio } from "./api";
import { insertShape } from "./insertShape";
import { getShape, SHAPE_CATALOG } from "./shapes";

import "./ImageStudio.scss";

import type {
  ImageStudioItem,
  StoredMediaItem,
} from "../../image-studio/types";

type StudioView = "search" | "shapes" | "favorites" | "recent";

type ImageStudioProps = {
  excalidrawAPI: ExcalidrawImperativeAPI;
  canInsert: boolean;
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

const restorePreview = (item: StoredMediaItem): ImageStudioItem => ({
  ...item,
  previewUrl:
    item.previewUrl ??
    (item.provider === "shape"
      ? ""
      : `/api/image-studio/preview/${item.provider}/${encodeURIComponent(
          item.providerId,
        )}`),
});

const ShapePreview = ({ kind }: { kind: string }) => {
  const points =
    kind === "triangle"
      ? "50,10 90,88 10,88"
      : kind === "hexagon"
      ? "25,10 75,10 94,50 75,90 25,90 6,50"
      : "50,5 61,36 95,38 68,58 78,91 50,71 22,91 32,58 5,38 39,36";
  if (kind === "rectangle") {
    return <rect x="10" y="20" width="80" height="60" rx="12" />;
  }
  if (kind === "ellipse") {
    return <ellipse cx="50" cy="50" rx="40" ry="34" />;
  }
  if (kind === "diamond") {
    return <polygon points="50,7 93,50 50,93 7,50" />;
  }
  return <polygon points={points} />;
};

export const ImageStudio = ({ excalidrawAPI, canInsert }: ImageStudioProps) => {
  const [view, setView] = useState<StudioView>("search");
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [results, setResults] = useState<ImageStudioItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [insertingKey, setInsertingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const favorites = useQuery(api.mediaLibrary.listFavorites, {});
  const recent = useQuery(api.mediaLibrary.listRecent, {});
  const toggleFavorite = useMutation(api.mediaLibrary.toggleFavorite);
  const recordRecent = useMutation(api.mediaLibrary.recordRecent);

  const favoriteKeys = useMemo(
    () => new Set((favorites ?? []).map(({ itemKey }) => itemKey)),
    [favorites],
  );
  const shapes = useMemo(
    () => SHAPE_CATALOG.map(({ id, title }) => shapeItem(id, title)),
    [],
  );
  const displayedItems =
    view === "shapes"
      ? shapes
      : view === "favorites"
      ? (favorites ?? []).map(restorePreview)
      : view === "recent"
      ? (recent ?? []).map(restorePreview)
      : results;

  const runSearch = async (append = false) => {
    const nextQuery = append ? searchedQuery : query.trim();
    if (nextQuery.length < 2) {
      setError("Type at least two characters.");
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      const response = await searchImageStudio(
        nextQuery,
        append ? cursor : null,
      );
      setResults((current) =>
        append ? [...current, ...response.results] : response.results,
      );
      setCursor(response.cursor);
      setWarnings(response.warnings.map(({ message }) => message));
      setSearchedQuery(nextQuery);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Image search failed");
    } finally {
      setIsSearching(false);
    }
  };

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
        await excalidrawAPI.insertImages([file]);
      }
      await recordRecent({ item });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add item");
    } finally {
      setInsertingKey(null);
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
              ? `Favorites${favorites?.length ? ` ${favorites.length}` : ""}`
              : "Recent"}
          </button>
        ))}
      </nav>

      {view === "search" && (
        <form
          className="image-studio__search"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <input
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

      {!canInsert && (
        <div className="image-studio__notice">
          Open one of your diagrams to add visuals.
        </div>
      )}
      {warnings.length > 0 && view === "search" && (
        <div className="image-studio__warning">{warnings.join(" ")}</div>
      )}
      {error && <div className="image-studio__error">{error}</div>}

      <div className="image-studio__grid">
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
                    <svg viewBox="0 0 100 100" aria-hidden="true">
                      <ShapePreview kind={catalogShape.preview} />
                    </svg>
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
                onClick={() => void toggleFavorite({ item })}
              >
                {favoriteKeys.has(item.itemKey) ? "★" : "☆"}
              </button>
            </article>
          );
        })}
      </div>

      {displayedItems.length === 0 && (
        <div className="image-studio__empty">
          {view === "search"
            ? "Search once, then add anything from the mixed results."
            : view === "favorites"
            ? "Star an item and it will stay available in every diagram."
            : view === "recent"
            ? "Items you add will appear here across every diagram."
            : "No items found."}
        </div>
      )}
      {view === "search" && cursor && results.length > 0 && (
        <button
          type="button"
          className="image-studio__more"
          disabled={isSearching}
          onClick={() => void runSearch(true)}
        >
          {isSearching ? "Loading…" : "Load more"}
        </button>
      )}
      <footer className="image-studio__footer">
        Graphics via Pixabay · icons via Iconify. Check source details and
        trademarks before publishing.
      </footer>
    </div>
  );
};
