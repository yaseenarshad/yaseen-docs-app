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

const SEARCH_LIMIT = 18;
const ICONIFY_ALL_RESULT_LIMIT = 14;
const PIXABAY_ALL_RESULT_LIMIT = SEARCH_LIMIT - ICONIFY_ALL_RESULT_LIMIT;
const ICONIFY_COLOR_BATCH_LIMIT = 6;
const PIXABAY_PAGE_SIZE = 4;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const CACHE_SECONDS = 24 * 60 * 60;
const SEARCH_CACHE_VERSION = "2";
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

type SearchProvider = Exclude<ImageStudioSearchSource, "all">;
type PixabayImageType = "vector" | "illustration";

type IconifyCursor = {
  colorStart: number;
  generalStart: number;
  colorExhausted: boolean;
  generalExhausted: boolean;
};

type PixabayCursor = {
  vectorPage: number;
  illustrationPage: number;
  nextType: PixabayImageType;
  vectorExhausted: boolean;
  illustrationExhausted: boolean;
  seenIds: string[];
};

type SearchCursor = {
  version: 1;
  query: string;
  source: ImageStudioSearchSource;
  iconify: IconifyCursor;
  pixabay: PixabayCursor;
};

type ProviderCursor = {
  iconify: IconifyCursor;
  pixabay: PixabayCursor;
};

type ProviderSearchResult<Provider extends SearchProvider> = {
  items: ImageStudioItem[];
  cursor: ProviderCursor[Provider];
  hasMore: boolean;
};

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

