import { hasElementVersionRegression } from "./sceneConflict";
import * as sceneConflict from "./sceneConflict";

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

describe("binding-only scene equivalence", () => {
  it("treats derived boundElements differences as equivalent", () => {
    const areScenesEquivalentIgnoringDerivedBindings = (
      sceneConflict as Record<string, unknown>
    ).areScenesEquivalentIgnoringDerivedBindings;

    expect(typeof areScenesEquivalentIgnoringDerivedBindings).toBe("function");
    if (typeof areScenesEquivalentIgnoringDerivedBindings !== "function") {
      return;
    }

    const current = JSON.stringify({
      elements: [
        {
          id: "container",
          type: "rectangle",
          version: 4,
          boundElements: [{ id: "label", type: "text" }],
        },
        {
          id: "label",
          type: "text",
          version: 2,
          containerId: "container",
        },
      ],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });
    const repaired = JSON.stringify({
      elements: [
        {
          id: "container",
          type: "rectangle",
          version: 4,
          boundElements: [],
        },
        {
          id: "label",
          type: "text",
          version: 2,
          containerId: "container",
        },
      ],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });

    expect(areScenesEquivalentIgnoringDerivedBindings(current, repaired)).toBe(
      true,
    );
  });

  it("preserves real app-state and binding-endpoint changes", () => {
    const areScenesEquivalentIgnoringDerivedBindings = (
      sceneConflict as Record<string, unknown>
    ).areScenesEquivalentIgnoringDerivedBindings;

    expect(typeof areScenesEquivalentIgnoringDerivedBindings).toBe("function");
    if (typeof areScenesEquivalentIgnoringDerivedBindings !== "function") {
      return;
    }

    const current = JSON.stringify({
      elements: [
        {
          id: "arrow",
          type: "arrow",
          version: 4,
          startBinding: null,
          boundElements: [],
        },
      ],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });
    const appStateEdit = JSON.stringify({
      ...JSON.parse(current),
      appState: { viewBackgroundColor: "#f5f5f5" },
    });
    const bindingEdit = JSON.stringify({
      ...JSON.parse(current),
      elements: [
        {
          ...JSON.parse(current).elements[0],
          startBinding: { elementId: "box", focus: 0, gap: 4 },
        },
      ],
    });

    expect(
      areScenesEquivalentIgnoringDerivedBindings(current, appStateEdit),
    ).toBe(false);
    expect(
      areScenesEquivalentIgnoringDerivedBindings(current, bindingEdit),
    ).toBe(false);
  });
});
