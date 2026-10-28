import {
  DOC_CONTENT_DELETE_GRANT_PATH,
  DOC_CONTENT_ENCODING_HEADER,
  DOC_CONTENT_READ_GRANT_PATH,
  DOC_CONTENT_READ_ROUTE_PREFIX,
  DOC_CONTENT_ROUTE,
  DOC_CONTENT_TOKEN_PATTERN,
  DOC_CONTENT_UPLOAD_GRANT_PATH,
  MAX_DOC_CONTENT_COMPRESSED_BYTES,
  MAX_DOC_CONTENT_RAW_BYTES,
  parseDocContentDeleteGrant,
  parseDocContentReadGrant,
  parseDocContentUploadGrant,
} from "../doc-content/types";

import type {
  DocContentDeleteGrant,
  DocContentReadGrant,
  DocContentUploadGrant,
} from "../doc-content/types";

interface DocContentEnv {
  DIAGRAM_ASSETS: R2Bucket;
  CONVEX_SITE_URL: string;
}

const OBJECT_CACHE_CONTROL = "private, max-age=31536000, immutable";
const RESPONSE_CACHE_CONTROL = "private, max-age=300, immutable";
const DELETE_BATCH_SIZE = 1000;
const MAX_DELETE_PREFIX_PAGES = 100;

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });

