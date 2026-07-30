import { describe, expect, it } from "vitest";

import { getCloudDocumentTitle } from "./cloudDocumentTitle";

describe("cloud document title", () => {
  it("uses the matching loaded owner Board title", () => {
    expect(
      getCloudDocumentTitle(
        { kind: "owner", slug: "roadmap", isLegacyPath: false },
        { slug: "roadmap", title: "Q4 🚀" },
      ),
    ).toBe("Q4 🚀 — Yaseen Whiteboard");
  });

  it("uses the product fallback while loading or when route data is stale", () => {
    const route = {
      kind: "owner",
      slug: "board-b",
      isLegacyPath: false,
    } as const;

    expect(getCloudDocumentTitle(route, undefined)).toBe("Yaseen Whiteboard");
    expect(
      getCloudDocumentTitle(route, {
        slug: "board-a",
        title: "Stale Board A",
      }),
    ).toBe("Yaseen Whiteboard");
  });

  it("keeps shared/home routes private and normalizes blank owner titles", () => {
    expect(
      getCloudDocumentTitle(
        { kind: "shared", shareToken: "secret" },
        { slug: "irrelevant", title: "Private roadmap" },
      ),
    ).toBe("Yaseen Whiteboard");
    expect(
      getCloudDocumentTitle(
        { kind: "owner", slug: "blank", isLegacyPath: false },
        { slug: "blank", title: "   " },
      ),
    ).toBe("Untitled board — Yaseen Whiteboard");
  });
});
