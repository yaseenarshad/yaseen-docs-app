import { FONT_FAMILY, getFontString } from "@excalidraw/common";
import {
  newElement,
  newFrameElement,
  newTextElement,
  wrapText,
} from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  applyPresentationTemplate,
  getPresentationMetadata,
  type PresentationLayoutWarning,
} from "./templateApplication";
import {
  createPresentationElementId,
  mapSlideToSceneMetadata,
  type PresentationChildMetadata,
  type PresentationRenderMode,
  type StoryboardPresentation,
  type StoryboardSlide,
} from "./sceneContract";
import {
  presentationTemplateRegistry,
  type PresentationTemplateDefinition,
} from "./templateRegistry";

import type { BinaryFiles } from "../types";

export type SlideRenderIssueCode =
  | "LAYOUT_OVERFLOW"
  | "MISSING_ASSET"
  | "NATIVE_COMPOSITION_NOT_FOUND"
  | "ANIMATION_ASSET_UNRESOLVED";

export type SlideRenderIssue = {
  code: SlideRenderIssueCode;
  severity: "warning" | "error";
  slideId: string;
  target: string;
  message: string;
};

export type RenderedPresentationSlide = {
  slideId: string;
  mode: PresentationRenderMode;
  elements: NonDeletedExcalidrawElement[];
  files: BinaryFiles;
  issues: SlideRenderIssue[];
};

const layoutWarningToIssue = (
  warning: PresentationLayoutWarning,
): SlideRenderIssue => ({
  code: warning.message.includes("trusted asset resolver")
    ? "ANIMATION_ASSET_UNRESOLVED"
    : "LAYOUT_OVERFLOW",
  severity: warning.severity,
  slideId: warning.slideId,
  target: warning.slotId,
  message: warning.message,
});

const withStableId = <T extends NonDeletedExcalidrawElement>(
  element: T,
  id: string,
): T => ({ ...element, id });

const nativeChildMetadata = (
  metadata: PresentationChildMetadata,
  slotId: string,
): PresentationChildMetadata => ({ ...metadata, slotId });

const createNativeText = ({
  presentation,
  slide,
  frameId,
  metadata,
  slotId,
  text,
  x,
  y,
  width,
  height,
  fontSize,
  fontFamily = FONT_FAMILY.Inter,
  fontWeight = "normal",
  lineHeight = 1.2,
  strokeColor = "#14251f",
}: {
  presentation: StoryboardPresentation;
  slide: StoryboardSlide;
  frameId: string;
  metadata: PresentationChildMetadata;
  slotId?: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: typeof FONT_FAMILY.Inter | typeof FONT_FAMILY["IBM Plex Mono"];
  fontWeight?: "normal" | "bold";
  lineHeight?: number;
  strokeColor?: string;
}) => {
  const wrapped = wrapText(
    text,
    getFontString({ fontFamily, fontSize, fontWeight }),
    width,
  );
  const childMetadata = slotId
    ? nativeChildMetadata(metadata, slotId)
    : metadata;
  const element = newTextElement({
    x,
    y,
    width,
    height,
    frameId,
    text: wrapped,
    originalText: wrapped,
    fontSize,
    fontFamily,
    fontWeight,
    lineHeight: lineHeight as ExcalidrawTextElement["lineHeight"],
    autoResize: false,
    roughness: 0,
    locked: false,
    strokeColor,
    customData: { yaseenPresentation: childMetadata },
  });
  return {
    ...element,
    id: createPresentationElementId({
      presentationId: presentation.presentationId,
      slideId: slide.id,
      role: childMetadata.role,
      slotId: childMetadata.slotId,
    }),
    x,
    y,
    width,
    height,
    autoResize: false,
  } as NonDeleted<ExcalidrawTextElement>;
};

