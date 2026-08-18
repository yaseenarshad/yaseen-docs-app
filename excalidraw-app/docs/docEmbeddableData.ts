import { newEmbeddableElement } from "@excalidraw/element";

export const DOC_EMBEDDABLE_ORIGIN = "https://docs.yaseendraw.local";
export const DOC_EMBEDDABLE_DEFAULT_WIDTH = 480;
export const DOC_EMBEDDABLE_DEFAULT_HEIGHT = 560;

export type DocPlacementReference = {
  docId: string;
  titleSnapshot: string;
};

type ElementWithCustomData = {
  type?: string;
  link?: string | null;
  customData?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getDocPlacementReference = (
  element: ElementWithCustomData,
): DocPlacementReference | null => {
  if (
    element.type !== "embeddable" ||
    !isDocEmbeddableLink(element.link ?? null)
  ) {
    return null;
  }
  const reference = element.customData?.yaseenDoc;
  if (
    !isRecord(reference) ||
    typeof reference.docId !== "string" ||
    reference.docId.length === 0 ||
    typeof reference.titleSnapshot !== "string" ||
    reference.titleSnapshot.trim().length === 0 ||
    new URL(element.link!).pathname !==
      `/${encodeURIComponent(reference.docId)}`
  ) {
    return null;
  }

  return {
    docId: reference.docId,
    titleSnapshot: reference.titleSnapshot,
  };
};

export const getDocEmbeddableLink = (docId: string) =>
  `${DOC_EMBEDDABLE_ORIGIN}/${encodeURIComponent(docId)}`;

export const createDocEmbeddableElement = (args: {
  docId: string;
  title: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}) => {
  if (!args.docId.trim() || !args.title.trim()) {
    throw new Error("Doc card requires an id and title");
  }
  return newEmbeddableElement({
    type: "embeddable",
    x: args.x,
    y: args.y,
    width: args.width ?? DOC_EMBEDDABLE_DEFAULT_WIDTH,
    height: args.height ?? DOC_EMBEDDABLE_DEFAULT_HEIGHT,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: { type: 3 },
    locked: false,
    link: getDocEmbeddableLink(args.docId),
    customData: {
      yaseenDoc: {
        docId: args.docId,
        titleSnapshot: args.title.trim(),
      },
    },
  });
};

export const isDocEmbeddableLink = (link: string | null): boolean => {
  if (!link) {
    return false;
  }

  try {
    const url = new URL(link);
    return (
      url.origin === DOC_EMBEDDABLE_ORIGIN &&
      url.pathname.split("/").filter(Boolean).length === 1
    );
  } catch {
    return false;
  }
};
