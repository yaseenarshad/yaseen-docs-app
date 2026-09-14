const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Returns the original JSON text, never a reserialized/normalized document. */
export const decodeBoardSceneDocument = (bytes: Uint8Array): string => {
  try {
    const json = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
    const scene: unknown = JSON.parse(json);
    if (
      !isRecord(scene) ||
      !Array.isArray(scene.elements) ||
      !isRecord(scene.appState)
    ) {
      throw new Error("Board scene document is invalid");
    }
    return json;
  } catch {
    throw new Error("Board scene document is invalid");
  }
};
