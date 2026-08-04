export const acceptCloudSceneWithoutSave = (sceneJson: string) => sceneJson;

export type CloudSceneSaveOrigin = "local" | "server-echo" | "server-merge";

export const shouldQueueCloudSceneSave = (
  acceptedSceneJson: string | null,
  sceneJson: string,
  origin: CloudSceneSaveOrigin = "local",
) => origin !== "server-echo" && acceptedSceneJson !== sceneJson;
