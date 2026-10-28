const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseElements = (sceneJson: string) => {
  let scene: unknown;
  try {
    scene = JSON.parse(sceneJson);
  } catch {
    throw new Error("Diagram scene is invalid");
  }
  if (!isRecord(scene) || !Array.isArray(scene.elements)) {
    throw new Error("Diagram scene is invalid");
  }
  return scene.elements;
};

const normalizeSceneIgnoringDerivedBindings = (sceneJson: string) => {
  let scene: unknown;
  try {
    scene = JSON.parse(sceneJson);
  } catch {
    throw new Error("Diagram scene is invalid");
  }
  if (!isRecord(scene) || !Array.isArray(scene.elements)) {
    throw new Error("Diagram scene is invalid");
  }
  return JSON.stringify({
    ...scene,
    elements: scene.elements.map((element) => {
      if (!isRecord(element)) {
        return element;
      }
      const semanticElement = { ...element };
      delete semanticElement.boundElements;
      return semanticElement;
    }),
  });
};

/**
 * The binding-insensitive projection a semantic digest is taken over. It
 * mirrors the client's `getCloudSceneSemanticRevision` exactly, including its
 * fallback for a scene that is not a recognisable document, so a scene written
 * by a server-side action and the same scene echoed back by a client produce
 * the same `semanticSha256`.
 */
export const getSceneSemanticRevision = (sceneJson: string) => {
  try {
    return normalizeSceneIgnoringDerivedBindings(sceneJson);
  } catch {
    return sceneJson;
  }
};

export const areScenesEquivalentIgnoringDerivedBindings = (
  currentSceneJson: string,
  incomingSceneJson: string,
) =>
  normalizeSceneIgnoringDerivedBindings(currentSceneJson) ===
  normalizeSceneIgnoringDerivedBindings(incomingSceneJson);

export const hasElementVersionRegression = (
  currentSceneJson: string,
  incomingSceneJson: string,
) => {
  const currentElements = parseElements(currentSceneJson);
  const incomingElements = parseElements(incomingSceneJson);
  const incomingById = new Map<string, Record<string, unknown>>();

  for (const element of incomingElements) {
    if (isRecord(element) && typeof element.id === "string") {
      incomingById.set(element.id, element);
    }
  }

  for (const current of currentElements) {
    if (!isRecord(current) || typeof current.id !== "string") {
      continue;
    }
    const incoming = incomingById.get(current.id);
    if (!incoming) {
      if (current.isDeleted !== true) {
        return true;
      }
      continue;
    }

    const currentVersion =
      typeof current.version === "number" ? current.version : 0;
    const incomingVersion =
      typeof incoming.version === "number" ? incoming.version : 0;
    if (incomingVersion < currentVersion) {
      return true;
    }
  }

  return false;
};
