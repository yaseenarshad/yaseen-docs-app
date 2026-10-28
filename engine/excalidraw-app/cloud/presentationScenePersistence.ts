export const MAX_HOSTED_PRESENTATION_SCENE_BYTES = 900_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isHostedAnimationReference = (value: unknown) =>
  isRecord(value) &&
  typeof value.assetId === "string" &&
  value.assetId.length > 0 &&
  Number.isSafeInteger(value.version) &&
  (value.version as number) > 0;

/**
 * Runtime capability URLs are deliberately memory-only. Hosted animation
 * elements persist a stable asset/version reference and never duplicate their
 * HTML bundle in Convex scene JSON. Embedded-only local animations are left
 * untouched for portable `.excalidraw` files.
 */
export const sanitizeCloudPresentationScene = (sceneJson: string) => {
  let scene: unknown;
  try {
    scene = JSON.parse(sceneJson);
  } catch {
    return sceneJson;
  }
  if (!isRecord(scene) || !Array.isArray(scene.elements)) {
    return sceneJson;
  }

  let changed = false;
  const elements = scene.elements.map((element) => {
    if (!isRecord(element) || !isRecord(element.customData)) {
      return element;
    }
    const customData = { ...element.customData };
    let elementChanged = false;
    if ("animationUrl" in customData) {
      delete customData.animationUrl;
      changed = true;
      elementChanged = true;
    }
    if (
      isHostedAnimationReference(customData.animationAsset) &&
      isRecord(customData.generationData) &&
      typeof customData.generationData.html === "string"
    ) {
      delete customData.generationData;
      changed = true;
      elementChanged = true;
    }
    return elementChanged ? { ...element, customData } : element;
  });
  return changed ? JSON.stringify({ ...scene, elements }) : sceneJson;
};

export const getPresentationSceneByteSize = (sceneJson: string) =>
  new TextEncoder().encode(sceneJson).byteLength;

export const isPresentationSceneWithinCloudLimit = (sceneJson: string) =>
  getPresentationSceneByteSize(sceneJson) < MAX_HOSTED_PRESENTATION_SCENE_BYTES;
