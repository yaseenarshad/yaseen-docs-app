# Image Studio Design

## Goal

Add a graphics-first media library to the self-hosted Excalidraw app:

- one unified search bar with no provider switching;
- Iconify as the primary source for colorful graphics, diagram symbols, icons, and query-relevant logos;
- Pixabay as a selective source for richer transparent vectors and illustrations;
- native editable Shapes in their own catalog;
- account-global Favorites and Recent;
- R2 persistence for every imported remote asset.

Trevor/realtime collaboration is outside this scope.

## Product experience

Image Studio is a destination in the existing right sidebar. Its four sections are Search, Shapes, Favorites, and Recent.

Search sends one query to both providers. The user never chooses Iconify versus Pixabay. The initial grid is intentionally curated to roughly 12–20 results:

1. colorful emoji and clipart collections;
2. distinctive diagram icons;
3. transparent Pixabay graphics;
4. query-relevant logos;
5. generic monochrome icon families.

Iconify results are capped at two items per collection and duplicate names are collapsed across generic collections. Color collections are allowed to retain the same concept when they provide meaningfully different visual families. Pixabay appears at a lower ratio, approximately one graphic after every three Iconify results.

No photographs are included in the default search.

Clicking a result inserts it at the current viewport center, selects it, and does not pan or zoom the canvas. Search remains available while one provider is temporarily unavailable; a non-blocking warning describes the partial failure.

## Providers

### Iconify

Iconify requires no API key. The Worker uses its search response and collection metadata to rank results and show collection/license information. Color and emoji families receive priority. Brand collections are treated as logos and carry a trademark notice.

The Worker resolves imports from a validated `prefix:name` provider ID and fetches the corresponding SVG. It never accepts a caller-provided remote URL.

### Pixabay

Pixabay requires the server-side Cloudflare Worker secret `PIXABAY_API_KEY`. The browser and Convex never receive this key.

The Worker performs transparent, safe, popular searches for both `vector` and `illustration`, deduplicates results by Pixabay ID, and rejects photograph records defensively. Search responses are cached at the Worker edge for 24 hours as required by Pixabay.

Normalized records include the Pixabay ID, preview, source page, contributor, dimensions, and Pixabay Content License metadata. The UI visibly identifies Pixabay as the source.

Preview and import endpoints accept only a numeric Pixabay ID. The Worker re-fetches the current Pixabay record server-side. It prefers `vectorURL` when approved full API access supplies it and safely falls back to `largeImageURL`/`webformatURL`, which commonly provides a transparent PNG.

Pixabay assets are not permanently hotlinked. On insertion, the selected binary becomes an Excalidraw `File`, enters the existing `queueAssets()` path, and is copied to R2.

## Worker API

```text
GET /api/image-studio/search?q=<query>&cursor=<page>
GET /api/image-studio/preview/<pixabay|iconify>/<provider-id>
GET /api/image-studio/import/<pixabay|iconify>/<provider-id>
```

Search returns a provider-neutral `ImageStudioSearchResponse`. Preview/import routes enforce provider ID formats, follow only URLs resolved from the provider, require an `image/*` response, and reject declared payloads larger than 20 MB.

The endpoints intentionally do not add another permission token. The application's existing account gate protects the UI, while the Worker routes contain no private account data.

## Persistence

Imported remote media uses the existing image persistence flow:

1. Worker returns the selected image binary.
2. The client creates a `File`.
3. `ExcalidrawImperativeAPI.insertImages()` normalizes and inserts it.
4. The editor's ordinary `onChange` calls `cloud.queueAssets(files)`.
5. Convex issues a short-lived upload grant.
6. The Worker copies the file to the private R2 bucket.
7. Convex stores the diagram asset metadata.

Favorites and Recent are separate Convex tables keyed by authenticated user and stable media item key. They are global across that user's diagrams and devices. Recent uses upsert semantics and retains the latest 60 unique items. Favorites toggle idempotently.

Native Shapes never use R2. Their templates become regular Excalidraw rectangle, ellipse, diamond, or closed line elements and are fully editable.

## Failure handling

- If Iconify fails, Pixabay results remain usable.
- If Pixabay fails or its key is missing, Iconify results remain usable and the UI shows a warning.
- If preview/import resolution fails, the tile reports an insertion error without changing the scene.
- The canvas viewport is never changed by image or shape insertion.
- Existing diagram autosave and R2 retry behavior continues unchanged.

## Verification

Tests cover:

- Pixabay vector/illustration filtering and source metadata;
- transparent/safe Pixabay query construction;
- Iconify collection priority, deduplication, and collection caps;
- mixed graphics-first ordering;
- partial provider failure;
- arbitrary-URL rejection;
- unified UI and separate Shapes section;
- viewport-safe imperative image insertion;
- typecheck, production build, and live Worker endpoint checks.
