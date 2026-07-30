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
});
