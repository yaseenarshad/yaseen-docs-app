import {
  BOARD_SCENE_DELETE_GRANT_PATH,
  BOARD_SCENE_ENCODING_HEADER,
  BOARD_SCENE_READ_GRANT_PATH,
  BOARD_SCENE_READ_ROUTE_PREFIX,
  BOARD_SCENE_ROUTE,
  BOARD_SCENE_TOKEN_PATTERN,
  BOARD_SCENE_UPLOAD_GRANT_PATH,
  MAX_BOARD_SCENE_COMPRESSED_BYTES,
  MAX_BOARD_SCENE_RAW_BYTES,
  parseBoardSceneDeleteGrant,
  parseBoardSceneReadGrant,
  parseBoardSceneUploadGrant,
} from "../board-scenes/types";

import type {
  BoardSceneDeleteGrant,
  BoardSceneReadGrant,
  BoardSceneUploadGrant,
} from "../board-scenes/types";

interface BoardSceneEnv {
  DIAGRAM_ASSETS: R2Bucket;
  CONVEX_SITE_URL: string;
}

/** Board scene objects are never publicly cacheable and never revalidated. */
const SCENE_OBJECT_CACHE_CONTROL = "private, max-age=31536000, immutable";
const SCENE_RESPONSE_CACHE_CONTROL = "private, max-age=300, immutable";
const DELETE_BATCH_SIZE = 1000;
const MAX_DELETE_PREFIX_PAGES = 100;

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init?.headers,
    },
  });

/**
 * Reads never disclose whether an object exists, which Board it belongs to, or
 * what its key is: every failure looks identical to a caller.
 */
