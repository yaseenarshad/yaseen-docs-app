const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nextVersionNonce = (current: unknown, version: number) => {
  const seed =
    typeof current === "number" && Number.isFinite(current)
      ? Math.trunc(current)
      : 0;

  return (Math.imul(seed ^ version, 1_664_525) + 1_013_904_223) >>> 0;
};

export const updateTextElementInScene = (
  sceneJson: string,
  elementId: string,
  text: string,
  updatedAt: number,
) => {
  let scene: unknown;

  try {
    scene = JSON.parse(sceneJson);
  } catch {
    throw new Error("Diagram scene is invalid");
  }

  if (!isRecord(scene) || !Array.isArray(scene.elements)) {
    throw new Error("Diagram scene is invalid");
  }

  let found = false;
  const elements = scene.elements.map((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate.id !== elementId ||
      candidate.type !== "text" ||
      candidate.isDeleted === true
    ) {
      return candidate;
    }

    found = true;
    const version =
      typeof candidate.version === "number" &&
      Number.isFinite(candidate.version)
        ? candidate.version + 1
        : 1;

    return {
      ...candidate,
      text,
      originalText: text,
      version,
      versionNonce: nextVersionNonce(candidate.versionNonce, version),
      updated: updatedAt,
    };
  });

  if (!found) {
    throw new Error("Text element not found");
  }

  return JSON.stringify({ ...scene, elements });
};

export const patchElementsInScene = (
  sceneJson: string,
  updatesJson: string,
  updatedAt: number,
) => {
  let scene: unknown;
  let updates: unknown;

  try {
    scene = JSON.parse(sceneJson);
    updates = JSON.parse(updatesJson);
  } catch {
    throw new Error("Element updates are invalid");
  }

  if (
    !isRecord(scene) ||
    !Array.isArray(scene.elements) ||
    !Array.isArray(updates) ||
    updates.length === 0 ||
    updates.length > 100
  ) {
    throw new Error("Element updates are invalid");
  }

  const updatesByElementId = new Map<
    string,
    { elementId: string; patch: Record<string, unknown> }
  >();
  for (const update of updates) {
    if (
      !isRecord(update) ||
      typeof update.elementId !== "string" ||
      !isRecord(update.patch) ||
      updatesByElementId.has(update.elementId)
    ) {
      throw new Error("Element updates are invalid");
    }
    updatesByElementId.set(update.elementId, {
      elementId: update.elementId,
      patch: update.patch,
    });
  }

  const found = new Set<string>();
  const elements = scene.elements.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      candidate.isDeleted === true
    ) {
      return candidate;
    }
    const update = updatesByElementId.get(candidate.id);
    if (!update) {
      return candidate;
    }

    found.add(candidate.id);
    const patch = { ...update.patch };
    delete patch.id;
    delete patch.type;
    delete patch.version;
    delete patch.versionNonce;
    delete patch.updated;

    if (
      candidate.type === "text" &&
      typeof patch.text === "string" &&
      patch.originalText === undefined
    ) {
      patch.originalText = patch.text;
    }

    const version =
      typeof candidate.version === "number" &&
      Number.isFinite(candidate.version)
        ? candidate.version + 1
        : 1;
    return {
      ...candidate,
      ...patch,
      id: candidate.id,
      type: candidate.type,
      version,
      versionNonce: nextVersionNonce(candidate.versionNonce, version),
      updated: updatedAt,
    };
  });

  if (found.size !== updatesByElementId.size) {
    throw new Error("Element not found");
  }

  return JSON.stringify({ ...scene, elements });
};
