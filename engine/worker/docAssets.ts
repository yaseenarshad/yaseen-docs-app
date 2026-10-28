import {
  DOC_ASSET_DELETE_GRANT_PATH,
  DOC_ASSET_READ_GRANT_PATH,
  DOC_ASSET_READ_ROUTE_PREFIX,
  DOC_ASSET_ROUTE,
  DOC_ASSET_TOKEN_PATTERN,
  DOC_ASSET_UPLOAD_GRANT_PATH,
  parseDocAssetDeleteGrant,
  parseDocAssetReadGrant,
  parseDocAssetUploadGrant,
} from "../doc-assets/types";

type Env = { CONVEX_SITE_URL: string; DIAGRAM_ASSETS: R2Bucket };

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

const bearer = (request: Request) => {
  const value = request.headers.get("Authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : null;
};

const resolve = async (env: Env, path: string, token: string) => {
  const response = await fetch(`${env.CONVEX_SITE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return response.ok ? await response.json() : null;
};

const sha256Hex = async (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const upload = async (request: Request, env: Env) => {
  const token = bearer(request);
  const grant = token
    ? parseDocAssetUploadGrant(
        await resolve(env, DOC_ASSET_UPLOAD_GRANT_PATH, token),
      )
    : null;
  if (!grant) {
    return json({ error: "Invalid or expired Doc asset grant" }, 403);
  }
  if (request.headers.get("Content-Type") !== grant.mimeType) {
    return json({ error: "Doc asset MIME type does not match grant" }, 400);
  }
  const body = await request.arrayBuffer();
  if (
    body.byteLength !== grant.size ||
    (await sha256Hex(body)) !== grant.sha256
  ) {
    return json({ error: "Doc asset integrity does not match grant" }, 400);
  }
  const object = await env.DIAGRAM_ASSETS.put(grant.objectKey, body, {
    httpMetadata: {
      contentType: grant.mimeType,
      cacheControl: "private, no-store",
    },
    customMetadata: { sha256: grant.sha256, assetId: grant.assetId },
  });
  if (object.size !== grant.size) {
    await env.DIAGRAM_ASSETS.delete(grant.objectKey);
    return json({ error: "Stored Doc asset size does not match grant" }, 500);
  }
  return json({ etag: object.etag, assetId: grant.assetId });
};

const read = async (request: Request, env: Env, token: string) => {
  if (!DOC_ASSET_TOKEN_PATTERN.test(token)) {
    return new Response("Not found", { status: 404 });
  }
  const grant = parseDocAssetReadGrant(
    await resolve(env, DOC_ASSET_READ_GRANT_PATH, token),
  );
  if (!grant) {
    return new Response("Not found", { status: 404 });
  }
  const object = await env.DIAGRAM_ASSETS.get(grant.objectKey);
  if (
    !object ||
    object.size !== grant.size ||
    object.etag !== grant.etag ||
    object.customMetadata?.sha256 !== grant.sha256
  ) {
    return new Response("Not found", { status: 404 });
  }
  const inline =
    grant.mimeType.startsWith("image/") && grant.mimeType !== "image/svg+xml";
  const headers = new Headers({
    "Content-Type": grant.mimeType,
    "Content-Length": String(grant.size),
    ETag: object.httpEtag,
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${
      grant.filename
    }"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
  });
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
};

const remove = async (request: Request, env: Env) => {
  const token = bearer(request);
  const grant = token
    ? parseDocAssetDeleteGrant(
        await resolve(env, DOC_ASSET_DELETE_GRANT_PATH, token),
      )
    : null;
  if (!grant) {
    return json({ error: "Invalid or expired Doc asset delete grant" }, 403);
  }
  await env.DIAGRAM_ASSETS.delete(grant.objectKey);
  return json({ deleted: grant.assetId });
};

export const isDocAssetRoute = (pathname: string) =>
  pathname === DOC_ASSET_ROUTE ||
  pathname.startsWith(DOC_ASSET_READ_ROUTE_PREFIX);

export const handleDocAssetRequest = async (
  request: Request,
  env: Env,
  url: URL,
) => {
  if (url.pathname === DOC_ASSET_ROUTE) {
    if (request.method === "POST") {
      return await upload(request, env);
    }
    if (request.method === "DELETE") {
      return await remove(request, env);
    }
  }
  if (
    url.pathname.startsWith(DOC_ASSET_READ_ROUTE_PREFIX) &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return await read(
      request,
      env,
      url.pathname.slice(DOC_ASSET_READ_ROUTE_PREFIX.length),
    );
  }
  return new Response("Method not allowed", { status: 405 });
};
