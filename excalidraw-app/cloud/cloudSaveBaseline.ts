export const acceptCloudSceneWithoutSave = (sceneJson: string) => sceneJson;

export const shouldQueueCloudSceneSave = (
  acceptedSceneJson: string | null,
  sceneJson: string,
) => acceptedSceneJson !== sceneJson;
