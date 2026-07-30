import { describe, expect, it } from "vitest";

import {
  getCanonicalRedirect,
  getCanonicalRedirectResponse,
} from "./canonicalRedirect";

describe("canonical Board redirect", () => {
  it("permanently canonicalizes /d/ on the new host while preserving query", () => {
    expect(
      getCanonicalRedirect(
        new URL("https://draw.yaseenarshad.com/d/board-slug?panel=history"),
      )?.toString(),
    ).toBe("https://draw.yaseenarshad.com/b/board-slug?panel=history");
  });

  it("canonicalizes old host and legacy path in one hop", () => {
    expect(
      getCanonicalRedirect(
        new URL("https://draw.yasinarshad.com/d/board-slug?q=1"),
      )?.toString(),
    ).toBe("https://draw.yaseenarshad.com/b/board-slug?q=1");
  });

  it("keeps shared paths unchanged apart from an old-host cutover", () => {
    expect(
      getCanonicalRedirect(
        new URL("https://draw.yaseenarshad.com/s/share-token"),
      ),
    ).toBeNull();
    expect(
      getCanonicalRedirect(
        new URL("https://draw.yasinarshad.com/s/share-token?x=1"),
      )?.toString(),
    ).toBe("https://draw.yaseenarshad.com/s/share-token?x=1");
  });

  it.each([
    "/",
    "/b/board-slug?panel=history",
    "/api/assets/object-key?download=1",
    "/unknown/deep/path?q=whiteboard",
  ])("moves every old-host path to the canonical host: %s", (path) => {
    expect(
      getCanonicalRedirect(
        new URL(`https://draw.yasinarshad.com${path}`),
      )?.toString(),
    ).toBe(`https://draw.yaseenarshad.com${path}`);
  });

  it("does not redirect canonical root, Board, share, API, or unknown paths", () => {
    for (const path of [
      "/",
      "/b/board-slug",
      "/s/share-token",
      "/api/assets/object-key",
      "/unknown",
    ]) {
      expect(
        getCanonicalRedirect(new URL(`https://draw.yaseenarshad.com${path}`)),
      ).toBeNull();
    }
  });

  it("marks permanent redirects no-store during the domain cutover", () => {
    const response = getCanonicalRedirectResponse(
      new URL("https://draw.yasinarshad.com/b/board-slug?panel=history"),
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get("Location")).toBe(
      "https://draw.yaseenarshad.com/b/board-slug?panel=history",
    );
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });
});
