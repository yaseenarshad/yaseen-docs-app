import {
  readDocPlacementViewState,
  writeDocPlacementViewState,
} from "./docPlacementViewState";

describe("Doc placement view state", () => {
  beforeEach(() => localStorage.clear());

  it("keeps folds and scroll independent per canvas placement", () => {
    writeDocPlacementViewState("board", "element-a", {
      docVersion: 2,
      collapsedKeys: ["parent"],
      scrollTop: 120,
    });
    expect(readDocPlacementViewState("board", "element-a", 2)).toMatchObject({
      collapsedKeys: ["parent"],
      scrollTop: 120,
    });
    expect(readDocPlacementViewState("board", "element-b", 2)).toMatchObject({
      collapsedKeys: [],
      scrollTop: 0,
    });
  });

  it("drops stale fold keys when the Doc version changes", () => {
    writeDocPlacementViewState("board", "element-a", {
      docVersion: 2,
      collapsedKeys: ["stale"],
      scrollTop: 50,
    });
    expect(readDocPlacementViewState("board", "element-a", 3)).toMatchObject({
      collapsedKeys: [],
      scrollTop: 0,
      docVersion: 3,
    });
  });
});
