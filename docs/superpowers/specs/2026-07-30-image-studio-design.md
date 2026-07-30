# Image Studio Design

## Goal

Add a production Image Studio to the hosted Excalidraw fork that lets a signed-in user:

- run one unified search across openly licensed photos, illustrations, icons, and logos;
- insert any result onto the current canvas;
- browse and insert reusable vector shapes from a separate Shapes tab;
- favorite search results and shapes;
- revisit recently inserted search results and shapes across every diagram;
- reload any diagram with imported images intact through the existing Convex/R2 asset pipeline.

Realtime collaboration, diagram sharing changes, image generation, and additional Image Studio endpoint permissions are outside this project.

## User Experience

### Opening Image Studio

Image Studio is a host-provided tab in Excalidraw's existing right sidebar. Its sidebar trigger uses an image/search icon and remains available while editing a cloud diagram.

The header exposes four destinations:

- **Search**: one search field and one mixed result grid;
- **Shapes**: a browsable shape catalog;
- **Favorites**: all favorited search results and shapes;
- **Recent**: the most recently inserted search results and shapes.

The Search destination does not force the user to choose Photos, Icons, or Logos before searching. A query is sent to all configured providers in parallel. Results display in one interleaved grid with a small type/source label. If one provider fails, results from the other provider remain usable and the UI shows a non-blocking provider warning.

Search runs when the user presses Enter or clicks the search button. The current query and loaded results remain mounted while the sidebar is open. Opening, searching, favoriting, or inserting from Image Studio must not pan, zoom, or otherwise jump the canvas.

### Search Results

Each result shows:

- a thumbnail or vector preview;
- a concise title;
- a type label such as Photo, Illustration, Icon, or Logo;
- its provider or collection;
- a favorite toggle;
- license information in the selected-result details.

Openverse and Iconify results are normalized into one client type. Each provider keeps its own relevance order. The first page is interleaved deterministically so both raster media and vector assets appear without requiring a type tab. If a provider has no results, the other provider fills the remaining slots.

Openverse queries exclude licenses with noncommercial or no-derivatives restrictions. Initial support includes public-domain works, CC0, CC BY, and CC BY-SA results. The stored attribution metadata identifies the creator, source, license, and original work URL. Iconify collection license metadata is shown and stored with the result. Logo results also display a short note that trademark rights can apply independently of the icon file's copyright license.

### Inserting Search Results

Selecting a result and choosing **Add**, or double-clicking its preview:

1. downloads the original asset through the Cloudflare Worker;
2. validates its provider identity, response type, and size;
3. normalizes and sanitizes it through Excalidraw's existing image import path;
4. inserts it near the center of the visible canvas without moving the viewport;
5. selects the inserted element;
6. lets the existing scene-change flow upload the normalized binary to R2 and register it in Convex;
7. records the result in the user's global Recent list.

The result is not permanently hotlinked. Once inserted, the diagram references the stored R2 copy through its Excalidraw file ID. Reload, export, snapshot history, and view-only share links continue to use the existing diagram asset flow.

The UI shows a loading state while downloading and a success or actionable error message afterward. A failed import does not create an empty canvas element or a Recent entry.

### Shapes

Shapes are a separate Image Studio destination because they are local reusable building blocks rather than web search results.

The initial catalog contains:

- rectangle and rounded rectangle;
- ellipse and circle;
- diamond;
- triangle;
- pentagon and hexagon;
- star;
- line and arrow;
- speech bubble;
- checkmark, cross, plus, and brackets;
- common flowchart symbols.

Where Excalidraw has a native equivalent, insertion creates native editable Excalidraw elements. Polygon and symbol templates use deterministic native linear-element skeletons so they retain stroke, fill, resize, rotation, copy, undo, and export behavior. Shapes never use R2.

Selecting or double-clicking a shape inserts it near the center of the visible canvas, selects it, records it in Recent, and leaves the viewport unchanged.

### Favorites and Recent

Favorites and Recent belong to the authenticated account, not to a diagram. They therefore appear in every diagram opened by the same user.

