import type { PresentationRenderMode } from "./sceneContract";

export type PresentationTemplateReference = {
  id: string;
  version: string;
};

export type PresentationTemplateBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PresentationTemplateSlotRole =
  | "template-background"
  | "eyebrow"
  | "headline"
  | "body"
  | "card"
  | "static-visual"
  | "animated-visual";

type PresentationTemplateSlotBase = {
  id: string;
  role: PresentationTemplateSlotRole;
  bounds: PresentationTemplateBounds;
  zIndex: number;
};

export type PresentationTextSlot = PresentationTemplateSlotBase & {
  kind: "text";
  alignment: "left" | "center" | "right";
  verticalAlignment: "top" | "middle" | "bottom";
  font: {
    family: "inter" | "ibm-plex-mono";
    size: number;
    weight: "normal" | "bold";
    lineHeight: number;
  };
  maxLines: number;
  overflow: "warn" | "error";
};

export type PresentationVisualSlot = PresentationTemplateSlotBase & {
  kind: "visual";
  accepts: readonly ("image" | "animation")[];
  fit: "cover" | "contain";
  borderRadius: number;
};

export type PresentationPlateSlot = PresentationTemplateSlotBase & {
  kind: "plate";
  locked: true;
};

export type PresentationTemplateSlot =
  | PresentationTextSlot
  | PresentationVisualSlot
  | PresentationPlateSlot;

export type PresentationTemplateDefinition = {
  id: string;
  version: string;
  canvas: {
    width: number;
    height: number;
  };
  supportedRenderModes: readonly PresentationRenderMode[];
  plate: {
    kind: "svg";
    assetId: string;
    mimeType: "image/svg+xml";
    svg: string;
  };
  slots: Record<string, PresentationTemplateSlot>;
};

export type PresentationTemplateRegistryErrorCode =
  | "INVALID_TEMPLATE"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_VERSION_UNAVAILABLE";

export class PresentationTemplateRegistryError extends Error {
  public readonly code: PresentationTemplateRegistryErrorCode;
  public readonly availableVersions?: readonly string[];

  constructor({
    code,
    message,
    availableVersions,
  }: {
    code: PresentationTemplateRegistryErrorCode;
    message: string;
    availableVersions?: readonly string[];
  }) {
    super(message);
    this.name = "PresentationTemplateRegistryError";
    this.code = code;
    this.availableVersions = availableVersions;
  }
}

const ALLOWED_SLOT_ROLES = new Set<PresentationTemplateSlotRole>([
  "template-background",
  "eyebrow",
  "headline",
  "body",
  "card",
  "static-visual",
  "animated-visual",
]);

const templateKey = ({ id, version }: PresentationTemplateReference) =>
  `${id}@${version}`;

const invalidTemplate = (message: string): never => {
  throw new PresentationTemplateRegistryError({
    code: "INVALID_TEMPLATE",
    message,
  });
};

const validateBounds = (
  template: PresentationTemplateDefinition,
  slot: PresentationTemplateSlot,
) => {
  const { x, y, width, height } = slot.bounds;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0
  ) {
    invalidTemplate(`slot "${slot.id}" has invalid bounds`);
  }
  if (
    x + width > template.canvas.width ||
    y + height > template.canvas.height
  ) {
    invalidTemplate(
      `slot "${slot.id}" bounds exceed the ${template.canvas.width}×${template.canvas.height} canvas`,
    );
  }
};

const validateTemplate = (template: PresentationTemplateDefinition) => {
  if (!template.id.trim() || !template.version.trim()) {
    invalidTemplate("template id and version are required");
  }
  if (
    !Number.isFinite(template.canvas.width) ||
    !Number.isFinite(template.canvas.height) ||
    template.canvas.width <= 0 ||
    template.canvas.height <= 0
  ) {
    invalidTemplate(`${templateKey(template)} has invalid canvas dimensions`);
  }
  if (
    template.plate.kind !== "svg" ||
    template.plate.mimeType !== "image/svg+xml" ||
    !template.plate.assetId.trim() ||
    !template.plate.svg.trim().startsWith("<svg")
  ) {
    invalidTemplate(`${templateKey(template)} must define one SVG plate asset`);
  }

  for (const [slotId, slot] of Object.entries(template.slots)) {
    if (slot.id !== slotId) {
      invalidTemplate(
        `slot key "${slotId}" does not match declared id "${slot.id}"`,
      );
    }
    if (!ALLOWED_SLOT_ROLES.has(slot.role)) {
      invalidTemplate(`slot "${slotId}" has unknown role "${slot.role}"`);
    }
    validateBounds(template, slot);

    if (slot.kind === "text") {
      if (
        slot.font.size <= 0 ||
        slot.font.lineHeight <= 0 ||
        !Number.isInteger(slot.maxLines) ||
        slot.maxLines < 1
      ) {
        invalidTemplate(`text slot "${slotId}" has invalid typography`);
      }
    } else if (slot.kind === "visual" && slot.accepts.length === 0) {
      invalidTemplate(`visual slot "${slotId}" must accept at least one mode`);
    }
  }

  for (const requiredSlot of [
    "template-background",
    "eyebrow",
    "headline",
    "body",
    "static-visual",
    "animated-visual",
  ]) {
    if (!template.slots[requiredSlot]) {
      invalidTemplate(
        `${templateKey(template)} is missing required slot "${requiredSlot}"`,
      );
    }
  }
};

