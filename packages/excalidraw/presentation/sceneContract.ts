export const PRESENTATION_SCENE_SCHEMA_VERSION = 1 as const;

export const PRESENTATION_RENDER_MODES = [
  "image",
  "animation",
  "full-native",
] as const;

export type PresentationRenderMode = typeof PRESENTATION_RENDER_MODES[number];

export type ImageVisualReference = {
  kind: "image";
  assetId: string;
};

export type AnimationVisualReference = {
  kind: "animation";
  source:
    | {
        kind: "embedded-html";
        html: string;
      }
    | {
        kind: "asset";
        assetId: string;
        version: number;
      };
  previewAssetId?: string;
};

export type NativeVisualReference = {
  kind: "native";
  sourceId: string;
};

export type StoryboardCard = {
  id: string;
  eyebrow?: string;
  headline: string;
  body: string;
};

type StoryboardSlideBase = {
  id: string;
  order: number;
  eyebrow: string;
  headline: string;
  body: string;
  cards: StoryboardCard[];
  templateId: string;
  templateVersion: string;
};

export type StoryboardSlide =
  | (StoryboardSlideBase & {
      renderMode: "image";
      visual: ImageVisualReference;
    })
  | (StoryboardSlideBase & {
      renderMode: "animation";
      visual: AnimationVisualReference;
    })
  | (StoryboardSlideBase & {
      renderMode: "full-native";
      visual: NativeVisualReference;
    });

export type StoryboardPresentation = {
  presentationId: string;
  generatorVersion: string;
  slides: StoryboardSlide[];
};

export type PresentationTemplateContract = {
  id: string;
  textLimits: {
    eyebrow: number;
    headline: number;
    body: number;
    cardHeadline: number;
    cardBody: number;
  };
};

export type StoryboardContractIssue = {
  slideId?: string;
  path: string;
  message: string;
};

export class StoryboardContractError extends Error {
  public readonly issues: readonly StoryboardContractIssue[];

