# Image Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a unified Image Studio with Openverse and Iconify search, safe R2-backed image insertion, a separate native Shapes catalog, and account-global Favorites and Recent items.

**Architecture:** Cloudflare Worker endpoints normalize and interleave Openverse and Iconify results, proxy previews, and fetch imports by provider asset ID rather than caller-supplied URLs. The React host sidebar inserts normalized files through a new Excalidraw imperative API and records provenance, Favorites, and Recent items in account-scoped Convex tables. Local shape templates become ordinary native Excalidraw elements and do not use R2.

**Tech Stack:** TypeScript, React, Excalidraw imperative API and element skeletons, Convex Auth/database, Cloudflare Workers and Cache API, R2, Openverse API, Iconify API, Vitest, Testing Library, convex-test.

---

## File Structure

- Create `image-studio/types.ts`: provider-neutral media item and response types shared by the Worker and app.
- Create `worker/imageStudio.ts`: provider clients, normalization, result interleaving, response limits, and route handlers.
- Create `worker/imageStudio.test.ts`: provider normalization, partial-failure, validation, and import-limit tests.
- Modify `worker/index.ts`: delegate `/api/image-studio/*` requests to the Image Studio router.
- Modify `worker/tsconfig.json`: include the new Worker module.
- Modify `packages/excalidraw/types.ts`: expose imperative image insertion.
- Modify `packages/excalidraw/components/App.tsx`: make existing image insertion callable by hosts, return initialized elements, and default to viewport center.
- Modify `packages/excalidraw/tests/image.test.tsx`: cover imperative insertion, selection, and unchanged viewport.
- Create `excalidraw-app/image-studio/shapes.ts`: deterministic shape catalog and element skeleton factories.
- Create `excalidraw-app/image-studio/shapes.test.ts`: catalog and geometry tests.
- Create `excalidraw-app/image-studio/insertShape.ts`: native shape insertion and selection helper.
- Create `excalidraw-app/image-studio/insertShape.test.ts`: insertion, history, and viewport tests.
- Create `convex/mediaTypes.ts`: reusable Convex validators for normalized media metadata.
- Modify `convex/schema.ts`: add global Favorites and Recent tables plus optional asset provenance.
- Create `convex/mediaLibrary.ts`: account-scoped favorite/recent queries and mutations.
- Modify `convex/assets.ts`: register Image Studio provenance on diagram assets.
- Create `convex/mediaLibrary.test.ts`: Convex account isolation, deduplication, ordering, and retention tests.
- Create `convex/vitest.config.mts`: edge-runtime Convex test configuration.
- Modify `package.json` and `yarn.lock`: add Convex test dependencies and a focused test command.
- Create `excalidraw-app/image-studio/api.ts`: typed search, preview, and import client.
- Create `excalidraw-app/image-studio/ImageStudio.tsx`: Search, Shapes, Favorites, and Recent interface.
- Create `excalidraw-app/image-studio/ImageStudio.scss`: responsive sidebar styling.
- Create `excalidraw-app/image-studio/ImageStudio.test.tsx`: unified search, partial errors, favorite, recent, and insertion component tests.
- Modify `excalidraw-app/components/AppSidebar.tsx`: mount Image Studio as a right-sidebar destination.
- Modify `excalidraw-app/components/AppSidebar.test.tsx`: prove the new sidebar tab is available.
- Modify `excalidraw-app/App.tsx`: pass the Excalidraw API and current owner diagram ID into the sidebar.
- Modify `excalidraw-app/cloud/useCloudDiagram.ts`: expose the active owner diagram ID.
- Modify `DEPLOYMENT.md`: document Image Studio providers and anonymous Openverse fallback.

### Task 1: Shared media types and provider normalization

**Files:**

- Create: `image-studio/types.ts`
- Create: `worker/imageStudio.ts`
- Create: `worker/imageStudio.test.ts`
- Modify: `worker/tsconfig.json`

- [ ] **Step 1: Write failing provider-normalization tests**

Create `worker/imageStudio.test.ts` with fixtures that prove Openverse license filtering, Iconify collection metadata, stable keys, and one-grid interleaving:

```ts
import { describe, expect, it } from "vitest";

import {
  interleaveResults,
  normalizeIconifyResults,
  normalizeOpenverseResults,
} from "./imageStudio";

describe("Image Studio provider normalization", () => {
  it("normalizes only reusable Openverse licenses", () => {
    const results = normalizeOpenverseResults({
      results: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Team",
          creator: "Alex",
          creator_url: "https://example.com/alex",
          license: "by",
          license_version: "4.0",
          license_url: "https://creativecommons.org/licenses/by/4.0/",
          foreign_landing_url: "https://example.com/team",
          thumbnail: "https://example.com/team-thumb.jpg",
          source: "flickr",
          category: "photograph",
          filetype: "jpg",
          width: 1200,
          height: 800,
          attribution: '"Team" by Alex is licensed under CC BY 4.0.',
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Restricted",
          license: "by-nc",
          thumbnail: "https://example.com/restricted.jpg",
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      itemKey: "openverse:11111111-1111-4111-8111-111111111111",
      provider: "openverse",
      kind: "photo",
      licenseName: "CC BY 4.0",
      creator: "Alex",
    });
  });

  it("normalizes Iconify icons and marks brand collections as logos", () => {
    const results = normalizeIconifyResults({
      icons: ["tabler:chart-up", "simple-icons:openai"],
      collections: {
        tabler: {
          name: "Tabler Icons",
          license: { title: "MIT", spdx: "MIT" },
        },
        "simple-icons": {
          name: "Simple Icons",
          category: "Brands / Social",
          license: { title: "CC0 1.0", spdx: "CC0-1.0" },
        },
      },
    });

    expect(results.map((result) => result.kind)).toEqual(["icon", "logo"]);
    expect(results[1]).toMatchObject({
      itemKey: "iconify:simple-icons:openai",
      collectionName: "Simple Icons",
      trademarkNotice: true,
    });
  });

  it("interleaves both providers without hiding either result type", () => {
    const openverse = normalizeOpenverseResults({
      results: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Team",
          license: "cc0",
          thumbnail: "https://example.com/team.jpg",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Office",
          license: "pdm",
          thumbnail: "https://example.com/office.jpg",
        },
      ],
    });
    const iconify = normalizeIconifyResults({
      icons: ["tabler:users", "tabler:briefcase"],
      collections: {
        tabler: {
          name: "Tabler Icons",
          license: { title: "MIT", spdx: "MIT" },
        },
      },
    });

    expect(
      interleaveResults(openverse, iconify).map((item) => item.provider),
    ).toEqual(["openverse", "iconify", "openverse", "iconify"]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
yarn test:app worker/imageStudio.test.ts --watch=false
```

