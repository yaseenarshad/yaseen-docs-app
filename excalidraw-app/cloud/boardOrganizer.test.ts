import { describe, expect, it } from "vitest";

import { dedupeBoards, getStoredBoardSort } from "./boardOrganizer";

describe("Board organizer pagination state", () => {
  it("deduplicates reactive/page overlap by stable Board ID", () => {
    expect(
      dedupeBoards([
        { _id: "a", title: "Old" },
        { _id: "b", title: "Second" },
        { _id: "a", title: "Reactive update" },
      ]),
    ).toEqual([
      { _id: "a", title: "Reactive update" },
      { _id: "b", title: "Second" },
    ]);
  });

  it("accepts only the approved locally stored sort values", () => {
    expect(getStoredBoardSort("name-desc")).toBe("name-desc");
    expect(getStoredBoardSort("not-a-sort")).toBe("modified-desc");
    expect(getStoredBoardSort(null)).toBe("modified-desc");
  });
});
