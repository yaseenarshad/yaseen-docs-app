import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const wranglerConfig = JSON.parse(
  readFileSync(path.join(process.cwd(), "wrangler.jsonc"), "utf8"),
);

describe("production domain configuration", () => {
  it("declares canonical and rollback-safe legacy custom domains", () => {
    expect(wranglerConfig.routes).toEqual([
      {
        pattern: "draw.yaseenarshad.com",
        custom_domain: true,
      },
      {
        pattern: "draw.yasinarshad.com",
        custom_domain: true,
      },
    ]);
  });

  it("runs the Worker before every asset path so host redirects cannot bypass it", () => {
    expect(wranglerConfig.assets.run_worker_first).toBe(true);
  });

  it("keeps the production Convex and R2 data plane unchanged", () => {
    expect(wranglerConfig.vars.CONVEX_SITE_URL).toBe(
      "https://moonlit-boar-611.convex.site",
    );
    expect(wranglerConfig.r2_buckets).toEqual([
      {
        binding: "DIAGRAM_ASSETS",
        bucket_name: "yaseen-excalidraw-assets",
      },
    ]);
  });
});
