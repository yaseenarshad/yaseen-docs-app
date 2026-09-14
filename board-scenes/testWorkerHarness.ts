/**
 * Test-only harness that closes the Board scene loop in process: an in-memory
 * object store plus a `fetch` that answers the private Worker routes and sends
 * every capability lookup back into a `convex-test` instance.
 *
 * Direct uploads emulate only the external R2 HTTP boundary. Real Node actions
 * still validate bytes and atomically commit manifests. Signature acceptance
 * here is fake: signing has separate crypto tests, and this is not live-provider
 * proof. Worker read/delete capabilities are resolved through real Convex HTTP.
 */
import {
  BOARD_SCENE_DELETE_GRANT_PATH,
  BOARD_SCENE_READ_GRANT_PATH,
  BOARD_SCENE_ROUTE,
  BOARD_SCENE_READ_ROUTE_PREFIX,
  parseBoardSceneDeleteGrant,
  parseBoardSceneReadGrant,
} from "./types";

export const BOARD_SCENE_TEST_WORKER_ORIGIN = "https://scenes.test.invalid";
export const BOARD_SCENE_TEST_CONVEX_SITE_URL = "https://convex.test.invalid";
export const BOARD_SCENE_TEST_R2_ENV = {
  BOARD_SCENE_R2_ENDPOINT:
    "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  BOARD_SCENE_R2_BUCKET: "test-board-scenes",
  BOARD_SCENE_R2_ACCESS_KEY_ID: "synthetic-test-access-key",
  BOARD_SCENE_R2_SECRET_ACCESS_KEY: "synthetic-test-secret-key",
};

type StoredObject = {
  bytes: Uint8Array;
  etag: string;
  version: number;
  metadata: Record<string, string>;
  contentType: string;
};

const bearerToken = (headers: Headers) => {
  const authorization = headers.get("Authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
};

export type BoardSceneWorkerHarness = ReturnType<
  typeof createBoardSceneWorkerHarness
>;

export const createBoardSceneWorkerHarness = (
  convexFetch: (path: string, init: RequestInit) => Promise<Response>,
) => {
  const objects = new Map<string, StoredObject>();
  const requests: { method: string; pathname: string }[] = [];

  const resolveGrant = async (path: string, token: string) => {
    const response = await convexFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return response.ok ? ((await response.json()) as unknown) : null;
  };

  let nextEtag = 0;
  const r2 = async (request: Request, url: URL) => {
    const prefix = `/${BOARD_SCENE_TEST_R2_ENV.BOARD_SCENE_R2_BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) {
      return new Response(null, { status: 404 });
    }
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    const stored = objects.get(key);
    if (request.method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (!stored) {
        return new Response(null, { status: 404 });
      }
      return new Response(
        request.method === "HEAD"
          ? null
          : (stored.bytes.slice().buffer as ArrayBuffer),
        {
          headers: {
            etag: `"${stored.etag}"`,
            "content-length": String(stored.bytes.byteLength),
            "content-type": stored.contentType,
            ...Object.fromEntries(
              Object.entries(stored.metadata).map(([name, value]) => [
                `x-amz-meta-${name}`,
                value,
              ]),
            ),
          },
        },
      );
    }
    if (request.method !== "PUT") {
      return new Response(null, { status: 405 });
    }
    const source = request.headers.get("x-amz-copy-source");
    const metadata: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      if (name.startsWith("x-amz-meta-")) {
        metadata[name.slice("x-amz-meta-".length)] = value;
      }
    });
    let bytes: Uint8Array;
    if (source) {
      const original = source.startsWith(prefix)
        ? objects.get(source.slice(prefix.length))
        : undefined;
      if (!original) {
        return new Response(null, { status: 404 });
      }
      if (
        request.headers.get("x-amz-copy-source-if-match") !==
        `"${original.etag}"`
      ) {
        return new Response(null, { status: 412 });
      }
      if (request.headers.get("x-amz-metadata-directive") !== "REPLACE") {
        return new Response(null, { status: 400 });
      }
      bytes = original.bytes.slice();
    } else {
      if (
        !key.startsWith("board-scene-uploads/") ||
        request.headers.get("if-none-match") !== "*"
      ) {
        return new Response(null, { status: 403 });
      }
      if (stored) {
        return new Response(null, { status: 412 });
      }
      bytes = new Uint8Array(await request.arrayBuffer());
      const digest = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          bytes.slice().buffer as ArrayBuffer,
        ),
      );
      const checksum = btoa(String.fromCharCode(...digest));
      if (request.headers.get("x-amz-checksum-sha256") !== checksum) {
        return new Response(null, { status: 400 });
      }
    }
    const etag = `etag-${++nextEtag}`;
    objects.set(key, {
      bytes,
      etag,
      version: Number(metadata.version),
      metadata,
      contentType: request.headers.get("content-type") ?? "",
    });
    return source
      ? new Response(
          `<CopyObjectResult><ETag>"${etag}"</ETag></CopyObjectResult>`,
          { headers: { "content-type": "application/xml" } },
        )
      : new Response(null, { headers: { etag: `"${etag}"` } });
  };

  const serve = async (token: string) => {
    const grant = parseBoardSceneReadGrant(
      await resolveGrant(BOARD_SCENE_READ_GRANT_PATH, token),
    );
    const stored = grant ? objects.get(grant.objectKey) : undefined;
    if (
      !grant ||
      !stored ||
      stored.etag !== grant.etag ||
      stored.version !== grant.version ||
      stored.bytes.byteLength !== grant.compressedSize
    ) {
      return new Response("Scene not found", { status: 404 });
    }
    return new Response(stored.bytes.slice().buffer as ArrayBuffer, {
      status: 200,
    });
  };

  const remove = async (request: Request) => {
    const token = bearerToken(request.headers);
    const grant = token
      ? parseBoardSceneDeleteGrant(
          await resolveGrant(BOARD_SCENE_DELETE_GRANT_PATH, token),
        )
      : null;
    if (!grant) {
      return Response.json({ error: "Invalid grant" }, { status: 403 });
    }
    const keys = new Set(grant.objectKeys);
    if (grant.objectKeyPrefix) {
      for (const key of objects.keys()) {
        if (key.startsWith(grant.objectKeyPrefix)) {
          keys.add(key);
        }
      }
    }
    for (const key of keys) {
      objects.delete(key);
    }
    return Response.json({ deleted: keys.size });
  };

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === BOARD_SCENE_TEST_CONVEX_SITE_URL) {
      return await convexFetch(url.pathname, init);
    }
    requests.push({ method: request.method, pathname: url.pathname });
    if (url.origin === BOARD_SCENE_TEST_R2_ENV.BOARD_SCENE_R2_ENDPOINT) {
      return await r2(request, url);
    }
    if (url.origin !== BOARD_SCENE_TEST_WORKER_ORIGIN) {
      throw new Error(`Unexpected request to ${url.origin}`);
    }
    if (url.pathname === BOARD_SCENE_ROUTE) {
      if (request.method === "POST") {
        return Response.json(
          { error: "Board scene upload requires an app update" },
          { status: 426 },
        );
      }
      if (request.method === "DELETE") {
        return await remove(request);
      }
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    if (url.pathname.startsWith(BOARD_SCENE_READ_ROUTE_PREFIX)) {
      return await serve(
        url.pathname.slice(BOARD_SCENE_READ_ROUTE_PREFIX.length),
      );
    }
    return new Response("Not found", { status: 404 });
  };

  return { objects, requests, fetch };
};
