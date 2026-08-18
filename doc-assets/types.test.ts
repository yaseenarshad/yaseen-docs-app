import { describe, expect, it } from "vitest";

import {
  extractManagedDocAssetIds,
  parseDocAssetUploadGrant,
  parseManagedDocAssetPath,
} from "./types";

describe("Doc asset contracts", () => {
  it("extracts only canonical managed Markdown paths", () => {
    const first = "a".repeat(32);
    const second = "b".repeat(32);
    const markdown = `![one](assets/${second}/one.png)\n[x](https://x.test)\n[file](assets/${first}/a.pdf)\n![again](assets/${second}/one.png)`;
    expect(extractManagedDocAssetIds(markdown)).toEqual([first, second]);
    expect(parseManagedDocAssetPath(`assets/${first}/a.pdf`)).toEqual({
      assetId: first,
      filename: "a.pdf",
    });
  });

  it("fails closed for unsafe Worker grants", () => {
    expect(
      parseDocAssetUploadGrant({
        objectKey: `doc-assets/owner/${"a".repeat(32)}`,
        assetId: "a".repeat(32),
        mimeType: "image/svg+xml",
        size: 1,
        sha256: "b".repeat(64),
      }),
    ).toBeNull();
  });
});
