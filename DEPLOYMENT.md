# Yaseen Excalidraw deployment

The canonical application is deployed at <https://draw.yaseenarshad.com>. The legacy hostname <https://draw.yasinarshad.com> permanently redirects to the same path and query string on the canonical hostname.

## Architecture

- Cloudflare Workers serves the Vite application and the `/api/assets` routes.
- A private R2 bucket named `yaseen-excalidraw-assets` stores pasted image bytes.
- Convex stores authentication, diagram scenes, versions, sharing settings, image metadata, and short-lived R2 upload grants.
- Scene JSON never contains the base64 image payload. Excalidraw file IDs link scene elements to R2 objects registered in Convex.
- Image Studio searches transparent Pixabay graphics and open-source Iconify graphics through the Worker. Imported files use the same R2-backed diagram asset flow as pasted images.
- Image Studio Favorites and Recent are account-wide Convex records. Shapes are inserted as editable native Excalidraw elements and do not consume R2 space.

### Board product model and legacy persistence

Board is the product and application-domain name for a saved whiteboard. The existing cloud persistence names are intentionally stable for compatibility: Convex tables `diagrams`, `diagramContents`, `diagramSnapshots`, and `diagramAssets`; stored `diagramId` fields; R2 binding `DIAGRAM_ASSETS`; object keys; and all existing IDs remain unchanged. Board-facing Convex APIs translate to that durable model, while deprecated Diagram APIs remain available to already-open clients.

New schema concepts use Board vocabulary (for example, `boardFolders`). Existing records and R2 objects must never be recreated, re-keyed, or moved solely to rename the product concept.

Pixabay requires a server-side `PIXABAY_API_KEY` Cloudflare Worker secret. Pixabay search responses are cached for 24 hours and inserted assets are copied to R2 instead of permanently hotlinked. Iconify's public search API does not require a key.

## Production services

- Convex deployment: `moonlit-boar-611`
- Convex URL: `https://moonlit-boar-611.convex.cloud`
- Convex HTTP actions: `https://moonlit-boar-611.convex.site`
- Cloudflare Worker: `yaseen-excalidraw`
- Canonical custom domain: `draw.yaseenarshad.com`
- Legacy redirect domain: `draw.yasinarshad.com`

## Deploy

```bash
npx convex deploy
VITE_CONVEX_URL=https://moonlit-boar-611.convex.cloud yarn build
npx wrangler deploy --config wrangler.jsonc
```

The Cloudflare account is pinned in `wrangler.jsonc` so the Worker, custom domain, and R2 binding cannot accidentally deploy to another account.

Both hostnames must remain in `routes`, in canonical-then-legacy order. Static assets use `run_worker_first: true` so the Worker can redirect every legacy-host request—including `/`, `/b/*`, `/s/*`, `/api/*`, static assets, and unknown paths—before delegating canonical requests to the `ASSETS` binding.

The legacy `/sw.js` request is the sole redirect exception. Returning users may still have a PWA service worker installed on the legacy origin, so that URL serves a no-store retirement worker from `worker/legacyServiceWorker.ts`. It activates immediately, moves controlled legacy tabs to their canonical path, and unregisters itself. Redirecting `/sw.js` cross-origin would make the update invalid and leave the stale worker in control.

The hostname change is intentionally an origin change. Browser-local state, including authentication and local-only Boards, does not transfer automatically from the legacy hostname. Users sign in again on the canonical hostname; their account-backed Boards and R2 assets then load from the unchanged Convex and R2 deployments.

### Domain rollback

If the canonical hostname must be rolled back, redeploy the last known-good Worker version and detach only `draw.yaseenarshad.com`. Keep `draw.yasinarshad.com`, the `yaseen-excalidraw` Worker, the `yaseen-excalidraw-assets` bucket, and `moonlit-boar-611` unchanged. Do not delete or recreate Convex or R2 data as part of a domain rollback.

## Current storage behavior

- Pasted PNG, JPEG, GIF, WebP, AVIF, and SVG images are supported.
- Each image is limited to 50 MB.
- Owner drawings and unlisted view-only links hydrate their images from R2.
- R2 object names are random and the bucket itself is not public.

Deleted images are not garbage-collected from R2 yet. A reference-sync and retention job should be added before enabling automatic permanent deletion.
