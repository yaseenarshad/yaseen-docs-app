import type {
  ImageStudioItem,
  ImageStudioSearchResponse,
} from "../image-studio/types";

export type ImageStudioEnv = {
  OPENVERSE_CLIENT_ID?: string;
  OPENVERSE_CLIENT_SECRET?: string;
};

const ALLOWED_OPENVERSE_LICENSES = new Set(["cc0", "pdm", "by", "by-sa"]);
const SEARCH_LIMIT = 36;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const OPENVERSE_API = "https://api.openverse.org/v1";
const ICONIFY_API = "https://api.iconify.design";

const stringValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const normalizeOpenverseResults = (payload: {
  results?: Array<Record<string, unknown>>;
}): ImageStudioItem[] =>
  (payload.results ?? []).flatMap((raw) => {
    const id = stringValue(raw.id);
    const license = stringValue(raw.license)?.toLowerCase();
    if (!id || !license || !ALLOWED_OPENVERSE_LICENSES.has(license)) {
      return [];
    }
    const version = stringValue(raw.license_version);
    const title = stringValue(raw.title) ?? "Untitled image";
    const creator = stringValue(raw.creator);
    return [
      {
        itemKey: `openverse:${id}`,
        provider: "openverse",
        providerId: id,
        kind: raw.category === "illustration" ? "illustration" : "photo",
        title,
        previewUrl: `/api/image-studio/preview/openverse/${encodeURIComponent(
          id,
        )}`,
        creator,
        creatorUrl: stringValue(raw.creator_url),
        collectionName: stringValue(raw.source) ?? "Openverse",
        sourceUrl: stringValue(raw.foreign_landing_url),
        licenseName:
          license === "pdm"
            ? "Public Domain Mark"
            : license === "cc0"
            ? "CC0"
            : `CC ${license.toUpperCase()}${version ? ` ${version}` : ""}`,
        licenseUrl: stringValue(raw.license_url),
        attribution:
          stringValue(raw.attribution) ??
          `${title}${creator ? ` by ${creator}` : ""}`,
        width: numberValue(raw.width),
        height: numberValue(raw.height),
      } as ImageStudioItem,
    ];
  });

export const normalizeIconifyResults = (payload: {
  icons?: string[];
  collections?: Record<
    string,
    {
      name?: string;
      category?: string;
      license?: { title?: string; url?: string; spdx?: string };
    }
  >;
}): ImageStudioItem[] =>
  (payload.icons ?? []).flatMap((providerId) => {
    const separator = providerId.indexOf(":");
    if (separator < 1 || separator === providerId.length - 1) {
      return [];
    }
    const prefix = providerId.slice(0, separator);
    const iconName = providerId.slice(separator + 1);
    const collection = payload.collections?.[prefix];
    const isLogo =
      prefix === "simple-icons" ||
      /brand|logo|social/i.test(collection?.category ?? "");
    return [
      {
        itemKey: `iconify:${providerId}`,
        provider: "iconify",
        providerId,
        kind: isLogo ? "logo" : "icon",
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
        trademarkNotice: isLogo,
      } as ImageStudioItem,
    ];
  });

export const interleaveResults = (
  left: ImageStudioItem[],
  right: ImageStudioItem[],
) => {
  const results: ImageStudioItem[] = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index]) {
      results.push(left[index]);
    }
    if (right[index]) {
      results.push(right[index]);
    }
  }
  return results;
};

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300",
      ...init.headers,
    },
  });

const fetchJson = async <T>(url: string) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "draw.yasinarshad.com Image Studio" },
  });
  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}`);
  }
  return (await response.json()) as T;
};

const parseCursor = (cursor: string | null) => {
  if (!cursor) {
    return { openversePage: 1, iconifyStart: 0 };
  }
  const [openversePage, iconifyStart] = cursor.split(":").map(Number);
  return {
    openversePage:
      Number.isInteger(openversePage) && openversePage > 0 ? openversePage : 1,
    iconifyStart:
      Number.isInteger(iconifyStart) && iconifyStart >= 0 ? iconifyStart : 0,
  };
};

const search = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (query.length < 2) {
    return json({ error: "Enter at least two characters" }, { status: 400 });
  }
  const cursor = parseCursor(url.searchParams.get("cursor"));
  const perProvider = SEARCH_LIMIT / 2;
  const openverseUrl = new URL(`${OPENVERSE_API}/images/`);
  openverseUrl.searchParams.set("q", query);
  openverseUrl.searchParams.set("page_size", String(perProvider));
  openverseUrl.searchParams.set("page", String(cursor.openversePage));
  openverseUrl.searchParams.set("license", "cc0,pdm,by,by-sa");
  const iconifyUrl = new URL(`${ICONIFY_API}/search`);
  iconifyUrl.searchParams.set("query", query);
  iconifyUrl.searchParams.set("limit", String(perProvider));
  iconifyUrl.searchParams.set("start", String(cursor.iconifyStart));

  const [openverse, iconify] = await Promise.allSettled([
    fetchJson<{ results?: Array<Record<string, unknown>> }>(
      openverseUrl.toString(),
    ),
    fetchJson<{
      icons?: string[];
      collections?: Parameters<
        typeof normalizeIconifyResults
      >[0]["collections"];
      total?: number;
    }>(iconifyUrl.toString()),
  ]);

  const warnings: ImageStudioSearchResponse["warnings"] = [];
  if (openverse.status === "rejected") {
    warnings.push({
      provider: "openverse",
      message: "Photos are temporarily unavailable.",
    });
  }
  if (iconify.status === "rejected") {
    warnings.push({
      provider: "iconify",
      message: "Icons are temporarily unavailable.",
    });
  }
  const openverseResults =
    openverse.status === "fulfilled"
      ? normalizeOpenverseResults(openverse.value)
      : [];
  const iconifyResults =
    iconify.status === "fulfilled"
      ? normalizeIconifyResults(iconify.value)
      : [];
  const results = interleaveResults(openverseResults, iconifyResults).slice(
    0,
    SEARCH_LIMIT,
  );
  return json({
    results,
    cursor:
      results.length > 0
        ? `${cursor.openversePage + 1}:${cursor.iconifyStart + perProvider}`
        : null,
    warnings,
  } as ImageStudioSearchResponse);
};

const getOpenverseRecord = (id: string) =>
  fetchJson<Record<string, unknown>>(
    `${OPENVERSE_API}/images/${encodeURIComponent(id)}/`,
  );

const getSource = async (
  provider: string,
  providerId: string,
  preview: boolean,
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
  if (provider === "openverse" && /^[a-z0-9-]+$/i.test(providerId)) {
    if (preview) {
      return `${OPENVERSE_API}/images/${encodeURIComponent(providerId)}/thumb/`;
    }
    const record = await getOpenverseRecord(providerId);
    const source = record.url;
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
) => {
  let source: string;
  try {
    source = await getSource(provider, providerId, preview);
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
  return new Response(response.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": preview
        ? "public, max-age=86400, s-maxage=604800"
        : "private, no-store",
      ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
    },
  });
};

export const handleImageStudioRequest = async (
  request: Request,
  _env: ImageStudioEnv,
) => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/image-studio/search") {
    return search(request);
  }
  const match = url.pathname.match(
    /^\/api\/image-studio\/(preview|import)\/(openverse|iconify)\/([^/]+)$/,
  );
  if (request.method === "GET" && match) {
    return proxyImage(
      match[2],
      decodeURIComponent(match[3]),
      match[1] === "preview",
    );
  }
  return json({ error: "Not found" }, { status: 404 });
};
