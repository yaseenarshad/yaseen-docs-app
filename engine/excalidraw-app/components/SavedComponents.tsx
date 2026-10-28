import {
  useConvexAuth,
  useConvex,
  useMutation,
  usePaginatedQuery_experimental,
} from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import {
  useLibraryCache,
  useLibraryItemSvg,
} from "@excalidraw/excalidraw/hooks/useLibraryItemSvg";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
  LibraryItem,
} from "@excalidraw/excalidraw/types";

import { api } from "../../convex/_generated/api";

import "./SavedComponents.scss";

import {
  captureSavedComponentSelectionWithFiles,
  insertSavedComponent,
  parseImportedComponentJson,
} from "./SavedComponentsData";
import {
  cleanupComponentAssets,
  insertRemoteSavedComponent,
  saveSavedComponent,
} from "./SavedComponentsAssets";
import { createSavedComponentPreview } from "./SavedComponentPreview";

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
  preview?: {
    mimeType: string;
    size: number;
    width: number;
    height: number;
    url: string;
  };
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
  canSaveSelection: boolean;
  onQueryChange: (query: string) => void;
  onRetryQuery: () => void;
  onLoadMore: () => void;
  onSaveSelection: () => void;
  onImportJson: () => void;
  onInsert: (component: SavedComponentSummary) => Promise<void>;
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

