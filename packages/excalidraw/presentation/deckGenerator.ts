import { hashString } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { serializeAsJSON } from "../data/json";

import {
  StoryboardContractError,
  validateStoryboardPresentation,
  type PresentationRenderMode,
  type PresentationTemplateContract,
  type StoryboardContractIssue,
  type StoryboardPresentation,
} from "./sceneContract";
import {
  renderPresentationSlide,
  type SlideRenderIssue,
} from "./slideRenderer";
import { presentationTemplateRegistry } from "./templateRegistry";

import type { AppState, BinaryFileData, BinaryFiles } from "../types";

export type PresentationDeckLayout = {
  origins: Record<string, { x: number; y: number }>;
  sourceCanvas?: { width: number; height: number };
};

export type PresentationDeckGenerationIssue =
  | SlideRenderIssue
  | {
      code:
        | "INVALID_STORYBOARD"
        | "NON_SEQUENTIAL_ORDER"
        | "DUPLICATE_ELEMENT_ID"
        | "CONFLICTING_FILE_ID";
      severity: "error";
      slideId?: string;
      target: string;
      message: string;
    };

export class PresentationDeckGenerationError extends Error {
  public readonly issues: readonly PresentationDeckGenerationIssue[];

  constructor(issues: readonly PresentationDeckGenerationIssue[]) {
    super(
      `Presentation generation failed:\n${issues
        .map(
          (issue) =>
            `- ${issue.slideId ? `[${issue.slideId}] ` : ""}${issue.message}`,
        )
        .join("\n")}`,
    );
    this.name = "PresentationDeckGenerationError";
    this.issues = issues;
  }
}

export type GeneratedPresentationScene = {
  type: "excalidraw";
  version: 2;
  source: "yaseendraw-presentation-generator";
  elements: NonDeletedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

export type PresentationDeckReport = {
  presentationId: string;
  slideCount: number;
  frameCount: number;
  elementCount: number;
  modeCounts: Record<PresentationRenderMode, number>;
  fileCount: number;
  warningCount: number;
  warnings: SlideRenderIssue[];
  portableBytes: number;
  cloudBytes: number;
  sourceCanvas?: { width: number; height: number };
  sceneBounds: { x: number; y: number; width: number; height: number };
};

export type GeneratedPresentationDeck = {
  scene: GeneratedPresentationScene;
  portableJson: string;
  cloudJson: string;
  report: PresentationDeckReport;
};

const templateContracts = (): PresentationTemplateContract[] => {
  const byId = new Map<string, PresentationTemplateContract>();
  for (const template of presentationTemplateRegistry.list()) {
    byId.set(template.id, {
      id: template.id,
      textLimits: {
        eyebrow: 80,
        headline: 180,
        body: 500,
        cardHeadline: 180,
        cardBody: 400,
      },
    });
  }
  return [...byId.values()];
};

const storyboardIssue = (
  issue: StoryboardContractIssue,
): PresentationDeckGenerationIssue => ({
  code: "INVALID_STORYBOARD",
  severity: "error",
  slideId: issue.slideId,
  target: issue.path,
  message: `${issue.path}: ${issue.message}`,
});

const validateDeck = (storyboard: unknown): StoryboardPresentation => {
  try {
    const presentation = validateStoryboardPresentation(
      storyboard,
      templateContracts(),
    );
    const orderedSlides = [...presentation.slides].sort(
      (left, right) => left.order - right.order,
    );
    const orderIssues = orderedSlides.flatMap((slide, index) =>
      slide.order === index + 1
        ? []
        : [
            {
              code: "NON_SEQUENTIAL_ORDER" as const,
              severity: "error" as const,
              slideId: slide.id,
              target: "order",
              message: `presentation order must be sequential; expected ${
                index + 1
              }, received ${slide.order}`,
            },
          ],
    );
    if (orderIssues.length > 0) {
      throw new PresentationDeckGenerationError(orderIssues);
    }
    return { ...presentation, slides: orderedSlides };
  } catch (error) {
    if (error instanceof StoryboardContractError) {
      throw new PresentationDeckGenerationError(
        error.issues.map(storyboardIssue),
      );
    }
    throw error;
  }
};

const defaultOrigin = (
  index: number,
  canvas: { width: number; height: number },
) => ({
  x: (index % 3) * (canvas.width + 160),
  y: Math.floor(index / 3) * (canvas.height + 160),
});

const stableElement = (
  element: NonDeletedExcalidrawElement,
): NonDeletedExcalidrawElement => ({
  ...element,
  seed: hashString(element.id) || 1,
  version: 1,
  versionNonce: hashString(`${element.id}:version`),
  updated: 0,
});

const sameFile = (left: BinaryFileData, right: BinaryFileData) =>
  left.mimeType === right.mimeType && left.dataURL === right.dataURL;

const sortedFiles = (files: BinaryFiles): BinaryFiles =>
  Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((fileId) => [fileId, files[fileId]]),
  );

