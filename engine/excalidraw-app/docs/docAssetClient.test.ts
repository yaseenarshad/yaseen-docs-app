import { describe, expect, it, vi } from "vitest";

import { DocAssetResolver, sanitizeDocAssetFilename } from "./docAssetClient";

describe("Doc asset client", () => {
  it("sanitizes filenames and reuses unexpired read grants", async () => {
    expect(sanitizeDocAssetFilename(" Q3 plan (final).pdf ")).toBe(
      "Q3-plan-final-.pdf-",
    );
    const create = vi.fn(async () => ({
      path: "/api/doc-assets/token",
      expiresAt: Date.now() + 60_000,
    }));
    const resolver = new DocAssetResolver(create);
    const stable = `assets/${"a".repeat(32)}/image.png`;
    await expect(resolver.resolve(stable)).resolves.toBe(
      "/api/doc-assets/token",
    );
    await expect(resolver.resolve(stable)).resolves.toBe(
      "/api/doc-assets/token",
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});