export const curateIconifyResults = (
  items: ImageStudioItem[],
  query: string,
  limit = SEARCH_LIMIT,
) => {
  const itemKeys = new Set<string>();
  return [...items]
    .sort(
      (left, right) =>
        iconPriority(left, query) - iconPriority(right, query) ||
        left.title.localeCompare(right.title),
    )
    .filter((item) => {
      if (itemKeys.has(item.itemKey)) {
        return false;
      }
      itemKeys.add(item.itemKey);
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
  imageType: PixabayImageType,
  key: string,
  perPage = 20,
) => {
  const url = new URL(PIXABAY_API);
  url.searchParams.set("key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
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
  perPage = 20,
) => [
  pixabaySearchUrl(query, page, "vector", key, perPage),
  pixabaySearchUrl(query, page, "illustration", key, perPage),
];

const fetchPixabayPage = async (
  query: string,
  imageType: PixabayImageType,
  page: number,
  env: ImageStudioEnv,
) => {
  if (!env.PIXABAY_API_KEY) {
    throw new Error("Pixabay is not configured");
  }
  const url = pixabaySearchUrl(
    query,
    page,
    imageType,
    env.PIXABAY_API_KEY,
    PIXABAY_PAGE_SIZE,
  );
  const payload = await cachedJsonFetch<{
    hits?: PixabayHit[];
    totalHits?: number;
  }>(
    `https://image-studio-cache.invalid/pixabay/search/${encodeURIComponent(
      query,
    )}/${imageType}/${page}/${PIXABAY_PAGE_SIZE}`,
    url.toString(),
  );
  const hits = payload.hits ?? [];
  const totalHits = numberValue(payload.totalHits);
  return {
    hits,
    hasMore:
      totalHits !== undefined
        ? page * PIXABAY_PAGE_SIZE < totalHits
        : hits.length === PIXABAY_PAGE_SIZE,
  };
};

const colorCollectionSet = new Set(COLOR_COLLECTION_PRIORITY);

const fetchIconifyPage = async (
  query: string,
  start: number,
  limit: number,
  prefixes?: string[],
) => {
  const iconifyUrl = new URL(`${ICONIFY_API}/search`);
  iconifyUrl.searchParams.set("query", query);
  iconifyUrl.searchParams.set("limit", String(limit));
  iconifyUrl.searchParams.set("start", String(start));
  if (prefixes?.length) {
    iconifyUrl.searchParams.set("prefixes", prefixes.join(","));
  }
  const payload = await fetchJson<IconifySearchPayload>(iconifyUrl.toString());
  const fetchedCount = payload.icons?.length ?? 0;
  const total = numberValue(payload.total);
  const responseLimit = numberValue(payload.limit) ?? limit;
  return {
    items: normalizeIconifyResults(payload),
    fetchedCount,
    responseLimit,
    total,
  };
};

const iconifyPageExhausted = (
  start: number,
  consumedCount: number,
  page: Awaited<ReturnType<typeof fetchIconifyPage>>,
) =>
  page.total !== undefined
    ? start + consumedCount >= page.total
    : consumedCount === page.fetchedCount &&
      page.fetchedCount < page.responseLimit;

const searchIconify = async (
  query: string,
  currentCursor: IconifyCursor,
  limit: number,
): Promise<ProviderSearchResult<"iconify">> => {
  const cursor = { ...currentCursor };
  const items: ImageStudioItem[] = [];
  if (!cursor.colorExhausted && limit > 0) {
    const start = cursor.colorStart;
    const page = await fetchIconifyPage(
      query,
      start,
      Math.min(ICONIFY_COLOR_BATCH_LIMIT, limit),
      COLOR_COLLECTION_PRIORITY,
    );
    const returnedItems = page.items.slice(0, limit);
    const consumedCount =
      returnedItems.length || page.fetchedCount === 0
        ? returnedItems.length
        : page.fetchedCount;
    cursor.colorStart += consumedCount;
    cursor.colorExhausted = iconifyPageExhausted(start, consumedCount, page);
    items.push(...returnedItems);
  }

  let requests = 0;
  while (items.length < limit && !cursor.generalExhausted && requests < 8) {
    const start = cursor.generalStart;
    const page = await fetchIconifyPage(query, start, limit - items.length);
    let consumedCount = 0;
    for (const item of page.items) {
      consumedCount++;
      if (!colorCollectionSet.has(item.providerId.split(":")[0])) {
        items.push(item);
      }
      if (items.length === limit) {
        break;
      }
    }
    if (consumedCount === 0 && page.fetchedCount > 0) {
      consumedCount = page.fetchedCount;
    }
    cursor.generalStart += consumedCount;
    cursor.generalExhausted = iconifyPageExhausted(start, consumedCount, page);
    requests++;
    if (consumedCount === 0) {
      break;
    }
  }

  return {
    items: items.slice(0, limit),
    cursor,
    hasMore: !cursor.colorExhausted || !cursor.generalExhausted,
  };
};

const oppositePixabayType = (type: PixabayImageType): PixabayImageType =>
  type === "vector" ? "illustration" : "vector";

const nextPixabayType = (cursor: PixabayCursor) => {
  if (!cursor[`${cursor.nextType}Exhausted`]) {
    return cursor.nextType;
  }
  const alternate = oppositePixabayType(cursor.nextType);
  return cursor[`${alternate}Exhausted`] ? null : alternate;
};

const searchPixabay = async (
  query: string,
  currentCursor: PixabayCursor,
  limit: number,
  env: ImageStudioEnv,
): Promise<ProviderSearchResult<"pixabay">> => {
  const cursor = {
    ...currentCursor,
    seenIds: [...currentCursor.seenIds],
  };
  const items: ImageStudioItem[] = [];
  const seenIds = new Set(cursor.seenIds);
  const maxRequests = Math.ceil(limit / PIXABAY_PAGE_SIZE) + 2;
  let requests = 0;
  while (items.length + PIXABAY_PAGE_SIZE <= limit && requests < maxRequests) {
    const imageType = nextPixabayType(cursor);
    if (!imageType) {
      break;
    }
    const pageKey = `${imageType}Page` as const;
    const exhaustedKey = `${imageType}Exhausted` as const;
    const payload = await fetchPixabayPage(
      query,
      imageType,
      cursor[pageKey],
      env,
    );
    cursor[pageKey]++;
    cursor[exhaustedKey] = !payload.hasMore;
    cursor.nextType = oppositePixabayType(imageType);
    for (const item of normalizePixabayResults(payload)) {
      if (!seenIds.has(item.providerId)) {
        seenIds.add(item.providerId);
        items.push(item);
      }
    }
    requests++;
  }
  cursor.seenIds = [...seenIds];
  return {
    items,
    cursor,
    hasMore: !cursor.vectorExhausted || !cursor.illustrationExhausted,
  };
};

type AnyProviderSearchResult =
  | ProviderSearchResult<"iconify">
  | ProviderSearchResult<"pixabay">;

const initialCursor = (
  query: string,
  source: ImageStudioSearchSource,
): SearchCursor => ({
  version: 1,
  query,
  source,
  iconify: {
    colorStart: 0,
    generalStart: 0,
    colorExhausted: false,
    generalExhausted: false,
  },
  pixabay: {
    vectorPage: 1,
    illustrationPage: 1,
    nextType: "vector",
    vectorExhausted: false,
    illustrationExhausted: false,
    seenIds: [],
  },
});

const encodeCursor = (cursor: SearchCursor) => {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

const decodeCursor = (
  value: string | null,
  query: string,
  source: ImageStudioSearchSource,
) => {
  if (!value) {
    return initialCursor(query, source);
  }
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const cursor = JSON.parse(new TextDecoder().decode(bytes)) as SearchCursor;
    const validInteger = (candidate: unknown, minimum: number) =>
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= minimum;
    const validBoolean = (candidate: unknown) => typeof candidate === "boolean";
    if (
      cursor.version !== 1 ||
      cursor.query !== query ||
      cursor.source !== source ||
      !validInteger(cursor.iconify?.colorStart, 0) ||
      !validInteger(cursor.iconify?.generalStart, 0) ||
      !validBoolean(cursor.iconify?.colorExhausted) ||
      !validBoolean(cursor.iconify?.generalExhausted) ||
      !validInteger(cursor.pixabay?.vectorPage, 1) ||
      !validInteger(cursor.pixabay?.illustrationPage, 1) ||
      (cursor.pixabay?.nextType !== "vector" &&
        cursor.pixabay?.nextType !== "illustration") ||
      !validBoolean(cursor.pixabay?.vectorExhausted) ||
      !validBoolean(cursor.pixabay?.illustrationExhausted) ||
      (cursor.pixabay?.seenIds !== undefined &&
        (!Array.isArray(cursor.pixabay.seenIds) ||
          cursor.pixabay.seenIds.length > 1000 ||
          !cursor.pixabay.seenIds.every(
            (candidate) =>
              typeof candidate === "string" && /^\d+$/.test(candidate),
          )))
    ) {
      throw new Error("Invalid search cursor");
    }
    cursor.pixabay.seenIds ??= [];
    return cursor;
  } catch {
    throw new Error("Invalid search cursor");
  }
};

const searchProvider = (
  provider: SearchProvider,
  query: string,
  cursor: SearchCursor,
  limit: number,
  env: ImageStudioEnv,
): Promise<AnyProviderSearchResult> =>
  provider === "iconify"
    ? searchIconify(query, cursor.iconify, limit)
    : searchPixabay(query, cursor.pixabay, limit, env);

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
  let cursor: SearchCursor;
  try {
    cursor = decodeCursor(url.searchParams.get("cursor"), query, source);
  } catch (cause) {
    return json(
      {
        error: cause instanceof Error ? cause.message : "Invalid search cursor",
      },
      { status: 400 },
    );
  }
  const providers: SearchProvider[] =
    source === "all" ? ["iconify", "pixabay"] : [source];
  const limits: Record<SearchProvider, number> =
    source === "all"
      ? {
          iconify: ICONIFY_ALL_RESULT_LIMIT,
          pixabay: PIXABAY_ALL_RESULT_LIMIT,
        }
      : { iconify: SEARCH_LIMIT, pixabay: SEARCH_LIMIT };
  const settled = await Promise.allSettled(
    providers.map((provider) =>
      searchProvider(provider, query, cursor, limits[provider], env),
    ),
  );
  const warnings: ImageStudioSearchResponse["warnings"] = [];
  const warnedProviders = new Set<SearchProvider>();
  const successfulProviders = new Set<SearchProvider>();
  const resultsByProvider = new Map<SearchProvider, ImageStudioItem[]>();
  const appendResult = (
    provider: SearchProvider,
    result: AnyProviderSearchResult,
  ) => {
    const current = resultsByProvider.get(provider) ?? [];
    const itemKeys = new Set(current.map(({ itemKey }) => itemKey));
    resultsByProvider.set(provider, [
      ...current,
      ...result.items.filter(({ itemKey }) => {
        if (itemKeys.has(itemKey)) {
          return false;
        }
        itemKeys.add(itemKey);
        return true;
      }),
    ]);
    if (provider === "iconify") {
      cursor.iconify = result.cursor as IconifyCursor;
    } else {
      cursor.pixabay = result.cursor as PixabayCursor;
    }
  };
  const warn = (provider: SearchProvider) => {
    if (!warnedProviders.has(provider)) {
      warnedProviders.add(provider);
      warnings.push(providerWarning(provider, env));
    }
    if (provider === "pixabay" && !env.PIXABAY_API_KEY) {
      cursor.pixabay.vectorExhausted = true;
      cursor.pixabay.illustrationExhausted = true;
    }
  };
  settled.forEach((result, index) => {
    const provider = providers[index];
    if (result.status === "fulfilled") {
      successfulProviders.add(provider);
      appendResult(provider, result.value);
    } else {
      warn(provider);
    }
  });

  if (source === "all") {
    for (const provider of providers) {
      const resultCount = [...resultsByProvider.values()].reduce(
        (total, items) => total + items.length,
        0,
      );
      const remaining = SEARCH_LIMIT - resultCount;
      if (remaining <= 0 || !successfulProviders.has(provider)) {
        continue;
      }
      try {
        const refill = await searchProvider(
          provider,
          query,
          cursor,
          remaining,
          env,
        );
        appendResult(provider, refill);
      } catch {
        warn(provider);
      }
    }
  }

  const iconifyResults = resultsByProvider.get("iconify") ?? [];
  const pixabayResults = resultsByProvider.get("pixabay") ?? [];
  const results =
    source === "all"
      ? interleaveResults(iconifyResults, pixabayResults)
      : resultsByProvider.get(source) ?? [];
  const hasMore = providers.some((provider) =>
    provider === "iconify"
      ? !cursor.iconify.colorExhausted || !cursor.iconify.generalExhausted
      : !cursor.pixabay.vectorExhausted ||
        !cursor.pixabay.illustrationExhausted,
  );
  return json({
    results,
    cursor: hasMore ? encodeCursor(cursor) : null,
    warnings,
  } as ImageStudioSearchResponse);
};

const search = async (request: Request, env: ImageStudioEnv) => {
  const cache = getCache();
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.set("_iscv", SEARCH_CACHE_VERSION);
  const cacheKey = new Request(cacheUrl, request);
  if (env.PIXABAY_API_KEY) {
    const cached = await cache?.match(cacheKey);
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
    await cache?.put(cacheKey, cachedResponse);
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