export const createPresentationTemplateRegistry = (
  templates: readonly PresentationTemplateDefinition[],
) => {
  const byKey = new Map<string, PresentationTemplateDefinition>();
  const versionsById = new Map<string, string[]>();

  for (const template of templates) {
    validateTemplate(template);
    const key = templateKey(template);
    if (byKey.has(key)) {
      invalidTemplate(`duplicate template ${key}`);
    }
    byKey.set(key, template);
    const versions = versionsById.get(template.id) ?? [];
    versions.push(template.version);
    versions.sort((left, right) =>
      left.localeCompare(right, undefined, {
        numeric: true,
      }),
    );
    versionsById.set(template.id, versions);
  }

  return {
    resolve(reference: PresentationTemplateReference) {
      const template = byKey.get(templateKey(reference));
      if (template) {
        return template;
      }

      const availableVersions = versionsById.get(reference.id);
      if (!availableVersions) {
        throw new PresentationTemplateRegistryError({
          code: "TEMPLATE_NOT_FOUND",
          message: `template "${reference.id}" is not registered`,
        });
      }

      throw new PresentationTemplateRegistryError({
        code: "TEMPLATE_VERSION_UNAVAILABLE",
        message: `template ${templateKey(
          reference,
        )} is unavailable; registered versions: ${availableVersions.join(
          ", ",
        )}`,
        availableVersions,
      });
    },
    list() {
      return [...byKey.values()];
    },
  };
};

const FOUNDATIONS_OF_AI_PLATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <pattern id="grid" width="38" height="38" patternUnits="userSpaceOnUse">
      <path d="M 38 0 L 0 0 0 38" fill="none" stroke="#0f5843" stroke-opacity=".045" stroke-width="1"/>
    </pattern>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f5843"/>
      <stop offset=".58" stop-color="#11785a"/>
      <stop offset="1" stop-color="#19c37d"/>
    </linearGradient>
    <radialGradient id="glow" cx="86%" cy="8%" r="90%">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".34"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0f5843" flood-opacity=".12"/>
    </filter>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="9" stdDeviation="12" flood-color="#14251f" flood-opacity=".06"/>
    </filter>
  </defs>
  <rect width="1280" height="720" fill="#f8f7f3"/>
  <rect width="1280" height="720" fill="url(#grid)"/>
  <circle cx="1190" cy="-42" r="190" fill="#19c37d" opacity=".055"/>
  <circle cx="-38" cy="712" r="150" fill="#0f5843" opacity=".04"/>
  <rect x="62" y="48" width="5" height="35" rx="2.5" fill="#19c37d"/>
  <g filter="url(#shadow)">
    <rect x="621" y="50" width="607" height="344" rx="28" fill="#ffffff"/>
  </g>
  <rect x="621" y="50" width="607" height="344" rx="28" fill="#ffffff" stroke="#0f5843" stroke-width="3"/>
  <g filter="url(#cardShadow)">
    <rect x="62" y="438" width="356" height="206" rx="22" fill="#ffffff" stroke="#d8ded9"/>
    <rect x="440" y="438" width="356" height="206" rx="22" fill="url(#card)"/>
    <rect x="440" y="438" width="356" height="206" rx="22" fill="url(#glow)"/>
    <rect x="440" y="438" width="356" height="206" rx="22" fill="none" stroke="#ffffff" stroke-opacity=".36"/>
    <rect x="818" y="438" width="400" height="206" rx="22" fill="#ffffff" stroke="#d8ded9"/>
  </g>
  <circle cx="390" cy="470" r="4" fill="#19c37d"/>
  <circle cx="768" cy="470" r="4" fill="#ffffff" opacity=".72"/>
  <circle cx="1188" cy="470" r="4" fill="#19c37d"/>
  <path d="M62 676H1218" stroke="#0f5843" stroke-opacity=".1"/>
  <text x="62" y="699" fill="#0f5843" fill-opacity=".45" font-family="IBM Plex Mono, monospace" font-size="10" font-weight="700" letter-spacing="1.7">FOUNDATIONS OF AI · YASEENDRAW</text>