- Favoriting is idempotent and available from Search, Shapes, Recent, and Favorites.
- Unfavoriting removes the item only from Favorites.
- Inserting an item upserts its Recent entry, updates `lastUsedAt`, and increments `useCount`.
- Recent is ordered newest first and retains at most 100 unique items per user.
- Reusing an item moves it to the top rather than creating a duplicate.
- Removing a Recent entry does not remove a Favorite.
- Provider metadata is stored so Favorites and Recent can render even before a new search is run.
- If a remote provider later removes an item, it remains listed with its stored metadata; import can show a clear "no longer available" error.

## Provider Architecture

### Openverse

Openverse supplies photos and illustrations. The Worker calls the Openverse image search endpoint with the query, allowed-license filters, page size, and page cursor. It uses application credentials when configured and anonymous access as a fallback.

Openverse search responses already contain the provider asset ID, thumbnail, original URL, creator, creator URL, license, license URL, source, file type, dimensions, and attribution text required for normalized results.

### Iconify

Iconify supplies icons and logos. The Worker calls the public Iconify search endpoint, then uses the returned collection information for source and license metadata. SVG previews and imports are derived from Iconify's provider asset ID instead of accepting arbitrary URLs from the browser.

### Unified Search Endpoint

The Worker exposes:

```text
GET /api/image-studio/search?q=<query>&cursor=<optional-cursor>
```

The endpoint:

- validates and length-limits the query;
- searches Openverse and Iconify in parallel;
- normalizes provider responses;
- interleaves results;
- returns a provider-aware continuation cursor;
- caches successful normalized responses at the Cloudflare edge;
- applies a short timeout to each provider;
- returns partial results when only one provider succeeds.

The endpoint does not require an additional Image Studio permission token, per the product decision for this small private app. Existing site login still gates the UI. Query validation, edge caching, and conservative page sizes limit accidental provider usage.

### Preview and Import Endpoints

The Worker exposes:

```text
GET /api/image-studio/preview/:provider/:assetId
GET /api/image-studio/import/:provider/:assetId
```

The browser never supplies an arbitrary remote URL.

- For Iconify, the Worker validates `prefix:name` and constructs the public SVG API URL.
- For Openverse, the Worker validates the UUID, fetches the current media record from Openverse, and follows only the original URL returned for that record.
- Responses are limited to supported image MIME types.
- Search imports have a smaller maximum size than ordinary user uploads.
- Content length is checked before reading when supplied and enforced while streaming when absent.
- Provider fetches have timeouts and clear upstream error mapping.
- Preview responses are cacheable; import responses are private and are passed to the client import pipeline.

SVG from Iconify is normalized by Excalidraw before it becomes a canvas binary. The normalized binary—not the untrusted network response—is the content that the existing R2 upload queue persists.

## Excalidraw Integration

Expose an imperative image insertion API that reuses the editor's existing private `insertImages` implementation:

```ts
insertImages(
  files: readonly File[],
  options?: {
    position?: { x: number; y: number };
  },
): Promise<readonly InitializedExcalidrawImageElement[]>;
```

When no position is supplied, Excalidraw computes the center of its visible canvas in scene coordinates. The method returns the initialized image elements so the host can associate their file IDs with attribution metadata.

Insertion reuses current placeholder creation, image normalization, grid positioning, selection, history capture, and finalization behavior. It must not call any viewport-fitting or scroll-to-content path.

Shapes use a second host-facing insertion helper built from `convertToExcalidrawElements` and `updateScene`, or a focused imperative helper if preserving native selection/history cannot be achieved safely from the host.

## Convex Data Model

### Asset Provenance

Add optional provenance fields to `diagramAssets`:

```ts
sourceKind?: "openverse" | "iconify";
sourceId?: string;
sourceTitle?: string;
sourceCreator?: string;
sourceUrl?: string;
licenseName?: string;
licenseUrl?: string;
attribution?: string;
```

