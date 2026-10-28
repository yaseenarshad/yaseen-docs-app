import {
  acceptCloudSceneWithoutSave,
  shouldQueueCloudSceneSave,
} from "./cloudSaveBaseline";

describe("cloud save baseline", () => {
  it("does not save an accepted opening viewport but saves the next user change", () => {
    const baseline = acceptCloudSceneWithoutSave("fresh fitted scene");

    expect(shouldQueueCloudSceneSave(baseline, "fresh fitted scene")).toBe(
      false,
    );
    expect(shouldQueueCloudSceneSave(baseline, "user panned scene")).toBe(true);
  });

  it("never queues a server-originated scene back to Convex", () => {
    const shouldQueueServerScene = Reflect.apply(
      shouldQueueCloudSceneSave,
      null,
      ["saved scene", "reconciled server scene", "server-echo"],
    );

    expect(shouldQueueServerScene).toBe(false);
  });

  it("queues a server merge that contains an unpersisted local edit", () => {
    const shouldQueueMergedScene = Reflect.apply(
      shouldQueueCloudSceneSave,
      null,
      ["saved scene", "merged local scene", "server-merge"],
    );

    expect(shouldQueueMergedScene).toBe(true);
  });
});
