import manifest from "../background-removal-assets.json";

type BackgroundRemovalAssetEnv = {
  DIAGRAM_ASSETS: R2Bucket;
};

const routePrefix = manifest.assetRoute;
const allowedAssets = new Map(
  manifest.assets.map((asset) => [asset.path, asset]),
);

const immutableCacheControl = "public, max-age=31536000, immutable";

export const handleBackgroundRemovalAssetRequest = async (
  request: Request,
  env: BackgroundRemovalAssetEnv,
) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);
  const encodedPath = url.pathname.slice(routePrefix.length);
  let assetPath: string;
  try {
    assetPath = decodeURIComponent(encodedPath);
  } catch {
    return new Response("Invalid asset path", { status: 400 });
  }

  const asset = allowedAssets.get(assetPath);
  if (!asset || assetPath.includes("..")) {
    return new Response("Background-removal asset not found", { status: 404 });
  }

  const range = request.headers.get("Range");
  const object = await env.DIAGRAM_ASSETS.get(
    `${manifest.r2Prefix}${asset.path}`,
    range ? { range: request.headers } : undefined,
  );
  if (!object) {
    return new Response("Background-removal asset is not provisioned", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", asset.contentType);
  headers.set("Content-Length", object.size.toString());
  headers.set("Cache-Control", immutableCacheControl);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");

  let status = 200;
  if (range && object.range) {
    status = 206;
    const offset = "offset" in object.range ? object.range.offset : 0;
    const length = "length" in object.range ? object.range.length : object.size;
    headers.set("Content-Length", length.toString());
    headers.set(
      "Content-Range",
      `bytes ${offset}-${offset + length - 1}/${asset.size}`,
    );
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    status,
    headers,
  });
};

export const backgroundRemovalAssetManifest = manifest;
