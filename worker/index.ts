import { handleImageStudioRequest } from "./imageStudio";

interface Env {
  ASSETS: Fetcher;
  DIAGRAM_ASSETS: R2Bucket;
  CONVEX_SITE_URL: string;
  PIXABAY_API_KEY?: string;
}

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init?.headers,
    },
  });

const getGrant = async (request: Request, env: Env) => {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  const response = await fetch(`${env.CONVEX_SITE_URL}/asset-upload-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: authorization.slice("Bearer ".length) }),
  });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as {
    objectKey: string;
    mimeType: string;
    size: number;
  };
};

const getDeleteGrant = async (request: Request, env: Env) => {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  const response = await fetch(`${env.CONVEX_SITE_URL}/asset-delete-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: authorization.slice("Bearer ".length) }),
  });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as { objectKeys: string[] };
};

const uploadAsset = async (request: Request, env: Env) => {
  const grant = await getGrant(request, env);
  if (!grant) {
    return json({ error: "Invalid or expired upload grant" }, { status: 403 });
  }
  const contentType = request.headers.get("Content-Type") ?? "";
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (
    contentType !== grant.mimeType ||
    (contentLength > 0 && contentLength !== grant.size)
  ) {
    return json(
      { error: "Image metadata does not match grant" },
      { status: 400 },
    );
  }
  if (!request.body) {
    return json({ error: "Image body is required" }, { status: 400 });
  }
  const object = await env.DIAGRAM_ASSETS.put(grant.objectKey, request.body, {
    httpMetadata: {
      contentType: grant.mimeType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  if (object.size !== grant.size) {
    await env.DIAGRAM_ASSETS.delete(grant.objectKey);
    return json(
      { error: "Uploaded image size does not match grant" },
      { status: 400 },
    );
  }
  return json({ etag: object.etag });
};

const serveAsset = async (request: Request, env: Env, objectKey: string) => {
  const object = await env.DIAGRAM_ASSETS.get(objectKey);
  if (!object) {
    return new Response("Image not found", { status: 404 });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
};

const deleteAssets = async (request: Request, env: Env) => {
  const grant = await getDeleteGrant(request, env);
  if (!grant) {
    return json({ error: "Invalid or expired delete grant" }, { status: 403 });
  }
  for (let index = 0; index < grant.objectKeys.length; index += 1000) {
    await env.DIAGRAM_ASSETS.delete(
      grant.objectKeys.slice(index, index + 1000),
    );
  }
  return json({ deleted: grant.objectKeys.length });
};

const worker: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/image-studio/")) {
      return await handleImageStudioRequest(request, env);
    }
    if (url.pathname === "/api/assets" && request.method === "POST") {
      return await uploadAsset(request, env);
    }
    if (url.pathname === "/api/assets" && request.method === "DELETE") {
      return await deleteAssets(request, env);
    }
    if (
      url.pathname.startsWith("/api/assets/") &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const objectKey = decodeURIComponent(
        url.pathname.slice("/api/assets/".length),
      );
      if (!objectKey || objectKey.includes("..")) {
        return new Response("Invalid image key", { status: 400 });
      }
      return await serveAsset(request, env, objectKey);
    }
    return await env.ASSETS.fetch(request);
  },
};

export default worker;
