import { hasElementVersionRegression } from "./sceneConflict";

const makeScene = (
  elements: Array<{
    id: string;
    version: number;
    isDeleted?: boolean;
  }>,
) => JSON.stringify({ elements, appState: {}, files: {} });

describe("hasElementVersionRegression", () => {
  it("detects an older element revision in an otherwise current save", () => {
    expect(
      hasElementVersionRegression(
        makeScene([
          { id: "headline", version: 2 },
          { id: "box", version: 4 },
        ]),
        makeScene([
          { id: "headline", version: 1 },
          { id: "box", version: 5 },
        ]),
      ),
    ).toBe(true);
  });

  it("accepts equal or newer revisions and newly added elements", () => {
    expect(
      hasElementVersionRegression(
        makeScene([{ id: "headline", version: 2 }]),
        makeScene([
          { id: "headline", version: 2 },
          { id: "new-box", version: 1 },
        ]),
      ),
    ).toBe(false);
  });

  it("rejects dropping a live element but allows pruning a deleted element", () => {
    expect(
      hasElementVersionRegression(
        makeScene([{ id: "headline", version: 2 }]),
        makeScene([]),
      ),
    ).toBe(true);
    expect(
      hasElementVersionRegression(
        makeScene([{ id: "old-box", version: 3, isDeleted: true }]),
        makeScene([]),
      ),
    ).toBe(false);
  });
});
