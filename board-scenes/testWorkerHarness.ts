/**
 * Test-only harness that closes the Board scene loop in process: an in-memory
 * object store plus a `fetch` that answers the private Worker routes and sends
 * every capability lookup back into a `convex-test` instance.
 *
 * The Worker's own validation is covered by `worker/boardScenes.test.ts`. What
 * this harness reproduces is the *trust boundary*: it accepts nothing a grant
 * did not authorize, it parses grant payloads with the same parsers the Worker
 * uses, and a capability Convex refuses to resolve serves nothing. Convex-side
 * tests can therefore exercise upload, read, revocation and cleanup end to end
 * without the Worker's Cloudflare-only runtime types.
 */
import {
  BOARD_SCENE_DELETE_GRANT_PATH,
  BOARD_SCENE_READ_GRANT_PATH,
  BOARD_SCENE_ROUTE,
  BOARD_SCENE_READ_ROUTE_PREFIX,
  BOARD_SCENE_UPLOAD_GRANT_PATH,
  parseBoardSceneDeleteGrant,
  parseBoardSceneReadGrant,
  parseBoardSceneUploadGrant,
} from "./types";

export const BOARD_SCENE_TEST_WORKER_ORIGIN = "https://scenes.test.invalid";
export const BOARD_SCENE_TEST_CONVEX_SITE_URL = "https://convex.test.invalid";

type StoredObject = { bytes: Uint8Array; etag: string; version: number };

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

  const upload = async (request: Request) => {
    const token = bearerToken(request.headers);
    const grant = token
      ? parseBoardSceneUploadGrant(
          await resolveGrant(BOARD_SCENE_UPLOAD_GRANT_PATH, token),
        )
      : null;
    if (!grant) {
      return Response.json({ error: "Invalid grant" }, { status: 403 });
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== grant.compressedSize) {
      return Response.json({ error: "Size mismatch" }, { status: 400 });
    }
    const etag = `etag-${grant.objectKey.slice(-10)}-${bytes.byteLength}`;
    objects.set(grant.objectKey, { bytes, etag, version: grant.version });
    return Response.json({ etag });
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
    const url = new URL(String(input));
    if (url.origin === BOARD_SCENE_TEST_CONVEX_SITE_URL) {
      return await convexFetch(url.pathname, init);
    }
    if (url.origin !== BOARD_SCENE_TEST_WORKER_ORIGIN) {
      throw new Error(`Unexpected request to ${url.origin}`);
    }
    const request = new Request(url, init);
    requests.push({ method: request.method, pathname: url.pathname });
    if (url.pathname === BOARD_SCENE_ROUTE) {
      if (request.method === "POST") {
        return await upload(request);
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
