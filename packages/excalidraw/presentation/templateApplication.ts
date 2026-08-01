import { FONT_FAMILY, getFontString } from "@excalidraw/common";
import {
  newFrameElement,
  newIframeElement,
  newImageElement,
  newTextElement,
  wrapText,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  FileId,
  FontFamilyValues,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  createPresentationElementId,
  mapSlideToSceneMetadata,
  type PresentationChildMetadata,
  type PresentationFrameMetadata,
  type StoryboardPresentation,
  type StoryboardSlide,
} from "./sceneContract";
import { wrapAnimationHtmlWithLifecycleBridge } from "./animationBridge";
import { ANIMATION_PROTOCOL_VERSION } from "./animationProtocol";

import type { BinaryFiles, DataURL } from "../types";

import type {
  PresentationTemplateDefinition,
  PresentationTextSlot,
  PresentationVisualSlot,
} from "./templateRegistry";

export type PresentationElementMetadata =
  | PresentationFrameMetadata
  | PresentationChildMetadata;

export type PresentationLayoutWarning = {
  slideId: string;
  slotId: string;
  severity: "warning" | "error";
  message: string;
};

export type AppliedPresentationTemplate = {
  elements: NonDeletedExcalidrawElement[];
  files: BinaryFiles;
  warnings: PresentationLayoutWarning[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getPresentationMetadata = (
  element: Pick<ExcalidrawElement, "customData">,
): PresentationElementMetadata | null => {
  const metadata = element.customData?.yaseenPresentation;
  if (
    !isRecord(metadata) ||
    (metadata.kind !== "slide-frame" && metadata.kind !== "slide-child")
  ) {
    return null;
  }
  return metadata as PresentationElementMetadata;
};

const absoluteBounds = (
  bounds: { x: number; y: number; width: number; height: number },
  origin: { x: number; y: number },
) => ({
  x: origin.x + bounds.x,
  y: origin.y + bounds.y,
  width: bounds.width,
  height: bounds.height,
});

const fontFamilyValue = (
  family: PresentationTextSlot["font"]["family"],
): FontFamilyValues =>
  family === "ibm-plex-mono" ? FONT_FAMILY["IBM Plex Mono"] : FONT_FAMILY.Inter;

const wrapSlotText = ({
  text,
  slot,
  slideId,
  warnings,
}: {
  text: string;
  slot: PresentationTextSlot;
  slideId: string;
  warnings: PresentationLayoutWarning[];
}) => {
  const fontFamily = fontFamilyValue(slot.font.family);
  const wrapped = wrapText(
    text,
    getFontString({
      fontFamily,
      fontSize: slot.font.size,
      fontWeight: slot.font.weight,
    }),
    slot.bounds.width,
  );
  const lineCount = wrapped.split("\n").length;
  if (lineCount > slot.maxLines) {
    warnings.push({
      slideId,
      slotId: slot.id,
      severity: slot.overflow === "error" ? "error" : "warning",
      message: `slot "${slot.id}" uses ${lineCount} lines; maximum of ${slot.maxLines} lines`,
    });
  }
  return wrapped;
};

const createTextElement = ({
  presentation,
  slide,
  frameId,
  slot,
  text,
  origin,
  metadata,
  warnings,
  lineBolds,
}: {
  presentation: StoryboardPresentation;
  slide: StoryboardSlide;
  frameId: string;
  slot: PresentationTextSlot;
  text: string;
  origin: { x: number; y: number };
  metadata: PresentationChildMetadata;
  warnings: PresentationLayoutWarning[];
  lineBolds?: boolean[];
}) => {
  const wrapped = wrapSlotText({ text, slot, slideId: slide.id, warnings });
  const fontFamily = fontFamilyValue(slot.font.family);
  const bounds = absoluteBounds(slot.bounds, origin);
  const elementId = createPresentationElementId({
    presentationId: presentation.presentationId,
    slideId: slide.id,
    role: metadata.role,
    slotId: metadata.slotId,
  });
  const element = newTextElement({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frameId,
    text: wrapped,
    originalText: wrapped,
    fontFamily,
    fontSize: slot.font.size,
    fontWeight: slot.font.weight,
    lineHeight: slot.font.lineHeight as ExcalidrawTextElement["lineHeight"],
    textAlign: slot.alignment,
    verticalAlign: slot.verticalAlignment,
    autoResize: false,
    lineBolds,
    strokeColor: slot.role === "eyebrow" ? "#0f5843" : "#14251f",
    roughness: 0,
    locked: false,
    customData: { yaseenPresentation: metadata },
  });

  return {
    ...element,
    id: elementId,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    autoResize: false,
  } as NonDeleted<ExcalidrawTextElement>;
};

const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` as DataURL;

const escapeSvgText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const createAnimationPosterSvg = ({
  width,
  height,
  headline,
}: {
  width: number;
  height: number;
  headline: string;
}) => {
  const safeHeadline = escapeSvgText(
    headline.length > 64 ? `${headline.slice(0, 61)}…` : headline,
  );
  const labelSize = Math.max(11, Math.round(width * 0.022));
  const headlineSize = Math.max(20, Math.round(width * 0.05));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dce9e3" stroke-width="1"/></pattern><linearGradient id="wash" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8f7f3"/><stop offset="1" stop-color="#dff3e8"/></linearGradient></defs><rect width="100%" height="100%" rx="22" fill="url(#wash)"/><rect width="100%" height="100%" rx="22" fill="url(#grid)" opacity=".72"/><rect x="${Math.round(
    width * 0.08,
  )}" y="${Math.round(height * 0.18)}" width="${Math.round(
    width * 0.05,
  )}" height="6" rx="3" fill="#19c37d"/><text x="${Math.round(
    width * 0.08,
  )}" y="${Math.round(
    height * 0.34,
  )}" fill="#0f5843" font-family="IBM Plex Mono, monospace" font-size="${labelSize}" font-weight="700" letter-spacing="2">ANIMATED VISUAL</text><text x="${Math.round(
    width * 0.08,
  )}" y="${Math.round(
    height * 0.56,
  )}" fill="#14251f" font-family="Inter, sans-serif" font-size="${headlineSize}" font-weight="700">${safeHeadline}</text><text x="${Math.round(
    width * 0.08,
  )}" y="${Math.round(
    height * 0.76,
  )}" fill="#5f7169" font-family="Inter, sans-serif" font-size="${labelSize}">Deterministic preview · plays in Presentation Mode</text></svg>`;
};

const createVisualElement = ({
  presentation,
  slide,
  frameId,
  slot,
  origin,
  metadata,
  warnings,
}: {
  presentation: StoryboardPresentation;
  slide: StoryboardSlide;
  frameId: string;
  slot: PresentationVisualSlot;
  origin: { x: number; y: number };
  metadata: PresentationChildMetadata;
  warnings: PresentationLayoutWarning[];
}): NonDeletedExcalidrawElement | null => {
  const bounds = absoluteBounds(slot.bounds, origin);
  const elementId = createPresentationElementId({
    presentationId: presentation.presentationId,
    slideId: slide.id,
    role: metadata.role,
  });
  const common = {
    ...bounds,
    frameId,
    roughness: 0,
    locked: false,
  };

  if (slide.renderMode === "image") {
    return {
      ...newImageElement({
        ...common,
        type: "image",
        fileId: slide.visual.assetId as FileId,
        status: "saved",
        roundness: { type: 3 },
        customData: { yaseenPresentation: metadata },
      }),
      id: elementId,
    };
  }

  if (slide.renderMode === "animation") {
    const generationData =
      slide.visual.source.kind === "embedded-html"
        ? {
            status: "done" as const,
            html: wrapAnimationHtmlWithLifecycleBridge(
              slide.visual.source.html,
            ),
          }
        : undefined;
    if (slide.visual.source.kind === "asset") {
      warnings.push({
        slideId: slide.id,
        slotId: slot.id,
        severity: "warning",
        message: `animation asset "${slide.visual.source.assetId}" requires the trusted asset resolver`,
      });
    }
    return {
      ...newIframeElement({
        ...common,
        type: "iframe",
        roundness: { type: 3 },
        customData: {
          animationProtocolVersion: ANIMATION_PROTOCOL_VERSION,
          generationData,
          animationAsset:
            slide.visual.source.kind === "asset"
              ? {
                  assetId: slide.visual.source.assetId,
                  version: slide.visual.source.version,
                }
              : undefined,
          previewAssetId: slide.visual.previewAssetId,
          yaseenPresentation: metadata,
        },
      }),
      id: elementId,
    };
  }

  return null;
};

export const applyPresentationTemplate = ({
  presentation,
  slide,
  template,
  origin = { x: 0, y: 0 },
}: {
  presentation: StoryboardPresentation;
  slide: StoryboardSlide;
  template: PresentationTemplateDefinition;
  origin?: { x: number; y: number };
}): AppliedPresentationTemplate => {
  if (
    slide.templateId !== template.id ||
    slide.templateVersion !== template.version
  ) {
    throw new Error(
      `slide "${slide.id}" requests ${slide.templateId}@${slide.templateVersion}, received ${template.id}@${template.version}`,
    );
  }
  if (!template.supportedRenderModes.includes(slide.renderMode)) {
    throw new Error(
      `template ${template.id}@${template.version} does not support ${slide.renderMode}`,
    );
  }

  const warnings: PresentationLayoutWarning[] = [];
  const metadata = mapSlideToSceneMetadata(presentation, slide);
  const frameId = createPresentationElementId({
    presentationId: presentation.presentationId,
    slideId: slide.id,
    role: "frame",
  });
  const frame = {
    ...newFrameElement({
      name: `${String(slide.order).padStart(2, "0")} ${slide.headline}`,
      x: origin.x,
      y: origin.y,
      width: template.canvas.width,
      height: template.canvas.height,
      strokeColor: "#0f5843",
      roughness: 0,
      customData: {
        presentationOrder: slide.order,
        yaseenPresentation: metadata.frame,
      },
    }),
    id: frameId,
  };

  const plateSlot = template.slots["template-background"];
  if (!plateSlot || plateSlot.kind !== "plate") {
    throw new Error(
      `template ${template.id}@${template.version} has no plate slot`,
    );
  }
  const plate = {
    ...newImageElement({
      type: "image",
      ...absoluteBounds(plateSlot.bounds, origin),
      frameId,
      fileId: template.plate.assetId as FileId,
      status: "saved",
      roughness: 0,
      locked: true,
      customData: {
        yaseenPresentation: metadata.children.templateBackground,
      },
    }),
    id: createPresentationElementId({
      presentationId: presentation.presentationId,
      slideId: slide.id,
      role: "template-background",
    }),
  };

  const elements: NonDeletedExcalidrawElement[] = [frame, plate];
  const supplementalFiles: BinaryFiles = {};

  const copySlots = [
    ["eyebrow", slide.eyebrow, metadata.children.eyebrow],
    ["headline", slide.headline, metadata.children.headline],
    ["body", slide.body, metadata.children.body],
  ] as const;

  for (const [slotId, text, childMetadata] of copySlots) {
    const slot = template.slots[slotId];
    if (!slot || slot.kind !== "text") {
      throw new Error(
        `template ${template.id}@${template.version} has no text slot "${slotId}"`,
      );
    }
    elements.push(
      createTextElement({
        presentation,
        slide,
        frameId,
        slot,
        text,
        origin,
        metadata: childMetadata,
        warnings,
      }),
    );
  }

  const cardSlotIds =
    template.id === "foundations-editorial-dense" && slide.cards.length === 4
      ? ["card-1", "card-2", "card-3", "card-5"]
      : slide.cards.map((_, index) => `card-${index + 1}`);
  slide.cards.forEach((card, index) => {
    const slotId = cardSlotIds[index];
    const slot = template.slots[slotId];
    if (!slot || slot.kind !== "text") {
      warnings.push({
        slideId: slide.id,
        slotId,
        severity: "error",
        message: `template has no compatible slot for card "${card.id}"`,
      });
      return;
    }
    const title = wrapSlotText({
      text: card.headline,
      slot,
      slideId: slide.id,
      warnings,
    });
    const body = wrapSlotText({
      text: card.body,
      slot,
      slideId: slide.id,
      warnings,
    });
    const cardText = `${title}\n\n${body}`;
    const boldLines = title.split("\n").length;
    elements.push(
      createTextElement({
        presentation,
        slide,
        frameId,
        slot,
        text: cardText,
        origin,
        metadata: metadata.children.cards(card.id),
        warnings,
        lineBolds: cardText
          .split("\n")
          .map((_, lineIndex) => lineIndex < boldLines),
      }),
    );
  });

  const visualSlotId =
    slide.renderMode === "animation" ? "animated-visual" : "static-visual";
  const visualSlot = template.slots[visualSlotId];
  if (
    slide.renderMode !== "full-native" &&
    (!visualSlot || visualSlot.kind !== "visual")
  ) {
    throw new Error(
      `template ${template.id}@${template.version} has no visual slot "${visualSlotId}"`,
    );
  }
  if (visualSlot?.kind === "visual") {
    if (slide.renderMode === "animation") {
      const bounds = absoluteBounds(visualSlot.bounds, origin);
      const previewFileId = createPresentationElementId({
        presentationId: presentation.presentationId,
        slideId: slide.id,
        role: "animation-preview",
        slotId: "fallback-poster-file",
      }) as FileId;
      elements.push({
        ...newImageElement({
          ...bounds,
          frameId,
          type: "image",
          fileId: previewFileId,
          status: "saved",
          roundness: { type: 3 },
          roughness: 0,
          locked: true,
          customData: {
            yaseenPresentation: {
              ...metadata.children.animationPreview,
              slotId: "fallback-poster",
            },
          },
        }),
        id: createPresentationElementId({
          presentationId: presentation.presentationId,
          slideId: slide.id,
          role: "animation-preview",
          slotId: "fallback-poster",
        }),
      });
      supplementalFiles[previewFileId] = {
        id: previewFileId,
        mimeType: "image/svg+xml",
        dataURL: svgDataUrl(
          createAnimationPosterSvg({
            width: visualSlot.bounds.width,
            height: visualSlot.bounds.height,
            headline: slide.headline,
          }),
        ),
        created: 0,
        lastRetrieved: 0,
      };
    }
    const visual = createVisualElement({
      presentation,
      slide,
      frameId,
      slot: visualSlot,
      origin,
      metadata:
        slide.renderMode === "animation"
          ? metadata.children.animatedVisual
          : metadata.children.staticVisual,
      warnings,
    });
    if (visual) {
      elements.push(visual);
    }
  }

  const plateFileId = template.plate.assetId as FileId;
  const files: BinaryFiles = {
    ...supplementalFiles,
    [plateFileId]: {
      id: plateFileId,
      mimeType: template.plate.mimeType,
      dataURL: svgDataUrl(template.plate.svg),
      created: 0,
      lastRetrieved: 0,
    },
  };

  return { elements, files, warnings };
};