const createNativeRectangle = ({
  presentation,
  slide,
  frameId,
  metadata,
  slotId,
  x,
  y,
  width,
  height,
  backgroundColor,
  strokeColor,
}: {
  presentation: StoryboardPresentation;
  slide: StoryboardSlide;
  frameId: string;
  metadata: PresentationChildMetadata;
  slotId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: string;
  strokeColor: string;
}) => {
  const childMetadata = nativeChildMetadata(metadata, slotId);
  return withStableId(
    newElement({
      type: "rectangle",
      x,
      y,
      width,
      height,
      frameId,
      backgroundColor,
      strokeColor,
      fillStyle: "solid",
      roundness: { type: 3 },
      roughness: 0,
      locked: false,
      customData: { yaseenPresentation: childMetadata },
    }),
    createPresentationElementId({
      presentationId: presentation.presentationId,
      slideId: slide.id,
      role: childMetadata.role,
      slotId,
    }),
  );
};

const renderFullNativeSlide = ({
  presentation,
  slide,
  template,
  origin,
}: {
  presentation: StoryboardPresentation;
  slide: Extract<StoryboardSlide, { renderMode: "full-native" }>;
  template: PresentationTemplateDefinition;
  origin: { x: number; y: number };
}): RenderedPresentationSlide => {
  const metadata = mapSlideToSceneMetadata(presentation, slide);
  const frameId = createPresentationElementId({
    presentationId: presentation.presentationId,
    slideId: slide.id,
    role: "frame",
  });
  const frame = withStableId(
    newFrameElement({
      name: `${String(slide.order).padStart(2, "0")} ${slide.headline}`,
      x: origin.x,
      y: origin.y,
      width: template.canvas.width,
      height: template.canvas.height,
      strokeColor: "#0f5843",
      roughness: 0,
      locked: false,
      customData: {
        presentationOrder: slide.order,
        yaseenPresentation: metadata.frame,
      },
    }),
    frameId,
  );
  const elements: NonDeletedExcalidrawElement[] = [frame];
  const x = origin.x;
  const y = origin.y;

  elements.push(
    createNativeRectangle({
      presentation,
      slide,
      frameId,
      metadata: metadata.children.nativeVisual,
      slotId: "background",
      x,
      y,
      width: template.canvas.width,
      height: template.canvas.height,
      backgroundColor: "#f8f7f3",
      strokeColor: "transparent",
    }),
    createNativeText({
      presentation,
      slide,
      frameId,
      metadata: metadata.children.eyebrow,
      text: slide.eyebrow.toUpperCase(),
      x: x + 62,
      y: y + 52,
      width: 500,
      height: 28,
      fontSize: 18,
      fontFamily: FONT_FAMILY["IBM Plex Mono"],
      fontWeight: "bold",
      strokeColor: "#0f5843",
    }),
    createNativeText({
      presentation,
      slide,
      frameId,
      metadata: metadata.children.headline,
      text: slide.headline,
      x: x + 62,
      y: y + 112,
      width: 520,
      height: 150,
      fontSize: 52,
      fontWeight: "bold",
      lineHeight: 1.04,
    }),
    createNativeText({
      presentation,
      slide,
      frameId,
      metadata: metadata.children.body,
      text: slide.body,
      x: x + 62,
      y: y + 292,
      width: 500,
      height: 110,
      fontSize: 24,
      lineHeight: 1.35,
      strokeColor: "#5f7169",
    }),
  );

  const issues: SlideRenderIssue[] = [];
  if (slide.visual.sourceId !== "native-composition-automation-levels") {
    issues.push({
      code: "NATIVE_COMPOSITION_NOT_FOUND",
      severity: "error",
      slideId: slide.id,
      target: slide.visual.sourceId,
      message: `native composition "${slide.visual.sourceId}" is not registered`,
    });
  } else {
    const levels = [
      ["01", "Manual", "You direct every step"],
      ["02", "Assisted", "AI drafts; you decide"],
      ["03", "Autonomous", "The agent runs the loop"],
    ] as const;
    levels.forEach(([number, title, body], index) => {
      const cardY = y + 88 + index * 176;
      const slotId = `automation-level-${index + 1}`;
      elements.push(
        createNativeRectangle({
          presentation,
          slide,
          frameId,
          metadata: metadata.children.nativeVisual,
          slotId: `${slotId}-card`,
          x: x + 650,
          y: cardY,
          width: 520,
          height: 140,
          backgroundColor: index === 2 ? "#0f5843" : "#ffffff",
          strokeColor: "#0f5843",
        }),
        createNativeText({
          presentation,
          slide,
          frameId,
          metadata: metadata.children.nativeVisual,
          slotId: `${slotId}-number`,
          text: number,
          x: x + 678,
          y: cardY + 26,
          width: 54,
          height: 26,
          fontSize: 18,
          fontFamily: FONT_FAMILY["IBM Plex Mono"],
          fontWeight: "bold",
          strokeColor: index === 2 ? "#19c37d" : "#0f5843",
        }),
        createNativeText({
          presentation,
          slide,
          frameId,
          metadata: metadata.children.nativeVisual,
          slotId: `${slotId}-title`,
          text: title,
          x: x + 748,
          y: cardY + 20,
          width: 380,
          height: 38,
          fontSize: 30,
          fontWeight: "bold",
          strokeColor: index === 2 ? "#ffffff" : "#14251f",
        }),
        createNativeText({
          presentation,
          slide,
          frameId,
          metadata: metadata.children.nativeVisual,
          slotId: `${slotId}-body`,
          text: body,
          x: x + 748,
          y: cardY + 72,
          width: 380,
          height: 34,
          fontSize: 20,
          strokeColor: index === 2 ? "#dff3e8" : "#5f7169",
        }),
      );
    });
  }

  return {
    slideId: slide.id,
    mode: slide.renderMode,
    elements,
    files: {},
    issues,
  };
};

