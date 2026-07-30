import type {
  ImageStudioItem,
  ImageStudioSearchResponse,
  ImageStudioSearchSource,
} from "../image-studio/types";

export type ImageStudioEnv = {
  PIXABAY_API_KEY?: string;
};

type PixabayHit = {
  id?: number;
  type?: string;
  pageURL?: string;
  tags?: string;
  previewURL?: string;
  webformatURL?: string;
  largeImageURL?: string;
  vectorURL?: string;
  user?: string;
  imageWidth?: number;
  imageHeight?: number;
};

type IconifyCollection = {
  name?: string;
  category?: string;
  palette?: boolean;
  license?: { title?: string; url?: string; spdx?: string };
};

type IconifySearchPayload = {
  icons?: string[];
  collections?: Record<string, IconifyCollection>;
  total?: number;
  start?: number;
  limit?: number;
};

type ProviderSearchResult = {
  items: ImageStudioItem[];
  hasMore: boolean;
};

const SEARCH_LIMIT = 18;
const ICONIFY_FETCH_LIMIT = 64;
const ICONIFY_RESULT_LIMIT = 14;
const PIXABAY_RESULT_LIMIT = 5;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const CACHE_SECONDS = 24 * 60 * 60;
const PIXABAY_API = "https://pixabay.com/api/";
const ICONIFY_API = "https://api.iconify.design";

const COLOR_COLLECTION_PRIORITY = [
  "fluent-emoji-flat",
  "noto",
  "openmoji",
  "twemoji",
  "fluent-color",
  "streamline-color",
  "streamline-ultimate-color",
  "icon-park",
  "icon-park-twotone",
];

const LOW_PRIORITY_COLLECTIONS = [
  "material-symbols",
  "material-icons",
  "mdi",
  "ic",
  "fa",
  "fa6-solid",
  "fa6-regular",
];

const stringValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const titleFromTags = (tags?: string) => {
  const firstTag = tags
    ?.split(",")
    .map((tag) => tag.trim())
    .find(Boolean);
  return firstTag
    ? firstTag.replace(/\b\w/g, (character) => character.toUpperCase())
    : "Pixabay graphic";
};

export const normalizePixabayResults = (payload: {
  hits?: PixabayHit[];
}): ImageStudioItem[] =>
  (payload.hits ?? []).flatMap((raw) => {
    const id = numberValue(raw.id);
    const preview = stringValue(raw.previewURL);
    const type = stringValue(raw.type)?.toLowerCase();
    if (
      id === undefined ||
      !preview ||
      (!type?.startsWith("vector") && !type?.startsWith("illustration"))
    ) {
      return [];
    }
    const providerId = String(id);
    return [
      {
        itemKey: `pixabay:${providerId}`,
        provider: "pixabay",
        providerId,
        kind: "illustration",
        title: titleFromTags(raw.tags),
        previewUrl: `/api/image-studio/preview/pixabay/${providerId}`,
        creator: stringValue(raw.user),
        collectionName: "Pixabay",
        sourceUrl: stringValue(raw.pageURL),
        licenseName: "Pixabay Content License",
        licenseUrl: "https://pixabay.com/service/license-summary/",
        attribution: `Graphic from Pixabay${raw.user ? ` by ${raw.user}` : ""}`,
        width: numberValue(raw.imageWidth),
        height: numberValue(raw.imageHeight),
      } as ImageStudioItem,
    ];
  });

const iconKind = (
  prefix: string,
  collection: IconifyCollection | undefined,
) => {
  const isLogo =
    prefix === "simple-icons" ||
    /brand|logo|social/i.test(collection?.category ?? "");
  return isLogo ? ("logo" as const) : ("icon" as const);
};

export const normalizeIconifyResults = (payload: {
  icons?: string[];
  collections?: Record<string, IconifyCollection>;
}): ImageStudioItem[] =>
  (payload.icons ?? []).flatMap((providerId) => {
    const separator = providerId.indexOf(":");
    if (separator < 1 || separator === providerId.length - 1) {
      return [];
    }
    const prefix = providerId.slice(0, separator);
    const iconName = providerId.slice(separator + 1);
    const collection = payload.collections?.[prefix];
    const kind = iconKind(prefix, collection);
    return [
      {
        itemKey: `iconify:${providerId}`,
        provider: "iconify",
        providerId,
        kind,
        title: iconName.replaceAll("-", " "),
        previewUrl: `/api/image-studio/preview/iconify/${encodeURIComponent(
          providerId,
        )}`,
        collectionName: collection?.name ?? prefix,
        sourceUrl: `https://icon-sets.iconify.design/${prefix}/${iconName}/`,
        licenseName:
          collection?.license?.title ??
          collection?.license?.spdx ??
          "Open source",
        licenseUrl: collection?.license?.url,
        trademarkNotice: kind === "logo",
      } as ImageStudioItem,
    ];
  });