const SavedComponentElementsPreview = ({
  id,
  name,
  elements,
}: {
  id: string | null;
  name: string;
  elements: LibraryItem["elements"] | undefined;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const { svgCache } = useLibraryCache();
  useLibraryItemSvg(id, elements, svgCache, ref);

  return (
    <div
      ref={ref}
      className="saved-components__preview"
      aria-label={`Preview of ${name}`}
      role="img"
    />
  );
};

const SavedComponentPreview = ({
  component,
}: {
  component: SavedComponentSummary;
}) => {
  const elements = useMemo(() => parsePreviewElements(component), [component]);
  if (component.preview) {
    return (
      <div
        className="saved-components__preview"
        aria-label={`Preview of ${component.name}`}
        role="img"
      >
        <img src={component.preview.url} alt="" loading="lazy" />
      </div>
    );
  }
  return (
    <SavedComponentElementsPreview
      id={component._id}
      name={component.name}
      elements={elements}
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
  canSaveSelection,
  onQueryChange,
  onRetryQuery,
  onLoadMore,
  onSaveSelection,
  onImportJson,
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
        <div className="saved-components__create-actions">
          <button
            type="button"
            onClick={onSaveSelection}
            disabled={!canSaveSelection}
          >
            Save selection
          </button>
          <button type="button" onClick={onImportJson}>
            Import JSON
          </button>
        </div>
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
                  onClick={() => {
                    void runAction({
                      component,
                      label: `${component.name} inserted`,
                      retryLabel: "insert",
                      action: () => onInsert(component),
                    });
                  }}
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

export type CreationDialogState =
  | {
      mode: "selection";
      elements: readonly ExcalidrawElement[] | undefined;
      files: BinaryFiles;
      error: string | null;
    }
  | {
      mode: "import";
      elements: readonly ExcalidrawElement[] | undefined;
      error: string | null;
      source: string;
    };

export const SavedComponentCreationDialog = ({
  state,
  onStateChange,
  onClose,
  onCreate,
}: {
  state: CreationDialogState;
  onStateChange: (state: CreationDialogState) => void;
  onClose: () => void;
  onCreate: (
    name: string,
    elements: readonly ExcalidrawElement[],
    files?: BinaryFiles,
  ) => Promise<void>;
}) => {
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const previewElements = state.elements?.filter(
    (element) => !element.isDeleted,
  ) as LibraryItem["elements"] | undefined;

  const updateImportSource = (source: string) => {
    if (state.mode !== "import") {
      return;
    }
    if (!source.trim()) {
      onStateChange({
        mode: "import",
        source,
        elements: undefined,
        error: null,
      });
      return;
    }
    try {
      onStateChange({
        mode: "import",
        source,
        elements: parseImportedComponentJson(source),
        error: null,
      });
    } catch (error) {
      onStateChange({
        mode: "import",
        source,
        elements: undefined,
        error: getErrorMessage(error, "This JSON cannot be imported"),
      });
    }
  };

  return (
    <Dialog
      title={
        state.mode === "selection"
          ? "Save selection as a component"
          : "Import component JSON"
      }
      size="small"
      onCloseRequest={onClose}
      closeOnClickOutside={false}
    >
      <form
        className="saved-components-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!state.elements || !name.trim()) {
            return;
          }
          setIsSaving(true);
          setSaveError(null);
          void onCreate(
            name,
            state.elements,
            state.mode === "selection" ? state.files : undefined,
          )
            .then(onClose)
            .catch((error) => {
              setSaveError(
                getErrorMessage(error, "The component could not be saved"),
              );
            })
            .finally(() => setIsSaving(false));
        }}
      >
        {state.mode === "import" && (
          <label>
            Component JSON
            <textarea
              aria-label="Component JSON"
              value={state.source}
              placeholder="Paste Excalidraw clipboard, scene, Library, or component JSON"
              onChange={(event) => updateImportSource(event.target.value)}
              rows={9}
            />
          </label>
        )}

        {(state.error || saveError) && (
          <div className="saved-components-dialog__error" role="alert">
            {state.error ?? saveError}
          </div>
        )}

        {previewElements && (
          <SavedComponentElementsPreview
            id={null}
            name={name.trim() || "new component"}
            elements={previewElements}
          />
        )}

        <label>
          Name
          <input
            value={name}
            maxLength={120}
            required
            aria-label="Component name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <div className="saved-components-dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!state.elements || !name.trim() || isSaving}
          >
            {isSaving ? "Saving…" : "Save component"}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export const SavedComponents = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const convex = useConvex();
  const appState = useUIAppState();
  const [query, setQuery] = useState("");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [creationDialog, setCreationDialog] =
    useState<CreationDialogState | null>(null);
  const renameComponent = useMutation(api.savedComponents.rename);
  const deleteComponent = useMutation(api.savedComponents.remove);
  const createComponent = useMutation(api.savedComponents.create);
  const createDraft = useMutation(api.savedComponents.createDraft);
  const createAssetUploadGrant = useMutation(
    api.savedComponents.createAssetUploadGrant,
  );
  const createPreviewUploadGrant = useMutation(
    api.savedComponents.createPreviewUploadGrant,
  );
  const registerAssetUpload = useMutation(
    api.savedComponents.registerAssetUpload,
  );
  const registerPreviewUpload = useMutation(
    api.savedComponents.registerPreviewUpload,
  );
  const finalizeDraft = useMutation(api.savedComponents.finalizeDraft);
  const cleanupAbandonedDrafts = useMutation(
    api.savedComponents.cleanupAbandonedDrafts,
  );
  const pendingDeleteTokensRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    void cleanupAbandonedDrafts({})
      .then(async ({ assetDeleteToken }) => {
        if (assetDeleteToken) {
          await cleanupComponentAssets(assetDeleteToken);
        }
      })
      .catch((error) => {
        console.warn("Could not clean up abandoned component images", error);
      });
  }, [cleanupAbandonedDrafts, isAuthenticated]);
  const pagination = usePaginatedQuery_experimental({
    query: api.savedComponents.search,
    args: isAuthenticated
      ? { query: `${query}${" ".repeat(retryAttempt)}` }
      : "skip",
    initialNumItems: PAGE_SIZE,
  });
  const components = (pagination.data ?? []) as SavedComponentSummary[];

  return (
    <>
      <SavedComponentsInventory
        authState={
          isLoading
            ? "loading"
            : isAuthenticated
            ? "authenticated"
            : "signed-out"
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
            ? getErrorMessage(
                pagination.error,
                "Components could not be loaded.",
              )
            : null
        }
        canLoadMore={pagination.canLoadMore}
        isLoadingMore={
          pagination.status === "pending" && pagination.data !== undefined
        }
        canSaveSelection={Object.keys(appState.selectedElementIds).length > 0}
        onQueryChange={(nextQuery) => {
          setRetryAttempt(0);
          setQuery(nextQuery);
        }}
        onRetryQuery={() => setRetryAttempt((attempt) => attempt + 1)}
        onLoadMore={() => pagination.loadMore(PAGE_SIZE)}
        onSaveSelection={() => {
          try {
            const captured =
              captureSavedComponentSelectionWithFiles(excalidrawAPI);
            setCreationDialog({
              mode: "selection",
              elements: captured.elements,
              files: captured.files,
              error: null,
            });
          } catch (error) {
            setCreationDialog({
              mode: "selection",
              elements: undefined,
              files: {},
              error: getErrorMessage(
                error,
                "The selection cannot be saved as a component",
              ),
            });
          }
        }}
        onImportJson={() =>
          setCreationDialog({
            mode: "import",
            source: "",
            elements: undefined,
            error: null,
          })
        }
        onInsert={async (component) => {
          if (component.preview) {
            await insertRemoteSavedComponent(component._id, excalidrawAPI, {
              getManifest: async ({ componentId }) =>
                await convex.query(api.savedComponents.getAssetManifest, {
                  componentId: componentId as Id<"savedComponents">,
                }),
            });
          } else {
            insertSavedComponent(excalidrawAPI, component.elementsJson);
          }
          excalidrawAPI.setToast({
            message: `${component.name} inserted`,
          });
        }}
        onRename={async (component, name) => {
          await renameComponent({
            componentId: component._id as Id<"savedComponents">,
            name,
          });
        }}
        onDelete={async (component) => {
          let cleanupToken = pendingDeleteTokensRef.current.get(component._id);
          if (!cleanupToken) {
            const result = await deleteComponent({
              componentId: component._id as Id<"savedComponents">,
            });
            cleanupToken = result.assetDeleteToken ?? undefined;
            if (cleanupToken) {
              pendingDeleteTokensRef.current.set(component._id, cleanupToken);
            }
          }
          if (cleanupToken) {
            await cleanupComponentAssets(cleanupToken);
            pendingDeleteTokensRef.current.delete(component._id);
          }
        }}
      />
      {creationDialog && (
        <SavedComponentCreationDialog
          state={creationDialog}
          onStateChange={setCreationDialog}
          onClose={() => setCreationDialog(null)}
          onCreate={async (name, elements, files = {}) => {
            await saveSavedComponent(
              { name, elements, files },
              {
                createLegacy: createComponent,
                createDraft,
                createAssetUploadGrant: (args) =>
                  createAssetUploadGrant({
                    ...args,
                    componentId: args.componentId as Id<"savedComponents">,
                    mimeType: args.mimeType,
                  }),
                createPreviewUploadGrant: (args) =>
                  createPreviewUploadGrant({
                    ...args,
                    componentId: args.componentId as Id<"savedComponents">,
                  }),
                registerAssetUpload,
                registerPreviewUpload,
                finalizeDraft: ({ componentId }) =>
                  finalizeDraft({
                    componentId: componentId as Id<"savedComponents">,
                  }),
                removeDraft: ({ componentId }) =>
                  deleteComponent({
                    componentId: componentId as Id<"savedComponents">,
                  }),
                cleanupAssets: cleanupComponentAssets,
                createPreview: (previewElements, previewFiles) =>
                  createSavedComponentPreview({
                    elements: previewElements as never,
                    appState: excalidrawAPI.getAppState(),
                    files: previewFiles,
                  }),
              },
            );
            excalidrawAPI.setToast({
              message: `${name.trim()} saved to Components`,
            });
          }}
        />
      )}
    </>
  );
};
