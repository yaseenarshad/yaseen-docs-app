# Yaseen Excalidraw deployment

The application is deployed at <https://draw.yasinarshad.com>.

## Architecture

- Cloudflare Workers serves the Vite application and the `/api/assets` routes.
- A private R2 bucket named `yaseen-excalidraw-assets` stores pasted image bytes.
- Convex stores authentication, diagram scenes, versions, sharing settings, image metadata, and short-lived R2 upload grants.
- Scene JSON never contains the base64 image payload. Excalidraw file IDs link scene elements to R2 objects registered in Convex.
- Image Studio searches transparent Pixabay graphics and open-source Iconify graphics through the Worker. Imported files use the same R2-backed diagram asset flow as pasted images.
- Image Studio Favorites and Recent are account-wide Convex records. Shapes are inserted as editable native Excalidraw elements and do not consume R2 space.

Pixabay requires a server-side `PIXABAY_API_KEY` Cloudflare Worker secret. Pixabay search responses are cached for 24 hours and inserted assets are copied to R2 instead of permanently hotlinked. Iconify's public search API does not require a key.

## Production services

- Convex deployment: `moonlit-boar-611`
- Convex URL: `https://moonlit-boar-611.convex.cloud`
- Convex HTTP actions: `https://moonlit-boar-611.convex.site`
- Cloudflare Worker: `yaseen-excalidraw`
- Custom domain: `draw.yasinarshad.com`

## Deploy

```bash
npx convex deploy
VITE_CONVEX_URL=https://moonlit-boar-611.convex.cloud yarn build
npx wrangler deploy --config wrangler.jsonc
```

The Cloudflare account is pinned in `wrangler.jsonc` so the Worker, custom domain, and R2 binding cannot accidentally deploy to another account.

## Current storage behavior

- Pasted PNG, JPEG, GIF, WebP, AVIF, and SVG images are supported.
- Each image is limited to 50 MB.
- Owner drawings and unlisted view-only links hydrate their images from R2.
- R2 object names are random and the bucket itself is not public.

Deleted images are not garbage-collected from R2 yet. A reference-sync and retention job should be added before enabling automatic permanent deletion.