const byteLength = (value: string) =>
  new TextEncoder().encode(value).byteLength;

const calculateSceneBounds = (
  elements: readonly NonDeletedExcalidrawElement[],
) => {
  const frames = elements.filter((element) => element.type === "frame");
  const minX = Math.min(...frames.map((frame) => frame.x));
  const minY = Math.min(...frames.map((frame) => frame.y));
  const maxX = Math.max(...frames.map((frame) => frame.x + frame.width));
  const maxY = Math.max(...frames.map((frame) => frame.y + frame.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const generatePresentationDeck = ({
  storyboard,
  assets = {},
  layout,
}: {
  storyboard: unknown;
  assets?: BinaryFiles;
  layout?: PresentationDeckLayout;
}): GeneratedPresentationDeck => {
  const presentation = validateDeck(storyboard);
  const elements: NonDeletedExcalidrawElement[] = [];
  const files: BinaryFiles = {};
  const issues: SlideRenderIssue[] = [];
  const elementIds = new Set<string>();

  presentation.slides.forEach((slide, index) => {
    const template = presentationTemplateRegistry.resolve({
      id: slide.templateId,
      version: slide.templateVersion,
    });
    const origin =
      layout?.origins[slide.id] ?? defaultOrigin(index, template.canvas);
    const rendered = renderPresentationSlide({
      presentation,
      slide,
      assets,
      origin,
    });
    issues.push(...rendered.issues);

    for (const element of rendered.elements.map(stableElement)) {
      if (elementIds.has(element.id)) {
        throw new PresentationDeckGenerationError([
          {
            code: "DUPLICATE_ELEMENT_ID",
            severity: "error",
            slideId: slide.id,
            target: element.id,
            message: `element ID "${element.id}" is duplicated`,
          },
        ]);
      }
      elementIds.add(element.id);
      elements.push(element);
    }

    for (const [fileId, file] of Object.entries(rendered.files)) {
      const existing = files[fileId];
      if (existing && !sameFile(existing, file)) {
        throw new PresentationDeckGenerationError([
          {
            code: "CONFLICTING_FILE_ID",
            severity: "error",
            slideId: slide.id,
            target: fileId,
            message: `file ID "${fileId}" resolves to conflicting binaries`,
          },
        ]);
      }
      files[fileId] = file;
    }
  });

  const fatalIssues = issues.filter((issue) => issue.severity === "error");
  if (fatalIssues.length > 0) {
    throw new PresentationDeckGenerationError(fatalIssues);
  }

  const orderedFiles = sortedFiles(files);
  const appState: Partial<AppState> = {
    viewBackgroundColor: "#ffffff",
    name: presentation.presentationId,
  };
  const scene: GeneratedPresentationScene = {
    type: "excalidraw",
    version: 2,
    source: "yaseendraw-presentation-generator",
    elements,
    appState,
    files: orderedFiles,
  };
  const portableJson = serializeAsJSON(
    scene.elements,
    scene.appState,
    scene.files,
    "local",
  );
  const cloudJson = serializeAsJSON(
    scene.elements,
    scene.appState,
    scene.files,
    "database",
  );
  const modeCounts: Record<PresentationRenderMode, number> = {
    image: 0,
    animation: 0,
    "full-native": 0,
  };
  presentation.slides.forEach((slide) => {
    modeCounts[slide.renderMode] += 1;
  });

  return {
    scene,
    portableJson,
    cloudJson,
    report: {
      presentationId: presentation.presentationId,
      slideCount: presentation.slides.length,
      frameCount: elements.filter((element) => element.type === "frame").length,
      elementCount: elements.length,
      modeCounts,
      fileCount: Object.keys(orderedFiles).length,
      warningCount: issues.length,
      warnings: issues,
      portableBytes: byteLength(portableJson),
      cloudBytes: byteLength(cloudJson),
      sourceCanvas: layout?.sourceCanvas,
      sceneBounds: calculateSceneBounds(elements),
    },
  };
};
