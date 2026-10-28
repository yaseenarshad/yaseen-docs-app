import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

const sha256 = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

describe("presentation animation R2 uploads", () => {
  it("verifies the dedicated grant, exact body size, and SHA-256 before writing", async () => {
    const body = "<!doctype html><title>Trusted animation</title>";
    const checksum = await sha256(body);
    const put = vi.fn(async () => ({ size: body.length, etag: "r2-etag" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(
          "https://convex.example.test/presentation-animation-upload-grant",
        );
        return Response.json({
          objectKey: "board/presentation-animations/immutable.html",
          mimeType: "text/html",
          size: body.length,
          sha256: checksum,
        });
      }),
    );
    const request = new Request(
      "https://draw.example.test/api/presentation-animations",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer animation-token",
          "Content-Type": "text/html",
        },
        body,
      },
    );
    const response = await worker.fetch!(
      request,
      {
        CONVEX_SITE_URL: "https://convex.example.test",
        DIAGRAM_ASSETS: { put },
        ASSETS: { fetch: vi.fn() },
      } as never,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      etag: "r2-etag",
      sha256: checksum,
    });
    expect(put).toHaveBeenCalledWith(
      "board/presentation-animations/immutable.html",
      expect.any(ArrayBuffer),
      {
        httpMetadata: {
          contentType: "text/html",
          cacheControl: "public, max-age=31536000, immutable",
        },
        customMetadata: { sha256: checksum },
      },
    );
  });

  it("rejects a body whose checksum does not match the immutable manifest", async () => {
    const put = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          objectKey: "board/presentation-animations/immutable.html",
          mimeType: "text/html",
          size: 4,
          sha256: "0".repeat(64),
        }),
      ),
    );
    const response = await worker.fetch!(
      new Request("https://draw.example.test/api/presentation-animations", {
        method: "POST",
        headers: {
          Authorization: "Bearer animation-token",
          "Content-Type": "text/html",
        },
        body: "nope",
      }),
      {
        CONVEX_SITE_URL: "https://convex.example.test",
        DIAGRAM_ASSETS: { put },
        ASSETS: { fetch: vi.fn() },
      } as never,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("checksum"),
    });
    expect(put).not.toHaveBeenCalled();
  });
});

describe("controlled presentation animation reads", () => {
  const token = "a".repeat(64);
  const body =
    "<!doctype html><script>parent.postMessage('ready','*')</script>";
  const grant = {
    objectKey: "board/presentation-animations/immutable.html",
    mimeType: "text/html" as const,
    size: body.length,
    sha256: "b".repeat(64),
    etag: "r2-read-etag",
    expiresAt: Date.now() + 300_000,
  };

  it.each(["GET", "HEAD"])(
    "serves an exact registered bundle over %s with restrictive headers",
    async (method) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          expect(url).toBe(
            "https://convex.example.test/presentation-animation-read-grant",
          );
          return Response.json(grant);
        }),
      );
      const get = vi.fn(async () => ({
        body,
        size: body.length,
        etag: "r2-read-etag",
        httpEtag: '"r2-read-etag"',
        customMetadata: { sha256: "b".repeat(64) },
      }));
      const response = await worker.fetch!(
        new Request(
          `https://draw.example.test/api/presentation-animations/${token}`,
          { method },
        ),
        {
          CONVEX_SITE_URL: "https://convex.example.test",
          DIAGRAM_ASSETS: { get },
          ASSETS: { fetch: vi.fn() },
        } as never,
        {} as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/html");
      expect(response.headers.get("Cache-Control")).toBe(
        "private, max-age=300, immutable",
      );
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "connect-src 'none'",
      );
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "frame-ancestors 'self'",
      );
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(await response.text()).toBe(method === "HEAD" ? "" : body);
      expect(get).toHaveBeenCalledWith(grant.objectKey);
    },
  );

  it("fails closed for guessed, expired, deleted, or mismatched objects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    const get = vi.fn();
    const response = await worker.fetch!(
      new Request(
        `https://draw.example.test/api/presentation-animations/${token}`,
      ),
      {
        CONVEX_SITE_URL: "https://convex.example.test",
        DIAGRAM_ASSETS: { get },
        ASSETS: { fetch: vi.fn() },
      } as never,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(get).not.toHaveBeenCalled();
  });

  it("blocks the generic asset route from bypassing animation controls", async () => {
    const get = vi.fn();
    const response = await worker.fetch!(
      new Request(
        "https://draw.example.test/api/assets/board%2Fpresentation-animations%2Fimmutable.html",
      ),
      {
        CONVEX_SITE_URL: "https://convex.example.test",
        DIAGRAM_ASSETS: { get },
        ASSETS: { fetch: vi.fn() },
      } as never,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });
});
