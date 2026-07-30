import {
  preserveCloudViewport,
  shouldApplyCloudScene,
  shouldMergeCloudScene,
} from "./cloudSceneSync";

describe("cloud scene synchronization", () => {
  it("applies a newer server version for an owner route", () => {
    expect(
      shouldApplyCloudScene(
        { routeKey: "owner:board", version: 10 },
        { routeKey: "owner:board", version: 11 },
      ),
    ).toBe(true);
  });

  it("does not reapply the same route and version", () => {
    expect(
      shouldApplyCloudScene(
        { routeKey: "owner:board", version: 11 },
        { routeKey: "owner:board", version: 11 },
      ),
    ).toBe(false);
  });

  it("replaces the scene on route changes and merges same-route updates", () => {
    expect(
      shouldMergeCloudScene(
        { routeKey: "owner:first", version: 4 },
        "owner:first",
      ),
    ).toBe(true);
    expect(
      shouldMergeCloudScene(
        { routeKey: "owner:first", version: 4 },
        "owner:second",
      ),
    ).toBe(false);
    expect(shouldMergeCloudScene(null, "owner:first")).toBe(false);
  });

  it("preserves the local viewport when merging a same-route cloud update", () => {
    const restoredAppState = {
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 as const },
      viewModeEnabled: false,
    };
    const localAppState = {
      scrollX: -420,
      scrollY: 180,
      zoom: { value: 1.6 as const },
    };

    expect(
      preserveCloudViewport(restoredAppState, localAppState, true),
    ).toEqual({
      ...restoredAppState,
      ...localAppState,
    });
  });
});
