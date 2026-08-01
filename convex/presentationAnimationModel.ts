import { v } from "convex/values";

export const PRESENTATION_ANIMATION_MIME_TYPE = "text/html" as const;
export const MAX_PRESENTATION_ANIMATION_BYTES = 10 * 1024 * 1024;
export const PRESENTATION_ANIMATION_GRANT_LIFETIME_MS = 10 * 60 * 1000;
export const PRESENTATION_ANIMATION_READ_GRANT_LIFETIME_MS = 5 * 60 * 1000;

export const presentationAnimationReferenceValidator = v.object({
  assetId: v.string(),
  version: v.number(),
  mimeType: v.literal(PRESENTATION_ANIMATION_MIME_TYPE),
  size: v.number(),
  sha256: v.string(),
  etag: v.string(),
  sourceElementId: v.string(),
  slideId: v.string(),
  previewFileId: v.optional(v.string()),
});

export const presentationAnimationUploadResultValidator = v.union(
  v.object({
    kind: v.literal("upload"),
    token: v.string(),
    assetId: v.string(),
    version: v.number(),
  }),
  v.object({
    kind: v.literal("registered"),
    asset: presentationAnimationReferenceValidator,
  }),
);

export const makePresentationAnimationToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

export const assertPresentationAnimationIdentity = (
  label: string,
  value: string,
) => {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new Error(`Invalid presentation animation ${label}`);
  }
};

export const assertPresentationAnimationManifest = (manifest: {
  assetId: string;
  version: number;
  sourceElementId: string;
  slideId: string;
  mimeType: string;
  size: number;
  sha256: string;
  previewFileId?: string;
  replacementForVersion?: number;
}) => {
  assertPresentationAnimationIdentity("asset ID", manifest.assetId);
  assertPresentationAnimationIdentity(
    "source element ID",
    manifest.sourceElementId,
  );
  assertPresentationAnimationIdentity("slide ID", manifest.slideId);
  if (manifest.previewFileId) {
    assertPresentationAnimationIdentity(
      "preview file ID",
      manifest.previewFileId,
    );
  }
  if (
    !Number.isSafeInteger(manifest.version) ||
    manifest.version < 1 ||
    (manifest.replacementForVersion !== undefined &&
      (!Number.isSafeInteger(manifest.replacementForVersion) ||
        manifest.replacementForVersion < 1 ||
        manifest.replacementForVersion >= manifest.version))
  ) {
    throw new Error("Invalid presentation animation version");
  }
  if (
    manifest.mimeType !== PRESENTATION_ANIMATION_MIME_TYPE ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size < 1 ||
    manifest.size > MAX_PRESENTATION_ANIMATION_BYTES
  ) {
    throw new Error(
      "Presentation animations must be text/html and no larger than 10 MB",
    );
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error("Presentation animation SHA-256 is invalid");
  }
};

export const toPresentationAnimationReference = (asset: {
  assetId: string;
  version: number;
  mimeType: string;
  size: number;
  sha256: string;
  etag: string;
  sourceElementId: string;
  slideId: string;
  previewFileId?: string;
}) => ({
  assetId: asset.assetId,
  version: asset.version,
  mimeType: PRESENTATION_ANIMATION_MIME_TYPE,
  size: asset.size,
  sha256: asset.sha256,
  etag: asset.etag,
  sourceElementId: asset.sourceElementId,
  slideId: asset.slideId,
  ...(asset.previewFileId ? { previewFileId: asset.previewFileId } : null),
});