</svg>`;

const textSlot = ({
  id,
  role,
  bounds,
  family = "inter",
  size,
  weight = "normal",
  lineHeight,
  maxLines,
  overflow = "warn",
}: {
  id: string;
  role: Extract<
    PresentationTemplateSlotRole,
    "eyebrow" | "headline" | "body" | "card"
  >;
  bounds: PresentationTemplateBounds;
  family?: PresentationTextSlot["font"]["family"];
  size: number;
  weight?: PresentationTextSlot["font"]["weight"];
  lineHeight: number;
  maxLines: number;
  overflow?: PresentationTextSlot["overflow"];
}): PresentationTextSlot => ({
  id,
  kind: "text",
  role,
  bounds,
  zIndex: 20,
  alignment: "left",
  verticalAlignment: "top",
  font: { family, size, weight, lineHeight },
  maxLines,
  overflow,
});

const visualBounds: PresentationTemplateBounds = {
  x: 630,
  y: 59,
  width: 590,
  height: 332,
};

export const FOUNDATIONS_OF_AI_TEMPLATE: PresentationTemplateDefinition = {
  id: "foundations-editorial",
  version: "1.0.0",
  canvas: { width: 1280, height: 720 },
  supportedRenderModes: ["image", "animation", "full-native"],
  plate: {
    kind: "svg",
    assetId: "template-foundations-editorial-v1",
    mimeType: "image/svg+xml",
    svg: FOUNDATIONS_OF_AI_PLATE_SVG,
  },
  slots: {
    "template-background": {
      id: "template-background",
      kind: "plate",
      role: "template-background",
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
      zIndex: 0,
      locked: true,
    },
    eyebrow: textSlot({
      id: "eyebrow",
      role: "eyebrow",
      bounds: { x: 78, y: 55, width: 485, height: 28 },
      family: "ibm-plex-mono",
      size: 18,
      weight: "bold",
      lineHeight: 1.25,
      maxLines: 1,
      overflow: "error",
    }),
    headline: textSlot({
      id: "headline",
      role: "headline",
      bounds: { x: 62, y: 108, width: 515, height: 142 },
      size: 56,
      weight: "bold",
      lineHeight: 1.02,
      maxLines: 2,
    }),
    body: textSlot({
      id: "body",
      role: "body",
      bounds: { x: 62, y: 276, width: 500, height: 116 },
      size: 22,
      lineHeight: 1.38,
      maxLines: 4,
    }),
    "static-visual": {
      id: "static-visual",
      kind: "visual",
      role: "static-visual",
      bounds: visualBounds,
      zIndex: 10,
      accepts: ["image"],
      fit: "cover",
      borderRadius: 24,
    },
    "animated-visual": {
      id: "animated-visual",
      kind: "visual",
      role: "animated-visual",
      bounds: { ...visualBounds },
      zIndex: 10,
      accepts: ["animation"],
      fit: "cover",
      borderRadius: 24,
    },
    "card-1": textSlot({
      id: "card-1",
      role: "card",
      bounds: { x: 86, y: 464, width: 326, height: 160 },
      size: 21,
      lineHeight: 1.23,
      maxLines: 6,
    }),
    "card-2": textSlot({
      id: "card-2",
      role: "card",
      bounds: { x: 464, y: 464, width: 326, height: 160 },
      size: 21,
      lineHeight: 1.23,
      maxLines: 6,
    }),
    "card-3": textSlot({
      id: "card-3",
      role: "card",
      bounds: { x: 842, y: 464, width: 352, height: 160 },
      size: 21,
      lineHeight: 1.23,
      maxLines: 6,
    }),
  },
};

export const FOUNDATIONS_OF_AI_DENSE_TEMPLATE: PresentationTemplateDefinition =
  {
    ...FOUNDATIONS_OF_AI_TEMPLATE,
    id: "foundations-editorial-dense",
    plate: FOUNDATIONS_OF_AI_TEMPLATE.plate,
    slots: {
      ...FOUNDATIONS_OF_AI_TEMPLATE.slots,
      "card-1": textSlot({
        id: "card-1",
        role: "card",
        bounds: { x: 86, y: 452, width: 326, height: 84 },
        size: 15,
        lineHeight: 1.12,
        maxLines: 5,
      }),
      "card-2": textSlot({
        id: "card-2",
        role: "card",
        bounds: { x: 86, y: 548, width: 326, height: 84 },
        size: 15,
        lineHeight: 1.12,
        maxLines: 5,
      }),
      "card-3": textSlot({
        id: "card-3",
        role: "card",
        bounds: { x: 464, y: 452, width: 326, height: 84 },
        size: 15,
        lineHeight: 1.12,
        maxLines: 5,
      }),
      "card-4": textSlot({
        id: "card-4",
        role: "card",
        bounds: { x: 464, y: 548, width: 326, height: 84 },
        size: 15,
        lineHeight: 1.12,
        maxLines: 5,
      }),
      "card-5": textSlot({
        id: "card-5",
        role: "card",
        bounds: { x: 842, y: 464, width: 352, height: 160 },
        size: 19,
        lineHeight: 1.18,
        maxLines: 7,
      }),
    },
  };

export const presentationTemplateRegistry = createPresentationTemplateRegistry([
  FOUNDATIONS_OF_AI_TEMPLATE,
  FOUNDATIONS_OF_AI_DENSE_TEMPLATE,
]);
