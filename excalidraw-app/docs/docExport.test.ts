import { unzipSync, strFromU8 } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPortableDocZip, portableDocFilename } from "./docExport";

afterEach(() => vi.unstubAllGlobals());

describe("portable Doc export", () => {
  it("packages canonical Markdown and private assets at their stable paths", async () => {
    const path = `assets/${"a".repeat(32)}/diagram.png`;
    const markdown = `# Plan\n\n![diagram](${path})`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("png!")),
    );
    const zip = unzipSync(
      await buildPortableDocZip({
        title: "Q3 / Plan",
        markdown,
        resolveAssetPath: async () => "/api/doc-assets/grant",
      }),
    );
    expect(portableDocFilename(" Q3 / Plan ")).toBe("Q3-Plan");
    expect(Object.keys(zip).sort()).toEqual(["Q3-Plan.md", path].sort());
    expect(strFromU8(zip["Q3-Plan.md"])).toBe(markdown);
    expect(strFromU8(zip[path])).toBe("png!");
  });
});
