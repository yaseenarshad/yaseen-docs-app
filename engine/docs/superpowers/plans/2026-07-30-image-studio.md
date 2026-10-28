# Image Studio Implementation Plan

**Goal:** Deploy one graphics-first Image Studio using curated Iconify results, transparent Pixabay graphics, native Shapes, account-global Favorites/Recent, and the existing R2 asset flow.

## 1. Provider-neutral model

- [x] Define shared media provider, kind, item, and search response types.
- [x] Support `pixabay`, `iconify`, and local `shape` providers.
- [x] Store stable provider IDs and source/license metadata.

## 2. Cloudflare Worker providers

- [x] Add unified search, preview, and import routes.
- [x] Keep `PIXABAY_API_KEY` exclusively in a Worker secret.
- [x] Search Pixabay with `image_type=vector` and a selective illustration request, `colors=transparent`, `safesearch=true`, and `order=popular`.
- [x] Cache Pixabay provider/search responses for 24 hours.
- [x] Normalize Pixabay vectors/illustrations and reject photographs.
- [x] Use `vectorURL` when available and a transparent raster fallback otherwise.
- [x] Normalize Iconify collection/license metadata.
- [x] Prioritize color, emoji, clipart, and diagram-oriented collections.
- [x] Cap Iconify collections at two results and collapse generic duplicates.
- [x] Merge roughly three Iconify graphics before one Pixabay graphic.
- [x] Resolve all import URLs server-side from validated provider IDs.
- [x] Validate image MIME types and a 20 MB declared-size ceiling.
- [x] Return partial results with non-blocking provider warnings.

## 3. Excalidraw insertion

- [x] Expose the existing image insertion pipeline through `ExcalidrawImperativeAPI.insertImages()`.
- [x] Default insertion to the viewport center.
- [x] Select inserted elements without changing pan or zoom.
- [x] Let ordinary editor changes trigger the existing Convex/R2 upload flow.

## 4. Native Shapes

- [x] Add rectangle, rounded rectangle, circle, diamond, triangle, hexagon, and star templates.
- [x] Convert templates into native editable Excalidraw elements.
- [x] Insert and select Shapes without changing the viewport.

## 5. Account-global library

- [x] Add authenticated Convex `mediaFavorites` and `mediaRecent` tables.
- [x] Scope all queries/mutations to `getAuthUserId()`.
- [x] Deduplicate by stable item key.
- [x] Order by most recently used and retain 60 Recent items.
- [x] Preserve provider/source/license metadata.

## 6. Unified sidebar UI

- [x] Add Image Studio to the existing right sidebar.
- [x] Provide Search, Shapes, Favorites, and Recent sections.
- [x] Use one search bar; expose no provider tabs.
- [x] Show mixed Iconify/Pixabay results in one grid.
- [x] Identify Pixabay in result metadata.
- [x] Insert on click and record successful additions in Recent.
- [x] Favorite/unfavorite from any section.
- [x] Explain partial provider failures without hiding available results.

## 7. Verification and release

- [x] Test provider normalization, ranking, deduplication, query filters, partial failure, and arbitrary URL rejection.
- [x] Test unified UI and separate Shapes.
- [x] Test imperative image insertion and unchanged viewport.
- [x] Run focused tests and TypeScript.
- [x] Build the production application.
- [x] Deploy Convex schema/functions.
- [ ] Deploy the final Pixabay Worker revision.
- [ ] Verify live search, preview, and import.
- [ ] Push the verified `main` branch.