  constructor(issues: readonly StoryboardContractIssue[]) {
    super(
      `Storyboard presentation is invalid:\n${issues
        .map(
          (issue) =>
            `- ${issue.slideId ? `[${issue.slideId}] ` : ""}${issue.path}: ${
              issue.message
            }`,
        )
        .join("\n")}`,
    );
    this.name = "StoryboardContractError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const addRequiredStringIssue = (
  issues: StoryboardContractIssue[],
  slideId: string | undefined,
  record: UnknownRecord,
  path: string,
) => {
  if (!nonEmptyString(record[path])) {
    issues.push({ slideId, path, message: `${path} is required` });
  }
};

const addTextLimitIssue = (
  issues: StoryboardContractIssue[],
  slideId: string,
  path: string,
  value: unknown,
  limit: number,
) => {
  if (typeof value === "string" && value.length > limit) {
    issues.push({
      slideId,
      path,
      message: `${path} exceeds the template limit of ${limit} characters`,
    });
  }
};

const validateVisual = (
  issues: StoryboardContractIssue[],
  slideId: string,
  renderMode: unknown,
  visual: unknown,
) => {
  if (!isRecord(visual)) {
    issues.push({
      slideId,
      path: "visual",
      message: "visual is required",
    });
    return;
  }

  if (renderMode === "image") {
    if (visual.kind !== "image") {
      issues.push({
        slideId,
        path: "visual.kind",
        message: "visual must be image for renderMode image",
      });
    } else if (!nonEmptyString(visual.assetId)) {
      issues.push({
        slideId,
        path: "visual.assetId",
        message: "image assetId is required",
      });
    }
    return;
  }

  if (renderMode === "animation") {
    if (visual.kind !== "animation") {
      issues.push({
        slideId,
        path: "visual.kind",
        message: "visual must be animation for renderMode animation",
      });
      return;
    }

    if (!isRecord(visual.source)) {
      issues.push({
        slideId,
        path: "visual.source",
        message: "animation source is required",
      });
    } else if (
      visual.source.kind === "embedded-html" &&
      !nonEmptyString(visual.source.html)
    ) {
      issues.push({
        slideId,
        path: "visual.source.html",
        message: "embedded animation HTML is required",
      });
    } else if (
      visual.source.kind === "asset" &&
      !nonEmptyString(visual.source.assetId)
    ) {
      issues.push({
        slideId,
        path: "visual.source.assetId",
        message: "animation assetId is required",
      });
    } else if (
      visual.source.kind === "asset" &&
      (!Number.isSafeInteger(visual.source.version) ||
        (visual.source.version as number) < 1)
    ) {
      issues.push({
        slideId,
        path: "visual.source.version",
        message: "animation asset version must be a positive integer",
      });
    } else if (
      visual.source.kind !== "embedded-html" &&
      visual.source.kind !== "asset"
    ) {
      issues.push({
        slideId,
        path: "visual.source.kind",
        message: "animation source must be embedded-html or asset",
      });
    }
    return;
  }

  if (renderMode === "full-native" && visual.kind !== "native") {
    issues.push({
      slideId,
      path: "visual.kind",
      message: "visual must be native for renderMode full-native",
    });
  } else if (renderMode === "full-native" && !nonEmptyString(visual.sourceId)) {
    issues.push({
      slideId,
      path: "visual.sourceId",
      message: "native sourceId is required",
    });
  }
};

export const validateStoryboardPresentation = (
  input: unknown,
  templates: readonly PresentationTemplateContract[],
): StoryboardPresentation => {
  const issues: StoryboardContractIssue[] = [];
  if (!isRecord(input)) {
    throw new StoryboardContractError([
      { path: "presentation", message: "presentation must be an object" },
    ]);
  }

  addRequiredStringIssue(issues, undefined, input, "presentationId");
  addRequiredStringIssue(issues, undefined, input, "generatorVersion");

  if (!Array.isArray(input.slides) || input.slides.length === 0) {
    issues.push({ path: "slides", message: "at least one slide is required" });
  } else {
    const templateById = new Map(
      templates.map((template) => [template.id, template]),
    );
    const slideIds = new Set<string>();
    const orders = new Set<number>();

    input.slides.forEach((slideValue, index) => {
      if (!isRecord(slideValue)) {
        issues.push({
          path: `slides.${index}`,
          message: "slide must be an object",
        });
        return;
      }

      const slideId = nonEmptyString(slideValue.id)
        ? slideValue.id
        : `slide at index ${index}`;
      addRequiredStringIssue(issues, slideId, slideValue, "id");
      addRequiredStringIssue(issues, slideId, slideValue, "eyebrow");
      addRequiredStringIssue(issues, slideId, slideValue, "headline");
      addRequiredStringIssue(issues, slideId, slideValue, "body");
      addRequiredStringIssue(issues, slideId, slideValue, "templateId");
      addRequiredStringIssue(issues, slideId, slideValue, "templateVersion");

      if (nonEmptyString(slideValue.id)) {
        if (slideIds.has(slideValue.id)) {
          issues.push({
            slideId,
            path: "id",
            message: `duplicate slide ID "${slideValue.id}"`,
          });
        }
        slideIds.add(slideValue.id);
      }

      if (
        typeof slideValue.order !== "number" ||
        !Number.isInteger(slideValue.order) ||
        slideValue.order < 1
      ) {
        issues.push({
          slideId,
          path: "order",
          message: "order must be a positive integer",
        });
      } else {
        if (orders.has(slideValue.order)) {
          issues.push({
            slideId,
            path: "order",
            message: `duplicate presentation order ${slideValue.order}`,
          });
        }
        orders.add(slideValue.order);
      }

      if (
        !PRESENTATION_RENDER_MODES.includes(
          slideValue.renderMode as PresentationRenderMode,
        )
      ) {
        issues.push({
          slideId,
          path: "renderMode",
          message: `renderMode "${String(
            slideValue.renderMode,
          )}" is unsupported; use image, animation, or full-native`,
        });
      } else {
        validateVisual(
          issues,
          slideId,
          slideValue.renderMode,
          slideValue.visual,
        );
      }

      const template = nonEmptyString(slideValue.templateId)
        ? templateById.get(slideValue.templateId)
        : undefined;
      if (nonEmptyString(slideValue.templateId) && !template) {
        issues.push({
          slideId,
          path: "templateId",
          message: `template "${slideValue.templateId}" is not registered`,
        });
      }

      if (!Array.isArray(slideValue.cards)) {
        issues.push({
          slideId,
          path: "cards",
          message: "cards must be an array",
        });
      } else {
        slideValue.cards.forEach((cardValue, cardIndex) => {
          if (!isRecord(cardValue)) {
            issues.push({
              slideId,
              path: `cards.${cardIndex}`,
              message: "card must be an object",
            });
            return;
          }
          if (!nonEmptyString(cardValue.id)) {
            issues.push({
              slideId,
              path: `cards.${cardIndex}.id`,
              message: "card id is required",
            });
          }
          if (!nonEmptyString(cardValue.headline)) {
            issues.push({
              slideId,
              path: `cards.${cardIndex}.headline`,
              message: "card headline is required",
            });
          }
          if (!nonEmptyString(cardValue.body)) {
            issues.push({
              slideId,
              path: `cards.${cardIndex}.body`,
              message: "card body is required",
            });
          }
          if (template) {
            addTextLimitIssue(
              issues,
              slideId,
              `cards.${cardIndex}.headline`,
              cardValue.headline,
              template.textLimits.cardHeadline,
            );
            addTextLimitIssue(
              issues,
              slideId,
              `cards.${cardIndex}.body`,
              cardValue.body,
              template.textLimits.cardBody,
            );
          }
        });
      }

      if (template) {
        addTextLimitIssue(
          issues,
          slideId,
          "eyebrow",
          slideValue.eyebrow,
          template.textLimits.eyebrow,
        );
        addTextLimitIssue(
          issues,
          slideId,
          "headline",
          slideValue.headline,
          template.textLimits.headline,
        );
        addTextLimitIssue(
          issues,
          slideId,
          "body",
          slideValue.body,
          template.textLimits.body,
        );
      }
    });
  }

  if (issues.length > 0) {
    throw new StoryboardContractError(issues);
  }

  return input as StoryboardPresentation;
};

export type PresentationChildRole =
  | "template-background"
  | "eyebrow"
  | "headline"
  | "body"
  | "card"
  | "static-visual"
  | "animation-preview"
  | "animated-visual"
  | "native-visual";

export type PresentationFrameMetadata = {
  kind: "slide-frame";
  schemaVersion: typeof PRESENTATION_SCENE_SCHEMA_VERSION;
  generatorVersion: string;
  presentationId: string;
  slideId: string;
  presentationOrder: number;
  templateId: string;
  templateVersion: string;
  renderMode: PresentationRenderMode;
};

export type PresentationChildMetadata = {
  kind: "slide-child";
  schemaVersion: typeof PRESENTATION_SCENE_SCHEMA_VERSION;
  slideId: string;
  role: PresentationChildRole;
  slotId?: string;
};

const childMetadata = (
  slideId: string,
  role: PresentationChildRole,
  slotId?: string,
): PresentationChildMetadata => ({
  kind: "slide-child",
  schemaVersion: PRESENTATION_SCENE_SCHEMA_VERSION,
  slideId,
  role,
  ...(slotId ? { slotId } : null),
});

export const mapSlideToSceneMetadata = (
  presentation: StoryboardPresentation,
  slide: StoryboardSlide,
) => {
  const frame: PresentationFrameMetadata = {
    kind: "slide-frame",
    schemaVersion: PRESENTATION_SCENE_SCHEMA_VERSION,
    generatorVersion: presentation.generatorVersion,
    presentationId: presentation.presentationId,
    slideId: slide.id,
    presentationOrder: slide.order,
    templateId: slide.templateId,
    templateVersion: slide.templateVersion,
    renderMode: slide.renderMode,
  };

  return {
    frame,
    children: {
      templateBackground: childMetadata(slide.id, "template-background"),
      eyebrow: childMetadata(slide.id, "eyebrow"),
      headline: childMetadata(slide.id, "headline"),
      body: childMetadata(slide.id, "body"),
      cards: (slotId: string) => childMetadata(slide.id, "card", slotId),
      staticVisual: childMetadata(slide.id, "static-visual"),
      animationPreview: childMetadata(slide.id, "animation-preview"),
      animatedVisual: childMetadata(slide.id, "animated-visual"),
      nativeVisual: childMetadata(slide.id, "native-visual"),
    },
  };
};

export const createPresentationElementId = ({
  presentationId,
  slideId,
  role,
  slotId = "",
}: {
  presentationId: string;
  slideId: string;
  role: PresentationChildRole | "frame";
  slotId?: string;
}) => {
  const source = `${presentationId}|${slideId}|${role}|${slotId}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `yp_${(hash >>> 0).toString(36)}`;
};