const iconPriority = (item: ImageStudioItem, query: string) => {
  const prefix = item.providerId.split(":")[0];
  const colorIndex = COLOR_COLLECTION_PRIORITY.indexOf(prefix);
  if (colorIndex >= 0) {
    return colorIndex;
  }
  if (item.kind === "logo") {
    const logoQuery =
      /\b(logo|brand)\b/i.test(query) ||
      item.title.toLowerCase().includes(query.toLowerCase());
    return logoQuery ? 20 : 80;
  }
  const lowPriorityIndex = LOW_PRIORITY_COLLECTIONS.indexOf(prefix);
  return lowPriorityIndex >= 0 ? 100 + lowPriorityIndex : 40;
};

const canonicalIconName = (title: string) =>
  title
    .toLowerCase()
    .replace(
      /\b(outline|outlined|fill|filled|solid|line|regular|round|sharp|color|colour|two tone|twotone)\b/g,
      "",
    )
    .replace(/\b(16|20|24|28|32|48)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const curateIconifyResults = (
  items: ImageStudioItem[],
  query: string,
  limit = ICONIFY_RESULT_LIMIT,
) => {
  const collectionCounts = new Map<string, number>();
  const exactNames = new Set<string>();
  return [...items]
    .sort(
      (left, right) =>
        iconPriority(left, query) - iconPriority(right, query) ||
        left.title.localeCompare(right.title),
    )
    .filter((item) => {
      const collection = item.providerId.split(":")[0];
      const count = collectionCounts.get(collection) ?? 0;
      if (count >= 2) {
        return false;
      }
      const canonical = canonicalIconName(item.title);
      const dedupeKey =
        COLOR_COLLECTION_PRIORITY.includes(collection) && canonical
          ? `${collection}:${canonical}`
          : canonical;
      if (dedupeKey && exactNames.has(dedupeKey)) {
        return false;
      }
      collectionCounts.set(collection, count + 1);
      if (dedupeKey) {
        exactNames.add(dedupeKey);
      }
      return true;
    })
    .slice(0, limit);
};

export const interleaveResults = (
  iconify: ImageStudioItem[],
  pixabay: ImageStudioItem[],
) => {
  const results: ImageStudioItem[] = [];
  let iconIndex = 0;
  let pixabayIndex = 0;
  while (
    results.length < SEARCH_LIMIT &&
    (iconIndex < iconify.length || pixabayIndex < pixabay.length)
  ) {
    for (
      let offset = 0;
      offset < 3 && iconIndex < iconify.length && results.length < SEARCH_LIMIT;
      offset++
    ) {
      results.push(iconify[iconIndex++]);
    }
    if (pixabayIndex < pixabay.length && results.length < SEARCH_LIMIT) {
      results.push(pixabay[pixabayIndex++]);
    }
  }
  return results;
};

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers,
    },
  });

