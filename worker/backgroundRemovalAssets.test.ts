import { describe, expect, it, vi } from "vitest";

import manifest from "../background-removal-assets.json";

import { handleBackgroundRemovalAssetRequest } from "./backgroundRemovalAssets";

const createObject = (body: string) => ({
  body: new Response(body).body,
  size: body.length,
  httpEtag: '"etag"',
  range: undefined,
  writeHttpMetadata: (headers: Headers) => {
    headers.set("Content-Type", "application/octet-stream");
  },
});

describe("background-removal model asset route", () => {
  it("serves only pinned, allowlisted assets with immutable headers", async () => {
    const get = vi.fn(async () => createObject("{}"));
    const asset = manifest.assets[0];
    const response = await handleBackgroundRemovalAssetRequest(
      new Request(`https://draw.test${manifest.assetRoute}${asset.path}`),
      { DIAGRAM_ASSETS: { get } as unknown as R2Bucket },
    );

    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledWith(
      `${manifest.r2Prefix}${asset.path}`,
      undefined,
    );
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("rejects unknown paths without touching R2", async () => {
    const get = vi.fn();
    const response = await handleBackgroundRemovalAssetRequest(
      new Request(
        `https://draw.test${manifest.assetRoute}models/other/model.onnx`,
      ),
      { DIAGRAM_ASSETS: { get } as unknown as R2Bucket },
    );

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("reports a pinned asset that has not been provisioned", async () => {
    const response = await handleBackgroundRemovalAssetRequest(
      new Request(
        `https://draw.test${manifest.assetRoute}${manifest.assets[2].path}`,
      ),
      {
        DIAGRAM_ASSETS: {
          get: vi.fn(async () => null),
        } as unknown as R2Bucket,
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