Expected: FAIL because `worker/imageStudio.ts` does not exist.

- [ ] **Step 3: Define the shared provider-neutral types**

Create `image-studio/types.ts`:

```ts
export type ImageStudioProvider = "openverse" | "iconify" | "shape";
export type ImageStudioItemKind =
  | "photo"
  | "illustration"
  | "icon"
  | "logo"
  | "shape";

export type ImageStudioItem = {
  itemKey: string;
  provider: ImageStudioProvider;
  providerId: string;
  kind: ImageStudioItemKind;
  title: string;
  previewUrl: string;
  creator?: string;
  creatorUrl?: string;
  collectionName?: string;
  sourceUrl?: string;
  licenseName?: string;
  licenseUrl?: string;
  attribution?: string;
  width?: number;
  height?: number;
  trademarkNotice?: boolean;
};

export type ImageStudioSearchResponse = {
  results: ImageStudioItem[];
  cursor: string | null;
  warnings: Array<{
    provider: Exclude<ImageStudioProvider, "shape">;
    message: string;
  }>;
};
```

- [ ] **Step 4: Implement pure normalization and interleaving**

Create `worker/imageStudio.ts` with exported input types and pure helpers:

```ts
import type {
  ImageStudioItem,
  ImageStudioSearchResponse,
} from "../image-studio/types";

const ALLOWED_OPENVERSE_LICENSES = new Set(["cc0", "pdm", "by", "by-sa"]);

export const normalizeOpenverseResults = (payload: {
  results?: Array<Record<string, unknown>>;
}): ImageStudioItem[] =>
  (payload.results ?? []).flatMap((raw) => {
    const id = typeof raw.id === "string" ? raw.id : "";
    const license = typeof raw.license === "string" ? raw.license : "";
    const previewUrl =
      typeof raw.thumbnail === "string" ? raw.thumbnail : "";
    if (!id || !previewUrl || !ALLOWED_OPENVERSE_LICENSES.has(license)) {
      return [];
    }
    const version =
      typeof raw.license_version === "string" ? ` ${raw.license_version}` : "";
    const category = raw.category === "illustration" ? "illustration" : "photo";
    return [{
      itemKey: `openverse:${id}`,
      provider: "openverse",
      providerId: id,
      kind: category,
      title:
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : "Untitled image",
      previewUrl: `/api/image-studio/preview/openverse/${id}`,
      creator: typeof raw.creator === "string" ? raw.creator : undefined,
      creatorUrl:
        typeof raw.creator_url === "string" ? raw.creator_url : undefined,
      collectionName:
        typeof raw.source === "string" ? raw.source : "Openverse",
      sourceUrl:
        typeof raw.foreign_landing_url === "string"
          ? raw.foreign_landing_url
          : undefined,
      licenseName: `${license === "pdm" ? "Public Domain" : license.toUpperCase()}${version}`,
      licenseUrl:
        typeof raw.license_url === "string" ? raw.license_url : undefined,
      attribution:
        typeof raw.attribution === "string" ? raw.attribution : undefined,
      width: typeof raw.width === "number" ? raw.width : undefined,
      height: typeof raw.height === "number" ? raw.height : undefined,
    } satisfies ImageStudioItem];
  });

export const normalizeIconifyResults = (payload: {
  icons?: string[];
  collections?: Record<
    string,
    {
      name?: string;
      category?: string;
      license?: { title?: string; spdx?: string; url?: string };
      author?: { name?: string; url?: string };
    }
  >;
}): ImageStudioItem[] =>
  (payload.icons ?? []).flatMap((providerId) => {
    const separator = providerId.indexOf(":");
    if (separator <= 0 || separator === providerId.length - 1) {
      return [];
    }
    const prefix = providerId.slice(0, separator);
    const name = providerId.slice(separator + 1);
    const collection = payload.collections?.[prefix];
    const isLogo =
      /brand/i.test(collection?.category ?? "") ||
      prefix === "logos" ||
      prefix === "simple-icons";
    return [{
      itemKey: `iconify:${providerId}`,
      provider: "iconify",
      providerId,
      kind: isLogo ? "logo" : "icon",
      title: name.replaceAll("-", " "),
      previewUrl: `/api/image-studio/preview/iconify/${encodeURIComponent(providerId)}`,
      creator: collection?.author?.name,
      creatorUrl: collection?.author?.url,
      collectionName: collection?.name ?? prefix,
      sourceUrl: `https://icon-sets.iconify.design/${prefix}/${name}/`,
      licenseName:
        collection?.license?.spdx ??
        collection?.license?.title ??
        "Open source",
      licenseUrl: collection?.license?.url,
      trademarkNotice: isLogo,
    } satisfies ImageStudioItem];
  });

