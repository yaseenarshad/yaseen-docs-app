import { describe, expect, it } from "vitest";

import { extractDocPlacementRefs, hashDocPlacementRefs } from "./types";

const scene = (elements: unknown[]) =>
  JSON.stringify({ type: "excalidraw", elements, appState: {}, files: {} });

const docCard = (id: string, docId: string, overrides = {}) => ({
  id,
  type: "embeddable",
  link: `https://docs.yaseendraw.local/${docId}`,
  customData: { yaseenDoc: { docId, titleSnapshot: "Strategy" } },
  ...overrides,
});

describe("Doc placement references", () => {
  it("extracts live namespaced Doc cards once and sorts them canonically", () => {
    expect(
      extractDocPlacementRefs(
        scene([
          docCard("element-z", "doc-b"),
          docCard("element-a", "doc-a"),
          docCard("element-z", "doc-b"),
          docCard("deleted", "doc-c", { isDeleted: true }),
        ]),
      ),
    ).toEqual([
      { docId: "doc-a", elementId: "element-a" },
      { docId: "doc-b", elementId: "element-z" },
    ]);
  });

  it("ignores ordinary embeds and malformed or mismatched Doc metadata", () => {
    expect(
      extractDocPlacementRefs(
        scene([
          {
            ...docCard("foreign-origin", "doc-a"),
            link: "https://example.com",
          },
          {
            ...docCard("mismatch", "doc-a"),
            link: "https://docs.yaseendraw.local/doc-b",
          },
          { ...docCard("wrong-type", "doc-a"), type: "rectangle" },
          { ...docCard("missing-id", "doc-a"), id: "" },
          { id: "plain", type: "rectangle" },
        ]),
      ),
    ).toEqual([]);
    expect(extractDocPlacementRefs("not-json")).toEqual([]);
  });

  it("hashes the same logical refs identically regardless of scene order", async () => {
    const left = extractDocPlacementRefs(
      scene([docCard("two", "doc-b"), docCard("one", "doc-a")]),
    );
    const right = extractDocPlacementRefs(
      scene([docCard("one", "doc-a"), docCard("two", "doc-b")]),
    );

    await expect(hashDocPlacementRefs(left)).resolves.toBe(
      await hashDocPlacementRefs(right),
    );
  });
});
