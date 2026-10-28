import { describe, expect, it } from "vitest";

import {
  BOARD_SORTS,
  composeBoardSort,
  dedupeBoards,
  getStoredBoardSort,
  splitBoardSort,
} from "./boardOrganizer";

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
    for (const sort of BOARD_SORTS) {
      expect(getStoredBoardSort(sort)).toBe(sort);
    }
    expect(getStoredBoardSort("not-a-sort")).toBe("modified-desc");
    expect(getStoredBoardSort(null)).toBe("modified-desc");
  });

  it.each([
    ["name-asc", "name", "asc"],
    ["name-desc", "name", "desc"],
    ["created-asc", "created", "asc"],
    ["created-desc", "created", "desc"],
    ["modified-asc", "modified", "asc"],
    ["modified-desc", "modified", "desc"],
  ] as const)(
    "splits and composes the existing %s BoardSort contract",
    (sort, category, direction) => {
      expect(splitBoardSort(sort)).toEqual({ category, direction });
      expect(composeBoardSort(category, direction)).toBe(sort);
    },
  );
});
