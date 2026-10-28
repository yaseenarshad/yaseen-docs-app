import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DOC_ASSET_READ_GRANT_PATH,
  DOC_ASSET_UPLOAD_GRANT_PATH,
} from "../doc-assets/types";

import worker from "./index";

afterEach(() => vi.unstubAllGlobals());

const bytes = new TextEncoder().encode("png!");
const sha256 = async () =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

describe("private Doc asset Worker routes", () => {
  it("fails closed when Docs are off and blocks writes in read-only mode", async () => {
    const base = {
      CONVEX_SITE_URL: "https://convex.test",
      DIAGRAM_ASSETS: {},
      ASSETS: { fetch: vi.fn() },
    };
    const request = () =>
      new Request("https://draw.test/api/doc-assets", {
        method: "POST",
        headers: { Authorization: "Bearer token", "Content-Type": "image/png" },
        body: "png",
      });
    const off = await worker.fetch!(
      request(),
      { ...base, DOCS_MODE: "off" } as never,
      {} as ExecutionContext,
    );
    const readOnly = await worker.fetch!(
      request(),
      { ...base, DOCS_MODE: "read-only" } as never,
      {} as ExecutionContext,
    );
    expect(off.status).toBe(404);
    expect(readOnly.status).toBe(403);
  });

  it("verifies uploads and serves grant-authorized images with private headers", async () => {
    const assetId = "a".repeat(32);
    const token = "b".repeat(64);
    const objectKey = `doc-assets/owner/${assetId}`;
    const hash = await sha256();
    const stored = new Map<string, { body: Uint8Array; etag: string }>();
    const bucket = {
      put: vi.fn(async (key: string, body: ArrayBuffer) => {
        stored.set(key, { body: new Uint8Array(body), etag: "etag" });
        return { size: body.byteLength, etag: "etag" };
      }),
      get: vi.fn(async (key: string) => {
        const value = stored.get(key);
        return value
          ? {
              body: value.body,
              size: value.body.byteLength,
              etag: value.etag,
              httpEtag: '"etag"',
              customMetadata: { sha256: hash },
            }
          : null;
      }),
      delete: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        return path === DOC_ASSET_UPLOAD_GRANT_PATH
          ? Response.json({
              objectKey,
              assetId,
              mimeType: "image/png",
              size: bytes.byteLength,
              sha256: hash,
            })
          : path === DOC_ASSET_READ_GRANT_PATH
          ? Response.json({
              objectKey,
              assetId,
              mimeType: "image/png",
              filename: "image.png",
              size: bytes.byteLength,
              sha256: hash,
              etag: "etag",
              expiresAt: Date.now() + 60_000,
            })
          : new Response(null, { status: 404 });
      }),
    );
    const env = {
      CONVEX_SITE_URL: "https://convex.test",
      DOCS_MODE: "on",
      DIAGRAM_ASSETS: bucket,
      ASSETS: { fetch: vi.fn() },
    };
    const upload = await worker.fetch!(
      new Request("https://draw.test/api/doc-assets", {
        method: "POST",
        headers: {
          Authorization: "Bearer upload",
          "Content-Type": "image/png",
        },
        body: bytes,
      }),
      env as never,
      {} as ExecutionContext,
    );
    expect(upload.status).toBe(200);
    const read = await worker.fetch!(
      new Request(`https://draw.test/api/doc-assets/${token}`),
      env as never,
      {} as ExecutionContext,
    );
    expect(read.status).toBe(200);
    expect(read.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(read.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect([...new Uint8Array(await read.arrayBuffer())]).toEqual([...bytes]);
  });
});
