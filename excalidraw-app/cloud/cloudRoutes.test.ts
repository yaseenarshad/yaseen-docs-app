import { describe, expect, it } from "vitest";

import {
  getCanonicalOwnerPath,
  getLegacyOwnerReplacement,
  parseCloudRoute,
} from "./cloudRoutes";

describe("cloud Board routes", () => {
  it("parses canonical owners, legacy owners, and unchanged shared links", () => {
    expect(parseCloudRoute("/b/board-slug")).toEqual({
      kind: "owner",
      slug: "board-slug",
      isLegacyPath: false,
    });
    expect(parseCloudRoute("/d/board-slug/")).toEqual({
      kind: "owner",
      slug: "board-slug",
      isLegacyPath: true,
    });
    expect(parseCloudRoute("/s/share-token")).toEqual({
      kind: "shared",
      shareToken: "share-token",
    });
  });

  it("keeps malformed and unknown paths on established home behavior", () => {
    expect(parseCloudRoute("/b/")).toEqual({ kind: "home" });
    expect(parseCloudRoute("/b/a/extra")).toEqual({ kind: "home" });
    expect(parseCloudRoute("/b/%zz")).toEqual({ kind: "home" });
    expect(parseCloudRoute("/unknown")).toEqual({ kind: "home" });
  });

  it("builds canonical owner paths and preserves query/hash in fallback replacement", () => {
    expect(getCanonicalOwnerPath("board slug")).toBe("/b/board%20slug");
    expect(
      getLegacyOwnerReplacement(
        { kind: "owner", slug: "abc", isLegacyPath: true },
        "?panel=history",
        "#focus",
      ),
    ).toBe("/b/abc?panel=history#focus");
    expect(
      getLegacyOwnerReplacement(
        { kind: "owner", slug: "abc", isLegacyPath: false },
        "?panel=history",
        "",
      ),
    ).toBeNull();
  });
});