export const interleaveResults = (
  openverse: ImageStudioItem[],
  iconify: ImageStudioItem[],
) => {
  const output: ImageStudioItem[] = [];
  const length = Math.max(openverse.length, iconify.length);
  for (let index = 0; index < length; index++) {
    if (openverse[index]) output.push(openverse[index]);
    if (iconify[index]) output.push(iconify[index]);
  }
  return output;
};
```

Also add `worker/imageStudio.ts` to `worker/tsconfig.json`'s `include` array.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
yarn test:app worker/imageStudio.test.ts --watch=false
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit provider normalization**

```bash
git add image-studio/types.ts worker/imageStudio.ts worker/imageStudio.test.ts worker/tsconfig.json
git commit -m "Add Image Studio provider normalization"
```

### Task 2: Worker search, preview, and safe import routes

**Files:**

- Modify: `worker/imageStudio.ts`
- Modify: `worker/imageStudio.test.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Add failing route tests**

Extend `worker/imageStudio.test.ts` with a stub fetcher and cache. Cover partial provider failure, bounded response streaming, invalid cursors, and independent Openverse/Iconify pagination:

```ts
it("returns partial unified results when one provider fails", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("openverse.org")) {
      return new Response("rate limited", { status: 429 });
    }
    if (url.includes("iconify.design/search")) {
      return Response.json({
        icons: ["tabler:users"],
        collections: {
          tabler: {
            name: "Tabler Icons",
            license: { title: "MIT", spdx: "MIT" },
          },
        },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });

  const response = await handleImageStudioRequest(
    new Request("https://draw.test/api/image-studio/search?q=team"),
    { fetcher, cache: createMemoryCache() },
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.results).toHaveLength(1);
  expect(body.warnings).toEqual([
    { provider: "openverse", message: "Openverse is temporarily unavailable." },
  ]);
});

it("rejects arbitrary import URLs and oversized bodies", async () => {
  const invalid = await handleImageStudioRequest(
    new Request(
      "https://draw.test/api/image-studio/import/openverse/https%3A%2F%2Fevil.test",
    ),
    { fetcher: vi.fn(), cache: createMemoryCache() },
  );
  expect(invalid.status).toBe(400);

  const oversized = await readLimitedResponse(
    new Response(new Uint8Array(12_000_001), {
      headers: { "Content-Type": "image/png" },
    }),
    12_000_000,
  );
  await expect(oversized).rejects.toThrow("Image exceeds the 12 MB limit");
});
```

Define `createMemoryCache()` in the test as a small `Map<string, Response>` implementing `match` and `put`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
yarn test:app worker/imageStudio.test.ts --watch=false
```

Expected: FAIL because the route helpers are missing.

- [ ] **Step 3: Implement provider fetch and unified search**

Add these constants and exports to `worker/imageStudio.ts`:

```ts
const OPENVERSE_API = "https://api.openverse.org/v1/images/";
const ICONIFY_API = "https://api.iconify.design";
const IMPORT_LIMIT_BYTES = 12 * 1024 * 1024;
const QUERY_LIMIT = 120;
const PROVIDER_TIMEOUT_MS = 7_000;

export type ImageStudioDependencies = {
  fetcher: typeof fetch;
  cache: Pick<Cache, "match" | "put">;
  openverseCredentials?: {
    clientId: string;
    clientSecret: string;
  };
};

const withTimeout = async (
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

type ProviderCursor = {
  openversePage: number;
  iconifyStart: number;
};

const searchProviders = async (
  query: string,
  cursor: ProviderCursor,
  dependencies: ImageStudioDependencies,
): Promise<ImageStudioSearchResponse> => {
  const [openverseResult, iconifyResult] = await Promise.allSettled([
    withTimeout(
      dependencies.fetcher,
      `${OPENVERSE_API}?${new URLSearchParams({
        q: query,
        page_size: "24",
        page: String(cursor.openversePage),
        license: "cc0,pdm,by,by-sa",
      })}`,
    ),
    withTimeout(
      dependencies.fetcher,
      `${ICONIFY_API}/search?${new URLSearchParams({
        query,
        limit: "32",
        start: String(cursor.iconifyStart),
      })}`,
    ),
  ]);

  const warnings: ImageStudioSearchResponse["warnings"] = [];
  let openverse: ImageStudioItem[] = [];
  let iconify: ImageStudioItem[] = [];
  let hasMoreOpenverse = false;
  let hasMoreIconify = false;

  if (openverseResult.status === "fulfilled" && openverseResult.value.ok) {
    const payload = await openverseResult.value.json();
    openverse = normalizeOpenverseResults(payload);
    hasMoreOpenverse =
      typeof payload.page === "number" &&
      typeof payload.page_count === "number" &&
      payload.page < payload.page_count;
  } else {
    warnings.push({
      provider: "openverse",
      message: "Openverse is temporarily unavailable.",
    });
  }
  if (iconifyResult.status === "fulfilled" && iconifyResult.value.ok) {
    const payload = await iconifyResult.value.json();
    iconify = normalizeIconifyResults(payload);
    hasMoreIconify =
      typeof payload.total === "number" &&
      cursor.iconifyStart + iconify.length < payload.total;
  } else {
    warnings.push({
      provider: "iconify",
      message: "Iconify is temporarily unavailable.",
    });
  }

  return {
    results: interleaveResults(openverse, iconify),
    cursor:
      hasMoreOpenverse || hasMoreIconify
        ? encodeCursor({
            openversePage: hasMoreOpenverse
              ? cursor.openversePage + 1
              : cursor.openversePage,
            iconifyStart: hasMoreIconify
              ? cursor.iconifyStart + 32
              : cursor.iconifyStart,
          })
        : null,
    warnings,
  };
};
```

Add a module-level Openverse token cache. When both optional credentials exist, POST `grant_type=client_credentials`, `client_id`, and `client_secret` as `application/x-www-form-urlencoded` to `https://api.openverse.org/v1/auth_tokens/token/`. Cache the bearer token until 60 seconds before `expires_in`; attach it to Openverse search and detail requests. If credentials are absent, make the same request anonymously. Do not fall back to anonymous after a configured credential is rejected.

Implement `encodeCursor` and `decodeCursor` as URL-safe base64 JSON with strict positive-integer bounds. Invalid cursors return HTTP 400. The cursor stores independent Openverse page and Iconify start offsets so one provider finishing does not prevent pagination from the other.

- [ ] **Step 4: Implement preview/import validation and bounded streaming**

Add provider ID validators and `readLimitedResponse()`:

```ts
const OPENVERSE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ICONIFY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

export const readLimitedResponse = async (
  response: Response,
  maximumBytes = IMPORT_LIMIT_BYTES,
) => {
  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}`);
  }
  const contentType = response.headers.get("Content-Type")?.split(";")[0] ?? "";
  if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
    throw new Error("Provider returned an unsupported image type");
  }
  const declared = Number(response.headers.get("Content-Length") ?? 0);
  if (declared > maximumBytes) {
    throw new Error("Image exceeds the 12 MB limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Provider returned an empty image");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error("Image exceeds the 12 MB limit");
    }
    chunks.push(value);
  }
  if (size === 0) throw new Error("Provider returned an empty image");
  return { bytes: new Blob(chunks, { type: contentType }), contentType };
};
```

For Iconify, construct `https://api.iconify.design/<prefix>/<name>.svg?height=512`. For Openverse, fetch `https://api.openverse.org/v1/images/<uuid>/`; use its `thumbnail` field for previews and its `url` field for imports. Narrow the selected field from the JSON response and then fetch it. Never accept a URL query parameter or body field.

