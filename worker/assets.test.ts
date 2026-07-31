import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/api/assets upload compatibility", () => {
  it.each([
    {
      label: "scene asset",
      objectKey: "board/assets/image.png",
      mimeType: "image/png",
      body: "png!",
    },
    {
      label: "Board preview",
      objectKey: "board/previews/immutable.webp",
      mimeType: "image/webp",
      body: "webp",
    },
  ])(
    "uploads a generic $label grant without route-specific weakening",
    async ({ objectKey, mimeType, body }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            objectKey,
            mimeType,
            size: body.length,
          }),
        ),
      );
      const put = vi.fn(async () => ({
        size: body.length,
        etag: "etag",
      }));
      const env = {
        CONVEX_SITE_URL: "https://convex.example.test",
        DIAGRAM_ASSETS: { put },
        ASSETS: { fetch: vi.fn() },
      };
      const request = new Request("https://draw.example.test/api/assets", {
        method: "POST",
        headers: {
          Authorization: "Bearer upload-token",
          "Content-Type": mimeType,
        },
        body,
      });

      const response = await worker.fetch!(
        request,
        env as never,
        {} as ExecutionContext,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ etag: "etag" });
      expect(put).toHaveBeenCalledWith(
        objectKey,
        request.body,
        expect.objectContaining({
          httpMetadata: {
            contentType: mimeType,
            cacheControl: "public, max-age=31536000, immutable",
          },
        }),
      );
    },
  );
});
