export const DOC_PLACEMENT_REFS_PROTOCOL_VERSION = 1;
export const MAX_DOC_PLACEMENT_REFS = 1_000;
export const DOC_EMBEDDABLE_ORIGIN = "https://docs.yaseendraw.local";

export type DocPlacementRef = {
  docId: string;
  elementId: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeDocPlacementRefs = (
  refs: readonly DocPlacementRef[],
): DocPlacementRef[] => {
  if (refs.length > MAX_DOC_PLACEMENT_REFS) {
    throw new Error(
      `A Board can contain up to ${MAX_DOC_PLACEMENT_REFS} Doc cards`,
    );
  }
  const byElementId = new Map<string, DocPlacementRef>();
  for (const ref of refs) {
    if (
      ref.docId.length === 0 ||
      ref.docId.length > 128 ||
      ref.elementId.length === 0 ||
      ref.elementId.length > 128 ||
      ref.docId.trim() !== ref.docId ||
      ref.elementId.trim() !== ref.elementId
    ) {
      throw new Error("Doc placement reference is invalid");
    }
    const previous = byElementId.get(ref.elementId);
    if (previous && previous.docId !== ref.docId) {
      throw new Error("A canvas element cannot reference multiple Docs");
    }
    byElementId.set(ref.elementId, ref);
  }
  return [...byElementId.values()].sort(
    (left, right) =>
      left.docId.localeCompare(right.docId) ||
      left.elementId.localeCompare(right.elementId),
  );
};

const getNamespacedDocId = (link: unknown) => {
  if (typeof link !== "string") {
    return null;
  }
  try {
    const url = new URL(link);
    const segments = url.pathname.split("/").filter(Boolean);
    return url.origin === DOC_EMBEDDABLE_ORIGIN && segments.length === 1
      ? decodeURIComponent(segments[0])
      : null;
  } catch {
    return null;
  }
};

/**
 * Reads only the stable Doc-card namespace from an exact serialized scene.
 * Ordinary embeds, deleted cards and malformed metadata are intentionally not
 * placements, so legacy and third-party embeddables stay outside this domain.
 */
export const extractDocPlacementRefs = (
  sceneJson: string,
): DocPlacementRef[] => {
  let scene: unknown;
  try {
    scene = JSON.parse(sceneJson);
  } catch {
    return [];
  }
  if (!isRecord(scene) || !Array.isArray(scene.elements)) {
    return [];
  }

  const refs: DocPlacementRef[] = [];
  for (const element of scene.elements) {
    if (
      !isRecord(element) ||
      element.type !== "embeddable" ||
      element.isDeleted === true ||
      typeof element.id !== "string" ||
      element.id.length === 0
    ) {
      continue;
    }
    const docIdFromLink = getNamespacedDocId(element.link);
    const customData = element.customData;
    const reference = isRecord(customData) ? customData.yaseenDoc : null;
    if (
      !docIdFromLink ||
      !isRecord(reference) ||
      reference.docId !== docIdFromLink
    ) {
      continue;
    }
    refs.push({ docId: docIdFromLink, elementId: element.id });
  }
  return normalizeDocPlacementRefs(refs);
};

export const hashDocPlacementRefs = async (
  refs: readonly DocPlacementRef[],
) => {
  const canonical = JSON.stringify(normalizeDocPlacementRefs(refs));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const describeDocPlacementRefs = async (sceneJson: string) => {
  const refs = extractDocPlacementRefs(sceneJson);
  return { refs, hash: await hashDocPlacementRefs(refs) };
};