- [ ] **Step 5: Implement cached route handling**

Export `handleImageStudioRequest(request, dependencies)`:

```ts
export const handleImageStudioRequest = async (
  request: Request,
  dependencies: ImageStudioDependencies,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (request.method !== "GET") return null;

  if (url.pathname === "/api/image-studio/search") {
    const query = (url.searchParams.get("q") ?? "").trim();
    if (!query || query.length > QUERY_LIMIT) {
      return Response.json(
        { error: "Search query must be 1-120 characters." },
        {
          status: 400,
        },
      );
    }
    const cursorValue = url.searchParams.get("cursor");
    const cursor = decodeCursor(cursorValue);
    if (!cursor) {
      return Response.json(
        { error: "Search cursor is invalid." },
        { status: 400 },
      );
    }
    const cacheKey = new Request(
      `${url.origin}/api/image-studio/search?${new URLSearchParams({
        q: query.toLocaleLowerCase(),
        ...(cursorValue ? { cursor: cursorValue } : {}),
      })}`,
    );
    const cached = await dependencies.cache.match(cacheKey);
    if (cached) return cached;
    const response = Response.json(
      await searchProviders(query, cursor, dependencies),
      { headers: { "Cache-Control": "public, max-age=900" } },
    );
    await dependencies.cache.put(cacheKey, response.clone());
    return response;
  }

  const match = url.pathname.match(
    /^\/api\/image-studio\/(preview|import)\/(openverse|iconify)\/(.+)$/,
  );
  if (!match) return null;
  return await fetchProviderAsset(match[2], decodeURIComponent(match[3]), {
    preview: match[1] === "preview",
    ...dependencies,
  });
};
```

Preview responses use `public, max-age=86400`; imports use `private, max-age=300`. Both set `X-Content-Type-Options: nosniff`.

- [ ] **Step 6: Delegate Worker routes**

Import the handler in `worker/index.ts`, add optional `OPENVERSE_CLIENT_ID`/`OPENVERSE_CLIENT_SECRET` fields to `Env`, and call it before the R2 asset routes:

```ts
const imageStudioResponse = await handleImageStudioRequest(request, {
  fetcher: fetch,
  cache: caches.default,
  openverseCredentials:
    env.OPENVERSE_CLIENT_ID && env.OPENVERSE_CLIENT_SECRET
      ? {
          clientId: env.OPENVERSE_CLIENT_ID,
          clientSecret: env.OPENVERSE_CLIENT_SECRET,
        }
      : undefined,
});
if (imageStudioResponse) {
  return imageStudioResponse;
}
```

- [ ] **Step 7: Run Worker tests and typecheck**

Run:

```bash
yarn test:app worker/imageStudio.test.ts --watch=false
yarn test:typecheck
```

Expected: all Image Studio Worker tests pass and TypeScript exits 0.

- [ ] **Step 8: Commit Worker routes**

```bash
git add worker/imageStudio.ts worker/imageStudio.test.ts worker/index.ts
git commit -m "Add Image Studio search and import routes"
```

### Task 3: Expose safe imperative image insertion

**Files:**

- Modify: `packages/excalidraw/types.ts`
- Modify: `packages/excalidraw/components/App.tsx`
- Modify: `packages/excalidraw/tests/image.test.tsx`

- [ ] **Step 1: Write the failing imperative API test**

Add to the image insertion suite:

```ts
it("inserts host images at viewport center without moving the viewport", async () => {
  await setupImageTest([DEER_IMAGE_DIMENSIONS]);
  h.app.setState({
    scrollX: -125,
    scrollY: 80,
    zoom: { value: 1.5 },
  });
  const viewportBefore = {
    scrollX: h.state.scrollX,
    scrollY: h.state.scrollY,
    zoom: h.state.zoom,
  };

  const inserted = await h.app.api.insertImages([
    await API.loadFile("./fixtures/deer.png"),
  ]);

  expect(inserted).toHaveLength(1);
  expect(inserted[0].type).toBe("image");
  expect(h.state.selectedElementIds[inserted[0].id]).toBe(true);
  expect({
    scrollX: h.state.scrollX,
    scrollY: h.state.scrollY,
    zoom: h.state.zoom,
  }).toEqual(viewportBefore);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
yarn test:app packages/excalidraw/tests/image.test.tsx --watch=false
```