The Image Studio registers provenance after the existing R2 upload succeeds. Uploads without provenance continue to behave exactly as before.

### Global Library Items

Store reusable normalized item metadata in two account-scoped tables.

`mediaFavorites` contains:

- `ownerId`;
- stable `itemKey`;
- item kind and provider;
- provider asset ID or local shape ID;
- title, preview metadata, collection/source metadata, license metadata, and attribution;
- `createdAt` and `updatedAt`.

Indexes:

- by `ownerId` and `updatedAt`;
- unique lookup by `ownerId` and `itemKey`.

`mediaRecents` contains the same reusable item metadata plus:

- `lastUsedAt`;
- `useCount`.

Indexes:

- by `ownerId` and `lastUsedAt`;
- unique lookup by `ownerId` and `itemKey`.

All queries and mutations derive `ownerId` from Convex Auth. They never accept a caller-supplied user ID. Favorites and Recent remain account-private even though the external Image Studio search/import endpoints have no extra permission layer.

## Error Handling

- Empty and excessively long search queries are rejected client-side and server-side.
- Search requests are aborted when superseded.
- Provider timeouts produce partial results when possible.
- Provider rate limiting produces a specific retry message.
- Broken thumbnails show a stable fallback tile.
- Import rejects unsupported MIME types, empty bodies, oversized responses, and invalid provider IDs.
- Failed image insertion removes placeholders through the existing insertion error behavior.
- R2 upload failure leaves the normal unsaved-asset warning and can retry through the existing queue.
- Favorites and Recent mutations use optimistic UI with rollback on failure.

## Performance

- Search is explicit on Enter/button rather than firing for every keystroke.
- Provider calls run in parallel.
- Search and preview responses use Cloudflare cache APIs and stable cache keys.
- The first page is intentionally bounded.
- Thumbnails use lazy loading and fixed aspect-ratio placeholders.
- A bounded client cache avoids refetching the most recent queries during the session.
- Favorites and Recent are Convex reactive queries and are limited to the retained item count.

## Compatibility

- Existing diagrams, assets, uploads, snapshots, and share links require no migration.
- Optional provenance fields do not affect old `diagramAssets` rows.
- Pasted and uploaded images continue through the same upload queue.
- Image Studio adds a host sidebar tab without replacing the existing Diagrams sidebar content.
- Imported files use ordinary Excalidraw image elements and remain compatible with `.excalidraw`, PNG, and SVG export.
- Shapes use ordinary Excalidraw elements and require no custom renderer.

## Testing

Add focused coverage for:

- Openverse and Iconify response normalization;
- unified interleaving and provider-aware pagination;
- partial provider failure and timeout handling;
- license filtering;
- provider ID validation and arbitrary-URL rejection;
- MIME, empty-body, and size-limit enforcement;
- SVG normalization before R2 persistence;
- imperative image insertion at viewport center without viewport changes;
- successful insertion selecting elements and emitting one undoable change;
- failed insertion leaving no active placeholder;
- shape template conversion and insertion;
- favorite add/remove idempotency and account isolation;
- Recent upsert, deduplication, ordering, use counts, and 100-item retention;
- provenance registration after upload;
- Favorites and Recent rendering across two different diagrams;
- restored diagrams loading imported R2 assets;
- existing pasted/uploaded image and share-link regression paths;
- responsive sidebar behavior and keyboard-accessible controls.

Production verification must demonstrate:

- a mixed query returning both Openverse and Iconify results;
- a logo query returning usable vector results;
- an Openverse image and an Iconify SVG inserted and reloaded from R2;
- at least one native shape and one polygon template inserted and edited;
- a Favorite and Recent item appearing after switching diagrams;
- no canvas pan/zoom jump during search or insertion.

## Non-Goals

- Shared diagram membership or realtime multi-user editing.
- Image generation.
- Video search.
- Background removal.
- Uploading a private personal media library.
- Per-character SVG editing.
- A new Image Studio-specific permission or authorization flow.
- Replacing Convex Auth or the existing account model.
