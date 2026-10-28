// @vitest-environment edge-runtime

import { describe, expect, it } from "vitest";

import { getUntitledBoardTitlePatch } from "./migrations";
import { getNormalizedBoardTitlePatch } from "./migrations";

describe("renameUntitledDiagrams migration", () => {
  it("patches only the exact legacy system title", () => {
    expect(getUntitledBoardTitlePatch({ title: "Untitled diagram" })).toEqual({
      title: "Untitled board",
    });
    expect(
      getUntitledBoardTitlePatch({ title: "untitled diagram" }),
    ).toBeNull();
    expect(
      getUntitledBoardTitlePatch({ title: "Untitled diagram " }),
    ).toBeNull();
    expect(getUntitledBoardTitlePatch({ title: "Roadmap" })).toBeNull();
  });

  it("never writes updatedAt or another durable field", () => {
    const patch = getUntitledBoardTitlePatch({
      title: "Untitled diagram",
    });

    expect(Object.keys(patch ?? {})).toEqual(["title"]);
  });
});

describe("backfillNormalizedBoardTitles migration", () => {
  it("writes only the derived normalized title when absent or stale", () => {
    expect(
      getNormalizedBoardTitlePatch({
        title: "  Q4 ROADMAP  ",
      }),
    ).toEqual({ normalizedTitle: "q4 roadmap" });
    expect(
      getNormalizedBoardTitlePatch({
        title: "Q4 Roadmap",
        normalizedTitle: "q4 roadmap",
      }),
    ).toBeNull();
    expect(
      Object.keys(getNormalizedBoardTitlePatch({ title: "Plan" }) ?? {}),
    ).toEqual(["normalizedTitle"]);
  });
});