Expected: FAIL because `insertImages` is not public.

- [ ] **Step 3: Add the imperative API type**

In `ExcalidrawImperativeAPI` add:

```ts
insertImages: (
  files: readonly File[],
  options?: { position?: { x: number; y: number } },
) => Promise<readonly InitializedExcalidrawImageElement[]>;
```

Import the initialized image element type from `@excalidraw/element/types`.

- [ ] **Step 4: Refactor the existing implementation**

Rename the current private method to `insertImagesAt`, keep all existing drop, paste, and image-tool callers using it, and return `positioned`.

Add a public wrapper:

```ts
public insertImages: ExcalidrawImperativeAPI["insertImages"] = async (
  files,
  options,
) => {
  const position =
    options?.position ??
    viewportCoordsToSceneCoords(
      {
        clientX: this.state.offsetLeft + this.state.width / 2,
        clientY: this.state.offsetTop + this.state.height / 2,
      },
      this.state,
    );
  return await this.insertImagesAt([...files], position.x, position.y);
};
```

Add `insertImages: this.insertImages` to `createExcalidrawAPI()`. Do not call `scrollToContent`, `setViewport`, or any zoom helper.

- [ ] **Step 5: Run focused and history tests**

Run:

```bash
yarn test:app packages/excalidraw/tests/image.test.tsx packages/excalidraw/tests/history.test.tsx --watch=false
```

Expected: all tests pass.

- [ ] **Step 6: Commit imperative insertion**

```bash
git add packages/excalidraw/types.ts packages/excalidraw/components/App.tsx packages/excalidraw/tests/image.test.tsx
git commit -m "Expose imperative image insertion"
```

### Task 4: Build the native Shapes catalog and insertion helper

**Files:**

- Create: `excalidraw-app/image-studio/shapes.ts`
- Create: `excalidraw-app/image-studio/shapes.test.ts`
- Create: `excalidraw-app/image-studio/insertShape.ts`
- Create: `excalidraw-app/image-studio/insertShape.test.ts`

- [ ] **Step 1: Write failing catalog and insertion tests**

Test stable IDs, closed polygon points, native element types, selected IDs, and unchanged scroll/zoom:

```ts
it("builds a closed native star around the requested center", () => {
  const star = getShapeDefinition("star").createSkeletons(500, 300)[0];
  expect(star.type).toBe("line");
  expect(star.points?.[0]).toEqual(star.points?.at(-1));
  expect(star.backgroundColor).not.toBe("transparent");
});

it("inserts and selects native shapes without changing viewport", () => {
  const api = createFakeExcalidrawAPI({
    scrollX: -20,
    scrollY: 40,
    zoom: { value: 1.25 },
  });
  const inserted = insertShape(api, getShapeDefinition("hexagon"));
  expect(inserted.every((element) => element.type !== "image")).toBe(true);
  expect(api.updateScene).toHaveBeenCalledWith(
    expect.objectContaining({
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
  expect(api.getAppState()).toMatchObject({
    scrollX: -20,
    scrollY: 40,
    zoom: { value: 1.25 },
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
yarn test:app excalidraw-app/image-studio/shapes.test.ts excalidraw-app/image-studio/insertShape.test.ts --watch=false
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Define deterministic shape factories**

Create `shapes.ts`:

```ts
import { pointFrom } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

export type ShapeDefinition = {
  id: string;
  title: string;
  keywords: readonly string[];
  createSkeletons: (
    centerX: number,
    centerY: number,
  ) => ExcalidrawElementSkeleton[];
};

const polygonPoints = (sides: number, radius: number) =>
  Array.from({ length: sides + 1 }, (_, index) => {
    const angle = -Math.PI / 2 + (index % sides) * ((Math.PI * 2) / sides);
    return pointFrom(
      radius + Math.cos(angle) * radius,
      radius + Math.sin(angle) * radius,
    );
  });

const polygon = (
  id: string,
  title: string,
  sides: number,
): ShapeDefinition => ({
  id,
  title,
  keywords: [title.toLocaleLowerCase(), "polygon", "shape"],
  createSkeletons: (centerX, centerY) => [
    {
      type: "line",
      x: centerX - 60,
      y: centerY - 60,
      points: polygonPoints(sides, 60),
      backgroundColor: "#a5d8ff",
      strokeColor: "#1b1b1f",
      fillStyle: "solid",
    },
  ],
});
```

Add rectangle, rounded rectangle, ellipse/circle, diamond, triangle, pentagon, hexagon, a ten-point star, line, arrow, speech bubble, checkmark, cross, plus, brackets, process, decision, terminator, document, and database definitions. Every catalog item must have a stable lowercase ID and a deterministic factory.

- [ ] **Step 4: Implement shape insertion**

Create `insertShape.ts`:

```ts
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { ShapeDefinition } from "./shapes";

export const getVisibleSceneCenter = (api: ExcalidrawImperativeAPI) => {
  const state = api.getAppState();
  return {
    x: state.width / (2 * state.zoom.value) - state.scrollX,
    y: state.height / (2 * state.zoom.value) - state.scrollY,
  };
};

export const insertShape = (
  api: ExcalidrawImperativeAPI,
  definition: ShapeDefinition,
) => {
  const center = getVisibleSceneCenter(api);
  const elements = convertToExcalidrawElements(
    definition.createSkeletons(center.x, center.y),
    { regenerateIds: true },
  );
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...elements],
    appState: {
      selectedElementIds: Object.fromEntries(
        elements.map((element) => [element.id, true]),
      ),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return elements;
};
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
yarn test:app excalidraw-app/image-studio/shapes.test.ts excalidraw-app/image-studio/insertShape.test.ts --watch=false
yarn test:typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit the shape catalog**

```bash
git add excalidraw-app/image-studio/shapes.ts excalidraw-app/image-studio/shapes.test.ts excalidraw-app/image-studio/insertShape.ts excalidraw-app/image-studio/insertShape.test.ts
git commit -m "Add native Image Studio shapes"
```