const sceneNotFound = () =>
  new Response("Scene not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });

const bearerToken = (request: Request) => {
  const authorization = request.headers.get("Authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
};

const resolveGrant = async (
  env: BoardSceneEnv,
  path: string,
  token: string,
) => {
  const response = await fetch(`${env.CONVEX_SITE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as unknown;
};

export const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.buffer instanceof ArrayBuffer
          ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          : Uint8Array.from(bytes),
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * Buffers at most `maxBytes` of the request body. A declared `Content-Length`
 * is only a fast path: an under-declaring or chunked caller is still stopped
 * here. Other validation buffers and concurrent requests remain separately
 * bounded by the same per-payload limits.
 */
const readBoundedBody = async (
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | "missing" | "too-large"> => {
  const reader = request.body?.getReader();
  if (!reader) {
    return "missing";
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

type DecompressionResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "malformed" | "too-large" };

/**
 * Decompresses zlib/deflate bytes while rejecting output above the raw scene
 * ceiling. This bounds each expansion; total Worker memory also includes its
 * compressed input, chunk assembly, and any concurrent requests.
 */
const decompressScene = async (
  compressed: Uint8Array,
  maxBytes: number,
): Promise<DecompressionResult> => {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const written = writer
    .write(compressed)
    .then(async () => await writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        await written;
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    await written;
    return { ok: false, reason: "malformed" };
  }
  await written;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Mirrors the shape the Convex scene validators require: a top-level object
 * with an `elements` array and an `appState` object.
 */
const isBoardSceneDocument = (bytes: Uint8Array) => {
  let scene: unknown;
  try {
    scene = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    return false;
  }
  return (
    isRecord(scene) && Array.isArray(scene.elements) && isRecord(scene.appState)
  );
};

const uploadBoardScene = async (request: Request, env: BoardSceneEnv) => {
  const token = bearerToken(request);
  if (!token) {
    return json(
      { error: "Invalid or expired Board scene upload grant" },
      { status: 403 },
    );
  }
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > MAX_BOARD_SCENE_COMPRESSED_BYTES) {
    return json({ error: "Board scene is too large" }, { status: 413 });
  }
  const grant: BoardSceneUploadGrant | null = parseBoardSceneUploadGrant(
    await resolveGrant(env, BOARD_SCENE_UPLOAD_GRANT_PATH, token),
  );
  if (!grant) {
    return json(
      { error: "Invalid or expired Board scene upload grant" },
      { status: 403 },
    );
  }
  if (
    request.headers.get("Content-Type") !== grant.contentType ||
    request.headers.get(BOARD_SCENE_ENCODING_HEADER) !== grant.encoding
  ) {
    return json(
      { error: "Board scene content type or encoding does not match grant" },
      { status: 400 },
    );
  }
  const compressed = await readBoundedBody(
    request,
    MAX_BOARD_SCENE_COMPRESSED_BYTES,
  );
  if (compressed === "too-large") {
    return json({ error: "Board scene is too large" }, { status: 413 });
  }
  if (compressed === "missing") {
    return json({ error: "Board scene body is required" }, { status: 400 });
  }
  if (compressed.byteLength !== grant.compressedSize) {
    return json(
      { error: "Compressed Board scene size does not match grant" },
      { status: 400 },
    );
  }
  if ((await sha256Hex(compressed)) !== grant.compressedSha256) {
    return json(
      { error: "Compressed Board scene checksum does not match grant" },
      { status: 400 },
    );
  }
  const decompressed = await decompressScene(
    compressed,
    MAX_BOARD_SCENE_RAW_BYTES,
  );
  if (!decompressed.ok) {
    return decompressed.reason === "too-large"
      ? json({ error: "Board scene is too large" }, { status: 413 })
      : json(
          { error: "Board scene bytes could not be decompressed" },
          { status: 400 },
        );
  }
  if (decompressed.bytes.byteLength !== grant.rawSize) {
    return json(
      { error: "Board scene size does not match grant" },
      { status: 400 },
    );
  }
  if ((await sha256Hex(decompressed.bytes)) !== grant.rawSha256) {
    return json(
      { error: "Board scene checksum does not match grant" },
      { status: 400 },
    );
  }
  if (!isBoardSceneDocument(decompressed.bytes)) {
    return json({ error: "Board scene JSON is invalid" }, { status: 400 });
  }
  try {
    const object = await env.DIAGRAM_ASSETS.put(grant.objectKey, compressed, {
      httpMetadata: {
        contentType: grant.contentType,
        cacheControl: SCENE_OBJECT_CACHE_CONTROL,
      },
      customMetadata: {
        encoding: grant.encoding,
        compressedSha256: grant.compressedSha256,
        rawSha256: grant.rawSha256,
        rawSize: String(grant.rawSize),
        diagramId: grant.diagramId,
        version: String(grant.version),
      },
    });
    if (object.size !== grant.compressedSize) {
      throw new Error("Stored Board scene size does not match grant");
    }
    return json({
      etag: object.etag,
      encoding: grant.encoding,
      version: grant.version,
      compressedSize: grant.compressedSize,
      compressedSha256: grant.compressedSha256,
      rawSize: grant.rawSize,
      rawSha256: grant.rawSha256,
    });
  } catch {
    // A partial or mismatched object must never survive a failed upload.
    await env.DIAGRAM_ASSETS.delete(grant.objectKey);
    return json({ error: "Board scene could not be stored" }, { status: 500 });
  }
};

const serveBoardScene = async (
  request: Request,
  env: BoardSceneEnv,
  token: string,
) => {
  if (!BOARD_SCENE_TOKEN_PATTERN.test(token)) {
    return sceneNotFound();
  }
  const grant: BoardSceneReadGrant | null = parseBoardSceneReadGrant(
    await resolveGrant(env, BOARD_SCENE_READ_GRANT_PATH, token),
  );
  if (!grant) {
    return sceneNotFound();
  }
  const object = await env.DIAGRAM_ASSETS.get(grant.objectKey);
  if (
    !object ||
    object.size !== grant.compressedSize ||
    object.etag !== grant.etag ||
    object.customMetadata?.encoding !== grant.encoding ||
    object.customMetadata?.compressedSha256 !== grant.compressedSha256 ||
    object.customMetadata?.rawSha256 !== grant.rawSha256 ||
    object.customMetadata?.rawSize !== String(grant.rawSize) ||
    object.customMetadata?.diagramId !== grant.diagramId ||
    object.customMetadata?.version !== String(grant.version)
  ) {
    return sceneNotFound();
  }
  const headers = new Headers({
    "Content-Type": grant.contentType,
    "Content-Length": String(grant.compressedSize),
    [BOARD_SCENE_ENCODING_HEADER]: grant.encoding,
    ETag: object.httpEtag,
    "Cache-Control": SCENE_RESPONSE_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
};

const listPrefixKeys = async (env: BoardSceneEnv, prefix: string) => {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_DELETE_PREFIX_PAGES; page++) {
    const listed = await env.DIAGRAM_ASSETS.list({
      prefix,
      cursor,
      limit: DELETE_BATCH_SIZE,
    });
    for (const object of listed.objects) {
      keys.push(object.key);
    }
    if (!listed.truncated) {
      return keys;
    }
    cursor = listed.cursor;
  }
  return keys;
};

const deleteBoardScenes = async (request: Request, env: BoardSceneEnv) => {
  const token = bearerToken(request);
  if (!token) {
    return json(
      { error: "Invalid or expired Board scene delete grant" },
      { status: 403 },
    );
  }
  const grant: BoardSceneDeleteGrant | null = parseBoardSceneDeleteGrant(
    await resolveGrant(env, BOARD_SCENE_DELETE_GRANT_PATH, token),
  );
  if (!grant) {
    return json(
      { error: "Invalid or expired Board scene delete grant" },
      { status: 403 },
    );
  }
  const objectKeys = new Set(grant.objectKeys);
  if (grant.objectKeyPrefix) {
    for (const key of await listPrefixKeys(env, grant.objectKeyPrefix)) {
      objectKeys.add(key);
    }
  }
  const keys = Array.from(objectKeys);
  for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
    // Deleting an already deleted key is a no-op in R2, so retries are safe.
    await env.DIAGRAM_ASSETS.delete(
      keys.slice(index, index + DELETE_BATCH_SIZE),
    );
  }
  return json({ deleted: keys.length });
};

export const isBoardSceneRoute = (pathname: string) =>
  pathname === BOARD_SCENE_ROUTE ||
  pathname.startsWith(BOARD_SCENE_READ_ROUTE_PREFIX);

export const handleBoardSceneRequest = async (
  request: Request,
  env: BoardSceneEnv,
  url: URL,
) => {
  if (url.pathname === BOARD_SCENE_ROUTE) {
    if (request.method === "POST") {
      return await uploadBoardScene(request, env);
    }
    if (request.method === "DELETE") {
      return await deleteBoardScenes(request, env);
    }
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  if (request.method === "GET" || request.method === "HEAD") {
    return await serveBoardScene(
      request,
      env,
      url.pathname.slice(BOARD_SCENE_READ_ROUTE_PREFIX.length),
    );
  }
  return json({ error: "Method not allowed" }, { status: 405 });
};
