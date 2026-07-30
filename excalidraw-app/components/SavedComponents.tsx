import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery_experimental,
} from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  useLibraryCache,
  useLibraryItemSvg,
} from "@excalidraw/excalidraw/hooks/useLibraryItemSvg";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { LibraryItem } from "@excalidraw/excalidraw/types";

import { api } from "../../convex/_generated/api";

import "./SavedComponents.scss";

import type { Id } from "../../convex/_generated/dataModel";

const PAGE_SIZE = 24;

export type SavedComponentSummary = {
  _id: string;
  _creationTime: number;
  name: string;
  normalizedName: string;
  elementsJson: string;
  elementCount: number;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
};

type SavedComponentsInventoryProps = {
  authState: "loading" | "signed-out" | "authenticated";
  components: SavedComponentSummary[];
  query: string;
  queryStatus: "loading" | "success" | "error";
  queryError: string | null;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  onQueryChange: (query: string) => void;
  onRetryQuery: () => void;
  onLoadMore: () => void;
  onAdd: () => void;
  onInsert: (component: SavedComponentSummary) => void;
  onRename: (component: SavedComponentSummary, name: string) => Promise<void>;
  onDelete: (component: SavedComponentSummary) => Promise<void>;
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const parsePreviewElements = (
  component: SavedComponentSummary,
): LibraryItem["elements"] | undefined => {
  try {
    const payload = JSON.parse(component.elementsJson) as {
      elements?: ExcalidrawElement[];
    };
    if (!Array.isArray(payload.elements)) {
      return undefined;
    }
    return payload.elements.filter(
      (element) => !element.isDeleted,
    ) as LibraryItem["elements"];
  } catch {
    return undefined;
  }
};

const SavedComponentPreview = ({
  component,
}: {
  component: SavedComponentSummary;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const { svgCache } = useLibraryCache();
  const elements = useMemo(() => parsePreviewElements(component), [component]);
  useLibraryItemSvg(component._id, elements, svgCache, ref);

  return (
    <div
      ref={ref}
      className="saved-components__preview"
      aria-label={`Preview of ${component.name}`}
      role="img"
    />
  );
};

export const SavedComponentsInventory = ({
  authState,
  components,
  query,
  queryStatus,
  queryError,
  canLoadMore,
  isLoadingMore,
  onQueryChange,
  onRetryQuery,
  onLoadMore,
  onAdd,
  onInsert,
  onRename,
  onDelete,
}: SavedComponentsInventoryProps) => {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    message: string;
    retryLabel: string;
    retry: () => Promise<void>;
  } | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      !sentinel ||
      !canLoadMore ||
      isLoadingMore ||
      typeof IntersectionObserver === "undefined"
    ) {
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

  const runAction = async ({
    component,
    label,
    retryLabel,
    action,
  }: {
    component: SavedComponentSummary;
    label: string;
    retryLabel: string;
    action: () => Promise<void>;
  }) => {
    setPendingId(component._id);
    setActionError(null);
    try {
      await action();
      setLiveMessage(label);
    } catch (error) {
      setActionError({
        message: getErrorMessage(error, `${label} failed`),
        retryLabel,
        retry: action,
      });
    } finally {
      setPendingId(null);
    }
  };

  const retryAction = async () => {
    if (!actionError) {
      return;
    }
    const retry = actionError.retry;
    setActionError(null);
    try {
      await retry();
    } catch (error) {
      setActionError({
        message: getErrorMessage(error, "The action could not be completed"),
        retryLabel: actionError.retryLabel,
        retry,
      });
    }
  };

  if (authState === "loading") {
    return (
      <div className="saved-components saved-components__state">
        Connecting to your components…
      </div>
    );
  }

  if (authState === "signed-out") {
    return (
      <div className="saved-components saved-components__state">
        Sign in to access your saved components.
      </div>
    );
  }

  return (
    <section className="saved-components" aria-labelledby="components-heading">
      <header className="saved-components__header">
        <div>
          <h2 id="components-heading">Components</h2>
          <span>
            {components.length} saved component
            {components.length === 1 ? "" : "s"}
          </span>
        </div>
        <button type="button" onClick={onAdd}>
          Add
          <span className="visually-hidden"> component</span>
        </button>
      </header>

      <input
        type="search"
        className="saved-components__search"
        value={query}
        aria-label="Search components"
        placeholder="Search components"
        onChange={(event) => onQueryChange(event.target.value)}
      />

      {(queryError || actionError) && (
        <div className="saved-components__error" role="alert">
          <span>{queryError ?? actionError?.message}</span>
          <button
            type="button"
            onClick={queryError ? onRetryQuery : retryAction}
            aria-label={
              queryError ? "Retry" : `Retry ${actionError?.retryLabel}`
            }
          >
            Retry
          </button>
        </div>
      )}

      <div className="visually-hidden" aria-live="polite">
        {liveMessage}
      </div>

      <div className="saved-components__content">
        {queryStatus === "loading" && components.length === 0 ? (
          <div className="saved-components__state">Loading components…</div>
        ) : queryStatus === "error" &&
          components.length === 0 ? null : components.length === 0 ? (
          <div className="saved-components__state">
            {query
              ? `No components match “${query}”`
              : "No saved components yet"}
          </div>
        ) : (
          <div className="saved-components__grid">
            {components.map((component) => (
              <article
                key={component._id}
                className="saved-components__card"
                aria-busy={pendingId === component._id}
              >
                <button
                  type="button"
                  className="saved-components__insert"
                  aria-label={`Insert ${component.name}`}
                  onClick={() => onInsert(component)}
                >
                  <SavedComponentPreview component={component} />
                  <span title={component.name}>{component.name}</span>
                </button>
                <button
                  type="button"
                  className="saved-components__options"
                  aria-label={`Options for ${component.name}`}
                  aria-expanded={openMenuId === component._id}
                  onClick={() =>
                    setOpenMenuId((current) =>
                      current === component._id ? null : component._id,
                    )
                  }
                >
                  ⋯
                </button>
                {openMenuId === component._id && (
                  <div className="saved-components__menu">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuId(null);
                        const name = window.prompt(
                          "Rename component",
                          component.name,
                        );
                        if (name === null || name === component.name) {
                          return;
                        }
                        void runAction({
                          component,
                          label: `${component.name} renamed`,
                          retryLabel: "rename",
                          action: () => onRename(component, name),
                        });
                      }}
                    >
                      Rename
                      <span className="visually-hidden"> {component.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuId(null);
                        if (
                          !window.confirm(
                            `Delete “${component.name}”? This cannot be undone.`,
                          )
                        ) {
                          return;
                        }
                        void runAction({
                          component,
                          label: `${component.name} deleted`,
                          retryLabel: "delete",
                          action: () => onDelete(component),
                        });
                      }}
                    >
                      Delete
                      <span className="visually-hidden"> {component.name}</span>
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        <div ref={sentinelRef} className="saved-components__sentinel" />
        {isLoadingMore && (
          <div className="saved-components__loading-more">
            Loading more components…
          </div>
        )}
      </div>
    </section>
  );
};

export const SavedComponents = ({
  onAdd,
  onInsert,
}: {
  onAdd: () => void;
  onInsert: (component: SavedComponentSummary) => void;
}) => {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [query, setQuery] = useState("");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const renameComponent = useMutation(api.savedComponents.rename);
  const deleteComponent = useMutation(api.savedComponents.remove);
  const pagination = usePaginatedQuery_experimental({
    query: api.savedComponents.search,
    args: isAuthenticated
      ? { query: `${query}${" ".repeat(retryAttempt)}` }
      : "skip",
    initialNumItems: PAGE_SIZE,
  });
  const components = (pagination.data ?? []) as SavedComponentSummary[];

  return (
    <SavedComponentsInventory
      authState={
        isLoading ? "loading" : isAuthenticated ? "authenticated" : "signed-out"
      }
      components={components}
      query={query}
      queryStatus={
        pagination.status === "pending"
          ? "loading"
          : pagination.status === "error"
          ? "error"
          : "success"
      }
      queryError={
        pagination.status === "error"
          ? getErrorMessage(pagination.error, "Components could not be loaded.")
          : null
      }
      canLoadMore={pagination.canLoadMore}
      isLoadingMore={
        pagination.status === "pending" && pagination.data !== undefined
      }
      onQueryChange={(nextQuery) => {
        setRetryAttempt(0);
        setQuery(nextQuery);
      }}
      onRetryQuery={() => setRetryAttempt((attempt) => attempt + 1)}
      onLoadMore={() => pagination.loadMore(PAGE_SIZE)}
      onAdd={onAdd}
      onInsert={onInsert}
      onRename={async (component, name) => {
        await renameComponent({
          componentId: component._id as Id<"savedComponents">,
          name,
        });
      }}
      onDelete={async (component) => {
        await deleteComponent({
          componentId: component._id as Id<"savedComponents">,
        });
      }}
    />
  );
};