### Task 5: Add account-global Favorites, Recent, and provenance

**Files:**

- Create: `convex/mediaTypes.ts`
- Modify: `convex/schema.ts`
- Create: `convex/mediaLibrary.ts`
- Modify: `convex/assets.ts`
- Create: `convex/mediaLibrary.test.ts`
- Create: `convex/vitest.config.mts`
- Modify: `package.json`
- Modify: `yarn.lock`

- [ ] **Step 1: Install the required Convex test runtime**

Run:

```bash
yarn add --dev convex-test@latest @edge-runtime/vm@latest
```

Expected: `package.json` and `yarn.lock` update successfully.

Add:

```json
"test:convex": "vitest --config convex/vitest.config.mts"
```

Create `convex/vitest.config.mts` with `environment: "edge-runtime"`, `globals: true`, and an include for `convex/**/*.test.ts`.

- [ ] **Step 2: Write failing Convex tests**

Create `convex/mediaLibrary.test.ts` using `convexTest(schema, modules)`. Create two user documents, use separate authenticated identities, and test:

```ts
const item = {
  itemKey: "iconify:tabler:rocket",
  provider: "iconify" as const,
  providerId: "tabler:rocket",
  kind: "icon" as const,
  title: "Rocket",
  previewUrl: "/api/image-studio/preview/iconify/tabler%3Arocket",
  collectionName: "Tabler Icons",
  licenseName: "MIT",
};

await yaseen.mutation(api.mediaLibrary.toggleFavorite, {
  item,
  favorite: true,
});
expect(await yaseen.query(api.mediaLibrary.listFavorites, {})).toHaveLength(1);
expect(await trevor.query(api.mediaLibrary.listFavorites, {})).toEqual([]);

await yaseen.mutation(api.mediaLibrary.recordRecent, { item });
await yaseen.mutation(api.mediaLibrary.recordRecent, { item });
expect(await yaseen.query(api.mediaLibrary.listRecent, {})).toMatchObject([
  { itemKey: item.itemKey, useCount: 2 },
]);
```

Also insert 101 distinct Recent items and assert the oldest is pruned.

- [ ] **Step 3: Run Convex tests and verify RED**

Run:

```bash
yarn test:convex --run
```

Expected: FAIL because the tables and functions do not exist.

- [ ] **Step 4: Define reusable media validators and schema**

Create `convex/mediaTypes.ts`:

```ts
import { v } from "convex/values";

export const mediaProviderValidator = v.union(
  v.literal("openverse"),
  v.literal("iconify"),
  v.literal("shape"),
);
export const mediaKindValidator = v.union(
  v.literal("photo"),
  v.literal("illustration"),
  v.literal("icon"),
  v.literal("logo"),
  v.literal("shape"),
);
export const mediaItemValidator = v.object({
  itemKey: v.string(),
  provider: mediaProviderValidator,
  providerId: v.string(),
  kind: mediaKindValidator,
  title: v.string(),
  previewUrl: v.string(),
  creator: v.optional(v.string()),
  creatorUrl: v.optional(v.string()),
  collectionName: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  licenseName: v.optional(v.string()),
  licenseUrl: v.optional(v.string()),
  attribution: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  trademarkNotice: v.optional(v.boolean()),
});
```

Add `mediaFavorites` and `mediaRecents` tables using `mediaItemValidator.fields`, with indexes:

```ts
.index("by_ownerId_and_updatedAt", ["ownerId", "updatedAt"])
.index("by_ownerId_and_itemKey", ["ownerId", "itemKey"])
```

and:

```ts
.index("by_ownerId_and_lastUsedAt", ["ownerId", "lastUsedAt"])
.index("by_ownerId_and_itemKey", ["ownerId", "itemKey"])
```

Extend `diagramAssets` with the optional provenance fields from the approved spec.

- [ ] **Step 5: Implement Favorites and Recent mutations**

In `convex/mediaLibrary.ts`, derive `ownerId` with `getAuthUserId`. Implement:

- `listFavorites`: `.withIndex("by_ownerId_and_updatedAt", ...)`, `.order("desc").take(100)`;
- `toggleFavorite`: unique lookup by owner/item key, insert or patch when enabled, delete when disabled;
- `listRecent`: ordered by owner/lastUsed, `.take(100)`;
- `recordRecent`: unique upsert, increment `useCount`, then read `.take(101)` and delete entries after index 99;
- `removeRecent`: unique owner/item lookup and delete.

Every public function includes `args` and `returns` validators. Return `null` from mutations.

- [ ] **Step 6: Implement asset provenance upsert**

Add `setProvenance` to `convex/assets.ts`. It accepts `diagramId`, `fileId`, and the optional provenance fields, derives the authenticated user, verifies diagram ownership, and patches or inserts the `diagramAssets` row. It must not require the R2 object to exist yet because scene change and metadata mutation can race.

Use the existing asset row's `createdAt` when patching and set `updatedAt` on every call. Existing uploads later patch `objectKey`, size, MIME, and ETag.

- [ ] **Step 7: Run Convex tests and typecheck**

Run:

```bash
yarn test:convex --run
yarn test:typecheck
```

Expected: all Convex tests and typecheck pass.

- [ ] **Step 8: Commit global library persistence**

```bash
git add package.json yarn.lock convex/vitest.config.mts convex/mediaTypes.ts convex/mediaLibrary.ts convex/mediaLibrary.test.ts convex/schema.ts convex/assets.ts
git commit -m "Persist Image Studio favorites and recents"
```

### Task 6: Build the Image Studio client API and sidebar UI

**Files:**

- Create: `excalidraw-app/image-studio/api.ts`
- Create: `excalidraw-app/image-studio/ImageStudio.tsx`
- Create: `excalidraw-app/image-studio/ImageStudio.scss`
- Create: `excalidraw-app/image-studio/ImageStudio.test.tsx`

