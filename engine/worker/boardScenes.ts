import {
  BOARD_SCENE_DELETE_GRANT_PATH,
  BOARD_SCENE_ENCODING_HEADER,
  BOARD_SCENE_READ_GRANT_PATH,
  BOARD_SCENE_READ_ROUTE_PREFIX,
  BOARD_SCENE_ROUTE,
  BOARD_SCENE_TOKEN_PATTERN,
  parseBoardSceneDeleteGrant,
  parseBoardSceneReadGrant,
} from "../board-scenes/types";

import type {
  BoardSceneDeleteGrant,
  BoardSceneReadGrant,
} from "../board-scenes/types";

interface BoardSceneEnv {
  DIAGRAM_ASSETS: R2Bucket;
  CONVEX_SITE_URL: string;
}

/** Board scene objects are never publicly cacheable and never revalidated. */
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

// S3 lowercases metadata names; old Worker-written objects used camelCase.
// Reject contradictory forms instead of picking whichever happens to match.
const matchesMetadata = (
  metadata: Record<string, string> | undefined,
  name: string,
  expected: string,
) => {
  const legacy = metadata?.[name];
  const lower = metadata?.[name.toLowerCase()];
  return (
    (legacy === expected || lower === expected) &&
    (legacy === undefined || legacy === expected) &&
    (lower === undefined || lower === expected)
  );
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
    !matchesMetadata(
      object.customMetadata,
      "compressedSha256",
      grant.compressedSha256,
    ) ||
    !matchesMetadata(object.customMetadata, "rawSha256", grant.rawSha256) ||
    !matchesMetadata(object.customMetadata, "rawSize", String(grant.rawSize)) ||
    !matchesMetadata(object.customMetadata, "diagramId", grant.diagramId) ||
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
      return json(
        { error: "Refresh this tab to save", status: "upgrade-required" },
        { status: 426 },
      );
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