const notFound = () =>
  new Response("Doc content not found", {
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
  env: DocContentEnv,
  path: string,
  token: string,
) => {
  const response = await fetch(`${env.CONVEX_SITE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return response.ok ? ((await response.json()) as unknown) : null;
};

const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

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

const decompress = async (
  compressed: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array | "malformed" | "too-large"> => {
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
        return "too-large";
      }
      chunks.push(value);
    }
  } catch {
    await written;
    return "malformed";
  }
  await written;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const upload = async (request: Request, env: DocContentEnv) => {
  const token = bearerToken(request);
  if (!token) {
    return json({ error: "Invalid Doc content upload grant" }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > MAX_DOC_CONTENT_COMPRESSED_BYTES) {
    return json({ error: "Doc content is too large" }, { status: 413 });
  }
  const grant: DocContentUploadGrant | null = parseDocContentUploadGrant(
    await resolveGrant(env, DOC_CONTENT_UPLOAD_GRANT_PATH, token),
  );
  if (!grant) {
    return json({ error: "Invalid Doc content upload grant" }, { status: 403 });
  }
  if (
    request.headers.get("Content-Type") !== grant.contentType ||
    request.headers.get(DOC_CONTENT_ENCODING_HEADER) !== grant.encoding
  ) {
    return json(
      { error: "Doc content type or encoding does not match grant" },
      { status: 400 },
    );
  }
  const compressed = await readBoundedBody(
    request,
    MAX_DOC_CONTENT_COMPRESSED_BYTES,
  );
  if (compressed === "too-large") {
    return json({ error: "Doc content is too large" }, { status: 413 });
  }
  if (compressed === "missing") {
    return json({ error: "Doc content body is required" }, { status: 400 });
  }
  if (
    compressed.byteLength !== grant.compressedSize ||
    (await sha256Hex(compressed)) !== grant.compressedSha256
  ) {
    return json(
      { error: "Compressed Doc content integrity check failed" },
      { status: 400 },
    );
  }
  const raw = await decompress(compressed, MAX_DOC_CONTENT_RAW_BYTES);
  if (raw === "too-large") {
    return json({ error: "Doc content is too large" }, { status: 413 });
  }
  if (raw === "malformed") {
    return json(
      { error: "Doc content could not be decompressed" },
      { status: 400 },
    );
  }
  if (
    raw.byteLength !== grant.rawSize ||
    (await sha256Hex(raw)) !== grant.rawSha256
  ) {
    return json(
      { error: "Doc content integrity check failed" },
      { status: 400 },
    );
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return json({ error: "Doc content is not valid UTF-8" }, { status: 400 });
  }
  try {
    const object = await env.DIAGRAM_ASSETS.put(grant.objectKey, compressed, {
      httpMetadata: {
        contentType: grant.contentType,
        cacheControl: OBJECT_CACHE_CONTROL,
      },
      customMetadata: {
        encoding: grant.encoding,
        compressedSha256: grant.compressedSha256,
        rawSha256: grant.rawSha256,
        rawSize: String(grant.rawSize),
        docId: grant.docId,
        version: String(grant.version),
      },
    });
    if (object.size !== grant.compressedSize) {
      throw new Error("Stored Doc content size does not match grant");
    }
    return json({ etag: object.etag, version: grant.version });
  } catch {
    await env.DIAGRAM_ASSETS.delete(grant.objectKey);
    return json({ error: "Doc content could not be stored" }, { status: 500 });
  }
};

const serve = async (request: Request, env: DocContentEnv, token: string) => {
  if (!DOC_CONTENT_TOKEN_PATTERN.test(token)) {
    return notFound();
  }
  const grant: DocContentReadGrant | null = parseDocContentReadGrant(
    await resolveGrant(env, DOC_CONTENT_READ_GRANT_PATH, token),
  );
  if (!grant) {
    return notFound();
  }
  const object = await env.DIAGRAM_ASSETS.get(grant.objectKey);
  if (
    !object ||
    object.size !== grant.compressedSize ||
    object.etag !== grant.etag ||
    object.customMetadata?.encoding !== grant.encoding ||
    object.customMetadata?.compressedSha256 !== grant.compressedSha256 ||
    object.customMetadata?.rawSha256 !== grant.rawSha256 ||
    object.customMetadata?.docId !== grant.docId ||
    object.customMetadata?.version !== String(grant.version)
  ) {
    return notFound();
  }
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers: {
      "Content-Type": grant.contentType,
      "Content-Length": String(grant.compressedSize),
      [DOC_CONTENT_ENCODING_HEADER]: grant.encoding,
      ETag: object.httpEtag,
      "Cache-Control": RESPONSE_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
};

const listPrefixKeys = async (env: DocContentEnv, prefix: string) => {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_DELETE_PREFIX_PAGES; page++) {
    const listed = await env.DIAGRAM_ASSETS.list({
      prefix,
      cursor,
      limit: DELETE_BATCH_SIZE,
    });
    keys.push(...listed.objects.map((object) => object.key));
    if (!listed.truncated) {
      return keys;
    }
    cursor = listed.cursor;
  }
  return keys;
};

const remove = async (request: Request, env: DocContentEnv) => {
  const token = bearerToken(request);
  if (!token) {
    return json({ error: "Invalid Doc content delete grant" }, { status: 403 });
  }
  const grant: DocContentDeleteGrant | null = parseDocContentDeleteGrant(
    await resolveGrant(env, DOC_CONTENT_DELETE_GRANT_PATH, token),
  );
  if (!grant) {
    return json({ error: "Invalid Doc content delete grant" }, { status: 403 });
  }
  const objectKeys = new Set(grant.objectKeys);
  if (grant.objectKeyPrefix) {
    for (const key of await listPrefixKeys(env, grant.objectKeyPrefix)) {
      objectKeys.add(key);
    }
  }
  const keys = Array.from(objectKeys);
  for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
    await env.DIAGRAM_ASSETS.delete(
      keys.slice(index, index + DELETE_BATCH_SIZE),
    );
  }
  return json({ deleted: keys.length });
};

export const isDocContentRoute = (pathname: string) =>
  pathname === DOC_CONTENT_ROUTE ||
  pathname.startsWith(DOC_CONTENT_READ_ROUTE_PREFIX);

export const handleDocContentRequest = async (
  request: Request,
  env: DocContentEnv,
  url: URL,
) => {
  if (url.pathname === DOC_CONTENT_ROUTE) {
    if (request.method === "POST") {
      return await upload(request, env);
    }
    if (request.method === "DELETE") {
      return await remove(request, env);
    }
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  if (request.method === "GET" || request.method === "HEAD") {
    return await serve(
      request,
      env,
      url.pathname.slice(DOC_CONTENT_READ_ROUTE_PREFIX.length),
    );
  }
  return json({ error: "Method not allowed" }, { status: 405 });
};