- [ ] **Step 1: Write failing API and UI tests**

Cover one unified search request, mixed results, no required media-type toggle, partial warnings, and keyboard submission:

```ts
it("shows mixed provider results from one search field", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        results: [openverseFixture, iconifyFixture],
        cursor: null,
        warnings: [],
      }),
    ),
  );

  renderImageStudio();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search images" }), {
    target: { value: "growth" },
  });
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });

  expect(await screen.findByText("Team growth")).toBeInTheDocument();
  expect(screen.getByText("Chart up")).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Photos" })).not.toBeInTheDocument();
});
```

Add tests for switching to Shapes, toggling a Favorite mutation, rendering Recent results, an import failure, and `aria-busy` during insertion. Also cover Load more appending and de-duplicating the next provider-aware page.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
yarn test:app excalidraw-app/image-studio/ImageStudio.test.tsx --watch=false
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the typed client API**

Create `api.ts`:

```ts
import type {
  ImageStudioItem,
  ImageStudioSearchResponse,
} from "../../image-studio/types";

export const searchImageStudio = async (
  query: string,
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<ImageStudioSearchResponse> => {
  const params = new URLSearchParams({ q: query });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/image-studio/search?${params}`, {
    signal,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Image search failed");
  }
  return body;
};

export const importImageStudioItem = async (item: ImageStudioItem) => {
  if (item.provider !== "openverse" && item.provider !== "iconify") {
    throw new Error("Only remote media can be imported as an image");
  }
  const response = await fetch(
    `/api/image-studio/import/${item.provider}/${encodeURIComponent(
      item.providerId,
    )}`,
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Image import failed");
  }
  const blob = await response.blob();
  const extension =
    blob.type === "image/svg+xml" ? "svg" : blob.type.split("/")[1];
  return new File([blob], `${item.title}.${extension}`, { type: blob.type });
};
```

- [ ] **Step 4: Implement the four-destination component**

`ImageStudio.tsx` accepts:

```ts
type ImageStudioProps = {
  excalidrawAPI: ExcalidrawImperativeAPI;
  diagramId: Id<"diagrams">;
};
```

It uses:

- local destination state: `"search" | "shapes" | "favorites" | "recent"`;
- one query/search form for all remote media;
- the returned continuation cursor and a Load more button that appends results, de-duplicates them by `itemKey`, and preserves the mixed grid;
- `useQuery(api.mediaLibrary.listFavorites, {})`;
- `useQuery(api.mediaLibrary.listRecent, {})`;
- `useMutation(api.mediaLibrary.toggleFavorite)`;
- `useMutation(api.mediaLibrary.recordRecent)`;
- `useMutation(api.mediaLibrary.removeRecent)`;
- `useMutation(api.assets.setProvenance)`.

Remote insertion calls `importImageStudioItem`, then:

```ts
const elements = await excalidrawAPI.insertImages([file]);
await Promise.all(
  elements.map((element) =>
    setProvenance({
      diagramId,
      fileId: element.fileId,
      sourceKind: item.provider,
      sourceId: item.providerId,
      sourceTitle: item.title,
      sourceCreator: item.creator,
      sourceUrl: item.sourceUrl,
      licenseName: item.licenseName,
      licenseUrl: item.licenseUrl,
      attribution: item.attribution,
    }),
  ),
);
await recordRecent({ item });
```

Shape insertion calls `insertShape`, then `recordRecent`. Every card has a favorite toggle, Add action, keyboard focus, lazy preview, type label, and selected-item license/source detail. A provider warning is a non-blocking status message. Search aborts a previous controller before starting a new request.

- [ ] **Step 5: Add responsive, theme-aware styling**

Use existing Excalidraw CSS variables. The sidebar must provide:

- a sticky destination row;
- one full-width search form;
- a two-column result grid;
- square icon/shape previews and aspect-ratio image previews;
- visible keyboard focus;
- non-overlaying favorite buttons;
- scroll only inside the results region;
- a single-column result grid on narrow phone sidebars.

Do not hardcode a light-only background or text color.

- [ ] **Step 6: Run focused UI tests**

Run:

```bash
yarn test:app excalidraw-app/image-studio/ImageStudio.test.tsx --watch=false
```

Expected: all Image Studio component tests pass.

- [ ] **Step 7: Commit Image Studio UI**

```bash
git add excalidraw-app/image-studio/api.ts excalidraw-app/image-studio/ImageStudio.tsx excalidraw-app/image-studio/ImageStudio.scss excalidraw-app/image-studio/ImageStudio.test.tsx
git commit -m "Build unified Image Studio UI"
```

### Task 7: Integrate Image Studio with the hosted app

**Files:**

- Modify: `excalidraw-app/components/AppSidebar.tsx`
- Modify: `excalidraw-app/components/AppSidebar.test.tsx`
- Modify: `excalidraw-app/App.tsx`
- Modify: `excalidraw-app/cloud/useCloudDiagram.ts`

- [ ] **Step 1: Write the failing sidebar integration test**

Extend `AppSidebar.test.tsx` with mocked Excalidraw UI state and:

```ts
it("exposes Image Studio as a right-sidebar tab", () => {
  renderAppSidebar({ excalidrawAPI, diagramId: "diagram-id" });
  expect(screen.getByRole("tab", { name: "Image Studio" })).toBeInTheDocument();
});
```

Also assert the tab is not rendered without an owner diagram ID.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
yarn test:app excalidraw-app/components/AppSidebar.test.tsx --watch=false
```

Expected: FAIL because `AppSidebar` does not accept the Image Studio props.

- [ ] **Step 3: Expose the active owner diagram ID**

In `useCloudDiagram.ts`, add:

