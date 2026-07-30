import { describe, expect, it } from "vitest";

import {
  interleaveResults,
  normalizeIconifyResults,
  normalizeOpenverseResults,
} from "./imageStudio";

describe("Image Studio provider normalization", () => {
  it("keeps reusable Openverse images and rejects non-commercial licenses", () => {
    const results = normalizeOpenverseResults({
      results: [
        {
          id: "one",
          title: "Team",
          creator: "Alex",
          license: "by",
          license_version: "4.0",
          thumbnail: "https://example.com/team.jpg",
          category: "photograph",
        },
        {
          id: "two",
          title: "Restricted",
          license: "by-nc",
          thumbnail: "https://example.com/restricted.jpg",
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      itemKey: "openverse:one",
      provider: "openverse",
      kind: "photo",
      licenseName: "CC BY 4.0",
      creator: "Alex",
    });
  });

  it("marks brand collections as logos", () => {
    const results = normalizeIconifyResults({
      icons: ["tabler:chart-up", "simple-icons:openai"],
      collections: {
        tabler: { name: "Tabler Icons", license: { title: "MIT" } },
        "simple-icons": {
          name: "Simple Icons",
          category: "Brands / Social",
          license: { title: "CC0 1.0" },
        },
      },
    });

    expect(results.map((result) => result.kind)).toEqual(["icon", "logo"]);
    expect(results[1].trademarkNotice).toBe(true);
  });

  it("interleaves both providers", () => {
    const item = (provider: "openverse" | "iconify", id: string) => ({
      itemKey: `${provider}:${id}`,
      provider,
      providerId: id,
      kind: provider === "openverse" ? ("photo" as const) : ("icon" as const),
      title: id,
      previewUrl: id,
    });
    expect(
      interleaveResults(
        [item("openverse", "a"), item("openverse", "b")],
        [item("iconify", "c"), item("iconify", "d")],
      ).map(({ provider }) => provider),
    ).toEqual(["openverse", "iconify", "openverse", "iconify"]);
  });
});