const fetchJson = async <T>(url: string) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "draw.yaseenarshad.com Image Studio" },
  });
  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}`);
  }
  return (await response.json()) as T;
};

const getCache = () =>
  typeof caches === "undefined" ? undefined : caches.default;

const cachedJsonFetch = async <T>(
  cacheKey: string,
  sourceUrl: string,
): Promise<T> => {
  const cache = getCache();
  const request = new Request(cacheKey);
  const cached = await cache?.match(request);
  if (cached) {
    return (await cached.json()) as T;
  }
  const payload = await fetchJson<T>(sourceUrl);
  await cache?.put(
    request,
    Response.json(payload, {
      headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
    }),
  );
  return payload;
};

const pixabaySearchUrl = (
  query: string,
  page: number,
  imageType: "vector" | "illustration",
  key: string,
) => {
  const url = new URL(PIXABAY_API);
  url.searchParams.set("key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "20");
  url.searchParams.set("image_type", imageType);
  url.searchParams.set("colors", "transparent");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("order", "popular");
  return url;
};

export const buildPixabaySearchUrls = (
  query: string,
  page: number,
  key: string,
) => [
  pixabaySearchUrl(query, page, "vector", key),
  pixabaySearchUrl(query, page, "illustration", key),
];

const fetchPixabaySearch = async (
  query: string,
  page: number,
  env: ImageStudioEnv,
) => {
  if (!env.PIXABAY_API_KEY) {
    throw new Error("Pixabay is not configured");
  }
  const urls = buildPixabaySearchUrls(query, page, env.PIXABAY_API_KEY);
  const payloads = await Promise.all(
    urls.map((url) =>
      cachedJsonFetch<{ hits?: PixabayHit[]; totalHits?: number }>(
        `https://image-studio-cache.invalid/pixabay/search/${encodeURIComponent(
          query,
        )}/${page}/${url.searchParams.get("image_type")}`,
        url.toString(),
      ),
    ),
  );
  const seen = new Set<number>();
  return {
    hits: payloads
      .flatMap(({ hits }) => hits ?? [])
      .filter((hit) => {
        if (hit.id === undefined || seen.has(hit.id)) {
          return false;
        }
        seen.add(hit.id);
        return true;
      }),
    hasMore: payloads.some(
      ({ hits, totalHits }) =>
        page * 20 <
        (numberValue(totalHits) ??
          (hits?.length === 20 ? page * 20 + 1 : page * 20)),
    ),
  };
};

const parseCursor = (cursor: string | null) => {
  const page = Number(cursor);
  return Number.isInteger(page) && page > 0 ? page : 1;
};

const searchIconify = async (
  query: string,
  page: number,
  source: ImageStudioSearchSource,
): Promise<ProviderSearchResult> => {
  const start = (page - 1) * ICONIFY_FETCH_LIMIT;
  const iconifyUrl = new URL(`${ICONIFY_API}/search`);
  iconifyUrl.searchParams.set("query", query);
  iconifyUrl.searchParams.set("limit", String(ICONIFY_FETCH_LIMIT));
  iconifyUrl.searchParams.set("start", String(start));
  const payload = await fetchJson<IconifySearchPayload>(iconifyUrl.toString());
  const items = curateIconifyResults(
    normalizeIconifyResults(payload),
    query,
    source === "iconify" ? SEARCH_LIMIT : ICONIFY_RESULT_LIMIT,
  );
  const fetchedCount = payload.icons?.length ?? 0;
  const total = numberValue(payload.total);
  return {
    items,
    hasMore:
      total !== undefined
        ? start + fetchedCount < total
        : fetchedCount === ICONIFY_FETCH_LIMIT,
  };
};

const searchPixabay = async (
  query: string,
  page: number,
  source: ImageStudioSearchSource,
  env: ImageStudioEnv,
): Promise<ProviderSearchResult> => {
  const payload = await fetchPixabaySearch(query, page, env);
  return {
    items: normalizePixabayResults(payload).slice(
      0,
      source === "pixabay" ? SEARCH_LIMIT : PIXABAY_RESULT_LIMIT,
    ),
    hasMore: payload.hasMore,
  };
};

type SearchProvider = Exclude<ImageStudioSearchSource, "all">;

const PROVIDER_SEARCHERS: Record<
  SearchProvider,
  (
    query: string,
    page: number,
    source: ImageStudioSearchSource,
    env: ImageStudioEnv,
  ) => Promise<ProviderSearchResult>
> = {
  iconify: (query, page, source) => searchIconify(query, page, source),
  pixabay: searchPixabay,
};

const providerWarning = (
  provider: SearchProvider,
  env: ImageStudioEnv,
): ImageStudioSearchResponse["warnings"][number] => ({
  provider,
  message:
    provider === "iconify"
      ? "Icons are temporarily unavailable."
      : env.PIXABAY_API_KEY
      ? "Pixabay graphics are temporarily unavailable."
      : "Pixabay graphics need an API key.",
});

const searchUncached = async (
  request: Request,
  env: ImageStudioEnv,
): Promise<Response> => {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (query.length < 2) {
    return json({ error: "Enter at least two characters" }, { status: 400 });
  }
  const source = url.searchParams.get("source") ?? "all";
  if (source !== "all" && source !== "iconify" && source !== "pixabay") {
    return json({ error: "Unknown search source" }, { status: 400 });
  }
  const page = parseCursor(url.searchParams.get("cursor"));
  const providers: SearchProvider[] =
    source === "all" ? ["iconify", "pixabay"] : [source];
  const settled = await Promise.allSettled(
    providers.map((provider) =>
      PROVIDER_SEARCHERS[provider](query, page, source, env),
    ),
  );
  const warnings: ImageStudioSearchResponse["warnings"] = [];
  const resultsByProvider = new Map<SearchProvider, ProviderSearchResult>();
  settled.forEach((result, index) => {
    const provider = providers[index];
    if (result.status === "fulfilled") {
      resultsByProvider.set(provider, result.value);
    } else {
      warnings.push(providerWarning(provider, env));
    }
  });
  const iconifyResults = resultsByProvider.get("iconify")?.items ?? [];
  const pixabayResults = resultsByProvider.get("pixabay")?.items ?? [];
  const results =
    source === "all"
      ? interleaveResults(iconifyResults, pixabayResults)
      : resultsByProvider.get(source)?.items ?? [];
  const hasMore = [...resultsByProvider.values()].some(
    (result) => result.hasMore,
  );
  return json({
    results,
    cursor: hasMore ? String(page + 1) : null,
    warnings,
  } as ImageStudioSearchResponse);
};

const search = async (request: Request, env: ImageStudioEnv) => {
  const cache = getCache();
  if (env.PIXABAY_API_KEY) {
    const cached = await cache?.match(request);
    if (cached) {
      return cached;
    }
  }
  const response = await searchUncached(request, env);
  if (response.ok && env.PIXABAY_API_KEY) {
    const cachedResponse = new Response(response.clone().body, response);
    cachedResponse.headers.set(
      "Cache-Control",
      `public, max-age=60, s-maxage=${CACHE_SECONDS}`,
    );
    await cache?.put(request, cachedResponse);
  }
  return response;
};

const getPixabayRecord = async (id: string, env: ImageStudioEnv) => {
  if (!env.PIXABAY_API_KEY || !/^\d+$/.test(id)) {
    throw new Error("Pixabay is not configured");
  }
  const url = new URL(PIXABAY_API);
  url.searchParams.set("key", env.PIXABAY_API_KEY);
  url.searchParams.set("id", id);
  const payload = await cachedJsonFetch<{ hits?: PixabayHit[] }>(
    `https://image-studio-cache.invalid/pixabay/item/${id}`,
    url.toString(),
  );
  const hit = payload.hits?.find((candidate) => String(candidate.id) === id);
  if (!hit) {
    throw new Error("Image not found");
  }
  return hit;
};