export const renderPresentationSlide = ({
  presentation,
  slide,
  assets = {},
  origin = { x: 0, y: 0 },
}: {
  presentation: StoryboardPresentation;
  slide: StoryboardSlide;
  assets?: BinaryFiles;
  origin?: { x: number; y: number };
}): RenderedPresentationSlide => {
  const template = presentationTemplateRegistry.resolve({
    id: slide.templateId,
    version: slide.templateVersion,
  });
  if (slide.renderMode === "full-native") {
    return renderFullNativeSlide({
      presentation,
      slide,
      template,
      origin,
    });
  }

  const applied = applyPresentationTemplate({
    presentation,
    slide,
    template,
    origin,
  });
  const files: BinaryFiles = { ...applied.files };
  let elements = applied.elements;
  const issues = applied.warnings.map(layoutWarningToIssue);

  if (slide.renderMode === "image") {
    const asset = assets[slide.visual.assetId];
    if (asset) {
      files[asset.id] = asset;
    } else {
      issues.push({
        code: "MISSING_ASSET",
        severity: "error",
        slideId: slide.id,
        target: slide.visual.assetId,
        message: `image asset "${slide.visual.assetId}" is unavailable`,
      });
    }
  } else if (slide.visual.previewAssetId) {
    const preview = assets[slide.visual.previewAssetId];
    if (preview) {
      files[preview.id] = preview;
      elements = applied.elements.map((element) => {
        const metadata = getPresentationMetadata(element);
        if (
          element.type !== "image" ||
          metadata?.kind !== "slide-child" ||
          metadata.role !== "animation-preview"
        ) {
          return element;
        }
        if (element.fileId) {
          delete files[element.fileId];
        }
        return { ...element, fileId: preview.id };
      });
    } else {
      issues.push({
        code: "MISSING_ASSET",
        severity: "warning",
        slideId: slide.id,
        target: slide.visual.previewAssetId,
        message: `animation preview asset "${slide.visual.previewAssetId}" is unavailable; using the deterministic fallback poster`,
      });
    }
  }

  return {
    slideId: slide.id,
    mode: slide.renderMode,
    elements,
    files,
    issues,
  };
};
