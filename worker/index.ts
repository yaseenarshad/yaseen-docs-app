import { referencesBoardSceneNamespace } from "../board-scenes/types";
import { referencesDocContentNamespace } from "../doc-content/types";

import { handleImageStudioRequest } from "./imageStudio";
import {
  backgroundRemovalAssetManifest,
  handleBackgroundRemovalAssetRequest,
} from "./backgroundRemovalAssets";
import { getCanonicalRedirectResponse } from "./canonicalRedirect";
import { getLegacyServiceWorkerResponse } from "./legacyServiceWorker";
import { handleBoardSceneRequest, isBoardSceneRoute } from "./boardScenes";
import { handleDocContentRequest, isDocContentRoute } from "./docContents";
import { handleDocAssetRequest, isDocAssetRoute } from "./docAssets";

interface Env {
  ASSETS: Fetcher;
  DIAGRAM_ASSETS: R2Bucket;
  CONVEX_SITE_URL: string;
  DOCS_MODE?: "off" | "read-only" | "on";
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

const getPresentationAnimationGrant = async (request: Request, env: Env) => {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  const response = await fetch(
    `${env.CONVEX_SITE_URL}/presentation-animation-upload-grant`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: authorization.slice("Bearer ".length) }),
    },
  );
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as {
    objectKey: string;
    mimeType: "text/html";
    size: number;
    sha256: string;
  };
};

const PRESENTATION_ANIMATION_TOKEN = /^[a-f0-9]{64}$/;
const PRESENTATION_ANIMATION_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const getPresentationAnimationReadGrant = async (token: string, env: Env) => {
  if (!PRESENTATION_ANIMATION_TOKEN.test(token)) {
    return null;
  }
  const response = await fetch(
    `${env.CONVEX_SITE_URL}/presentation-animation-read-grant`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    },
  );
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as {
    objectKey: string;
    mimeType: "text/html";
    size: number;
    sha256: string;
    etag: string;
    expiresAt: number;
  };
};

const servePresentationAnimation = async (
  request: Request,
  env: Env,
  token: string,
) => {
  const grant = await getPresentationAnimationReadGrant(token, env);
  if (!grant) {
    return new Response("Animation not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const object = await env.DIAGRAM_ASSETS.get(grant.objectKey);
  if (
    !object ||
    object.size !== grant.size ||
    object.etag !== grant.etag ||
    object.customMetadata?.sha256 !== grant.sha256
  ) {
    return new Response("Animation not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const headers = new Headers({
    "Content-Type": grant.mimeType,
    "Content-Length": String(grant.size),
    ETag: object.httpEtag,
    "Cache-Control": "private, max-age=300, immutable",
    "Content-Security-Policy": PRESENTATION_ANIMATION_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "accelerometer=(), autoplay=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), microphone=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=()",
  });
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
};

const sha256Hex = async (value: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const uploadPresentationAnimation = async (request: Request, env: Env) => {
  const grant = await getPresentationAnimationGrant(request, env);
  if (!grant) {
    return json(
      { error: "Invalid or expired presentation animation grant" },
      { status: 403 },
    );
  }
  if (request.headers.get("Content-Type") !== grant.mimeType) {
    return json(
      { error: "Animation MIME type does not match grant" },
      { status: 400 },
    );
  }
  const body = await request.arrayBuffer();
  if (body.byteLength !== grant.size) {
    return json(
      { error: "Animation size does not match grant" },
      { status: 400 },
    );
  }
  if ((await sha256Hex(body)) !== grant.sha256) {
    return json(
      { error: "Animation checksum does not match grant" },
      { status: 400 },
    );
  }
  const object = await env.DIAGRAM_ASSETS.put(grant.objectKey, body, {
    httpMetadata: {
      contentType: grant.mimeType,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: { sha256: grant.sha256 },
  });
  if (object.size !== grant.size) {
    await env.DIAGRAM_ASSETS.delete(grant.objectKey);
    return json(
      { error: "Stored animation size does not match grant" },
      { status: 500 },
    );
  }
  return json({ etag: object.etag, sha256: grant.sha256 });
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
    const legacyServiceWorkerResponse = getLegacyServiceWorkerResponse(url);
    if (legacyServiceWorkerResponse) {
      return legacyServiceWorkerResponse;
    }
    const canonicalRedirectResponse = getCanonicalRedirectResponse(url);
    if (canonicalRedirectResponse) {
      return canonicalRedirectResponse;
    }
    if (url.pathname.startsWith(backgroundRemovalAssetManifest.assetRoute)) {
      return await handleBackgroundRemovalAssetRequest(request, env);
    }
    if (url.pathname.startsWith("/api/image-studio/")) {
      return await handleImageStudioRequest(request, env);
    }
    if (isBoardSceneRoute(url.pathname)) {
      return await handleBoardSceneRequest(request, env, url);
    }
    if (isDocContentRoute(url.pathname)) {
      if (env.DOCS_MODE === "off" || !env.DOCS_MODE) {
        return new Response("Not found", { status: 404 });
      }
      if (
        env.DOCS_MODE === "read-only" &&
        request.method !== "GET" &&
        request.method !== "HEAD"
      ) {
        return json({ error: "Docs are read-only" }, { status: 403 });
      }
      return await handleDocContentRequest(request, env, url);
    }
    if (isDocAssetRoute(url.pathname)) {
      if (env.DOCS_MODE === "off" || !env.DOCS_MODE) {
        return new Response("Not found", { status: 404 });
      }
      if (
        env.DOCS_MODE === "read-only" &&
        request.method !== "GET" &&
        request.method !== "HEAD"
      ) {
        return json({ error: "Docs are read-only" }, { status: 403 });
      }
      return await handleDocAssetRequest(request, env, url);
    }
    if (url.pathname === "/api/assets" && request.method === "POST") {
      return await uploadAsset(request, env);
    }
    if (
      url.pathname === "/api/presentation-animations" &&
      request.method === "POST"
    ) {
      return await uploadPresentationAnimation(request, env);
    }
    if (
      url.pathname.startsWith("/api/presentation-animations/") &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return await servePresentationAnimation(
        request,
        env,
        url.pathname.slice("/api/presentation-animations/".length),
      );
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
      if (
        !objectKey ||
        objectKey.includes("..") ||
        objectKey.includes("/presentation-animations/") ||
        referencesBoardSceneNamespace(objectKey) ||
        referencesDocContentNamespace(objectKey)
      ) {
        return new Response("Invalid image key", { status: 400 });
      }
      return await serveAsset(request, env, objectKey);
    }
    return await env.ASSETS.fetch(request);
  },
};

export default worker;