const getSource = async (
  provider: string,
  providerId: string,
  preview: boolean,
  env: ImageStudioEnv,
) => {
  if (provider === "iconify") {
    if (!/^[a-z0-9-]+:[a-z0-9-]+$/i.test(providerId)) {
      throw new Error("Invalid icon");
    }
    const [prefix, name] = providerId.split(":");
    return `${ICONIFY_API}/${encodeURIComponent(prefix)}/${encodeURIComponent(
      name,
    )}.svg`;
  }
  if (provider === "pixabay") {
    const record = await getPixabayRecord(providerId, env);
    const source = preview
      ? record.previewURL
      : record.vectorURL ?? record.largeImageURL ?? record.webformatURL;
    if (typeof source !== "string" || !source.startsWith("https://")) {
      throw new Error("Image source unavailable");
    }
    return source;
  }
  throw new Error("Unknown image provider");
};

const proxyImage = async (
  provider: string,
  providerId: string,
  preview: boolean,
  env: ImageStudioEnv,
) => {
  const cache = getCache();
  const cacheKey = new Request(
    `https://image-studio-cache.invalid/image/${provider}/${encodeURIComponent(
      providerId,
    )}/${preview ? "preview" : "import"}`,
  );
  if (preview) {
    const cached = await cache?.match(cacheKey);
    if (cached) {
      return cached;
    }
  }
  let source: string;
  try {
    source = await getSource(provider, providerId, preview, env);
  } catch {
    return json({ error: "Image not found" }, { status: 404 });
  }
  const response = await fetch(source, { redirect: "follow" });
  if (!response.ok || !response.body) {
    return json({ error: "Image provider failed" }, { status: 502 });
  }
  const contentType = response.headers.get("Content-Type")?.split(";")[0] ?? "";
  const contentLength = Number(response.headers.get("Content-Length") ?? 0);
  if (!contentType.startsWith("image/")) {
    return json(
      { error: "Provider response was not an image" },
      { status: 415 },
    );
  }
  if (contentLength > MAX_IMPORT_BYTES) {
    return json(
      { error: "Image exceeds the 20 MB import limit" },
      { status: 413 },
    );
  }
  const proxied = new Response(response.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": preview
        ? `public, max-age=${CACHE_SECONDS}`
        : "private, no-store",
      ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
    },
  });
  if (preview) {
    await cache?.put(cacheKey, proxied.clone());
  }
  return proxied;
};

export const handleImageStudioRequest = async (
  request: Request,
  env: ImageStudioEnv,
) => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/image-studio/search") {
    return search(request, env);
  }
  const match = url.pathname.match(
    /^\/api\/image-studio\/(preview|import)\/(pixabay|iconify)\/([^/]+)$/,
  );
  if (request.method === "GET" && match) {
    return proxyImage(
      match[2],
      decodeURIComponent(match[3]),
      match[1] === "preview",
      env,
    );
  }
  return json({ error: "Not found" }, { status: 404 });
};