```ts
activeOwnerDiagramId:
  openedDiagram?.access === "owner" ? openedDiagram.diagram._id : null,
```

Include the derived value in the return memo dependencies only if it is assigned to a local constant; otherwise its source `openedDiagram` already covers it.

- [ ] **Step 4: Mount the new sidebar destination**

Extend `AppSidebar` props with `excalidrawAPI` and `diagramId`. Add an Image Studio icon tab between Diagrams and the legacy promo tabs:

```tsx
<Sidebar.TabTrigger
  tab="image-studio"
  aria-label="Image Studio"
  title="Image Studio"
>
  {imageIcon}
</Sidebar.TabTrigger>
```

Render:

```tsx
<Sidebar.Tab tab="image-studio">
  <ImageStudio excalidrawAPI={excalidrawAPI} diagramId={diagramId} />
</Sidebar.Tab>
```

Keep Diagrams, Comments, and Presentation intact. The default trigger title becomes "Diagrams and Image Studio".

- [ ] **Step 5: Pass live app props**

In `App.tsx`, render `AppSidebar` only with the already-mounted `excalidrawAPI` and pass `cloud.activeOwnerDiagramId`. The Image Studio tab is unavailable on view-only routes because imports cannot persist there.

- [ ] **Step 6: Run sidebar and cloud tests**

Run:

```bash
yarn test:app excalidraw-app/components/AppSidebar.test.tsx excalidraw-app/cloud/cloudSceneSync.test.ts --watch=false
```

Expected: all tests pass.

- [ ] **Step 7: Commit host integration**

```bash
git add excalidraw-app/components/AppSidebar.tsx excalidraw-app/components/AppSidebar.test.tsx excalidraw-app/App.tsx excalidraw-app/cloud/useCloudDiagram.ts
git commit -m "Integrate Image Studio sidebar"
```

### Task 8: Persistence and regression verification

**Files:**

- Modify: `excalidraw-app/image-studio/ImageStudio.test.tsx`
- Modify: `excalidraw-app/cloud/cloudSceneSync.test.ts`
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Add end-to-end component persistence tests**

Mock a successful Worker import and imperative insertion with a known file ID. Assert:

- `assets.setProvenance` receives that file ID and the source/license fields;
- `mediaLibrary.recordRecent` runs only after insertion succeeds;
- failed insertion invokes neither provenance nor Recent;
- changing the supplied diagram ID does not change Favorites/Recent query scope.

- [ ] **Step 2: Add cloud asset regression coverage**

Extend the cloud scene sync test to prove a newly inserted binary is still queued through `queueAssets`, while a provenance-only diagram asset row does not make `createUploadGrant` reject the upload.

- [ ] **Step 3: Document production behavior**

Update `DEPLOYMENT.md` with:

- `/api/image-studio/search`, preview, and import routes;
- Openverse and Iconify as external providers;
- no paid provider key required for initial deployment;
- anonymous Openverse limits and edge caching;
- imported binaries stored in R2, shapes stored only in scene JSON;
- Favorites and Recent stored per Convex account.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
yarn test:convex --run
yarn test:app worker/imageStudio.test.ts packages/excalidraw/tests/image.test.tsx excalidraw-app/image-studio/shapes.test.ts excalidraw-app/image-studio/insertShape.test.ts excalidraw-app/image-studio/ImageStudio.test.tsx excalidraw-app/components/AppSidebar.test.tsx excalidraw-app/cloud/cloudSceneSync.test.ts --watch=false
yarn test:typecheck
yarn test:code
yarn test:build-config
VITE_CONVEX_URL=https://moonlit-boar-611.convex.cloud yarn build
```

Expected: every command exits 0.

- [ ] **Step 5: Commit verification and docs**

```bash
git add DEPLOYMENT.md excalidraw-app/image-studio/ImageStudio.test.tsx excalidraw-app/cloud/cloudSceneSync.test.ts
git commit -m "Verify Image Studio persistence"
```

### Task 9: Deploy and verify production

**Files:**

- No source changes expected unless production verification finds a defect.

- [ ] **Step 1: Deploy Convex schema and functions**

Run:

```bash
npx convex deploy
```

Expected: deployment `moonlit-boar-611` accepts the schema and functions.

- [ ] **Step 2: Build and deploy the Cloudflare Worker**

Run:

```bash
VITE_CONVEX_URL=https://moonlit-boar-611.convex.cloud yarn build
npx wrangler deploy --config wrangler.jsonc
```

Expected: Worker `yaseen-excalidraw` deploys successfully to `draw.yasinarshad.com`.

- [ ] **Step 3: Verify production API responses**

Run:

```bash
curl -fsS 'https://draw.yasinarshad.com/api/image-studio/search?q=team'
curl -fsSI 'https://draw.yasinarshad.com/api/image-studio/preview/iconify/tabler%3Ausers'
```

Expected: search returns both providers when available, and preview returns an SVG content type.

- [ ] **Step 4: Verify the browser workflow**

In the production app:

1. Sign in as Yaseen.
2. Open Image Studio and search `team`.
3. Confirm one mixed grid contains remote image and icon results.
4. Insert one Openverse image and one Iconify SVG.
5. Insert a star and a flowchart shape.
6. Favorite one remote result and one shape.
7. Switch to another diagram and confirm Favorites and Recent persist.
8. Return to the first diagram, reload, and confirm both imported images load.
9. Confirm search and all insertions leave scroll and zoom unchanged.
10. Open a view-only share link and confirm imported R2 images render.

- [ ] **Step 5: Fix any production-only defect and rerun its narrow test**

For every defect, first add a failing test in the owning module, implement the minimal fix, rerun the narrow test, and commit with a defect-specific message. Do not bypass validation or disable a test to complete deployment.

- [ ] **Step 6: Push production commits**

Run:

```bash
git status --short
git push origin main
```

Expected: the worktree is clean and `origin/main` contains the deployed commit.
