import { getAuthUserId } from "@convex-dev/auth/server";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import {
  MAX_SAVED_COMPONENT_BYTES,
  MAX_SAVED_COMPONENT_NAME_LENGTH,
  SAVED_COMPONENT_SCHEMA_VERSION,
  UNSUPPORTED_SAVED_COMPONENT_ELEMENT_TYPES,
} from "../packages/common/src/savedComponents";

import { createAssetDeleteGrant } from "./assetDeletePersistence";
import { mutation, query } from "./_generated/server";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { PaginationOptions } from "convex/server";

const componentPreviewValidator = v.object({
  mimeType: v.string(),
  size: v.number(),
  width: v.number(),
  height: v.number(),
  url: v.string(),
});

const savedComponentValidator = v.object({
  _id: v.id("savedComponents"),
  _creationTime: v.number(),
  name: v.string(),
  normalizedName: v.string(),
  elementsJson: v.string(),
  elementCount: v.number(),
  schemaVersion: v.number(),
  preview: v.optional(componentPreviewValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const componentMutationResultValidator = v.object({
  componentId: v.id("savedComponents"),
  updatedAt: v.optional(v.number()),
  assetDeleteToken: v.optional(v.union(v.string(), v.null())),
});

const MAX_COMPONENT_ASSETS = 50;
const MAX_COMPONENT_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_COMPONENT_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_COMPONENT_PREVIEW_WIDTH = 800;
const MAX_COMPONENT_PREVIEW_HEIGHT = 600;
const UPLOAD_GRANT_LIFETIME_MS = 10 * 60 * 1000;
const ABANDONED_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

const makeToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

const extensionForMimeType = (mimeType: string) => {
  const extensions: Record<string, string> = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
  };
  return extensions[mimeType] ?? "bin";
};

const requireUserId = async (ctx: QueryCtx | MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
};

export const normalizeComponentName = (name: string) =>
  name.trim().replace(/\s+/g, " ");

const validateName = (name: string) => {
  const normalized = normalizeComponentName(name);
  if (!normalized) {
    throw new Error("Component name is required");
  }
  if (normalized.length > MAX_SAVED_COMPONENT_NAME_LENGTH) {
    throw new Error(
      `Component names must be ${MAX_SAVED_COMPONENT_NAME_LENGTH} characters or fewer`,
    );
  }
  return {
    name: normalized,
    normalizedName: normalized.toLocaleLowerCase("en-US"),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const validateElementsJson = ({
  elementsJson,
  elementCount,
  schemaVersion,
  allowImages = false,
}: {
  elementsJson: string;
  elementCount: number;
  schemaVersion: number;
  allowImages?: boolean;
}) => {
  const payloadBytes = new TextEncoder().encode(elementsJson).byteLength;
  if (payloadBytes > MAX_SAVED_COMPONENT_BYTES) {
    throw new Error(
      `Component payloads must be ${MAX_SAVED_COMPONENT_BYTES.toLocaleString(
        "en-US",
      )} bytes or smaller`,
    );
  }
  if (
    !Number.isInteger(schemaVersion) ||
    schemaVersion !== SAVED_COMPONENT_SCHEMA_VERSION
  ) {
    throw new Error(`Unsupported component schema version: ${schemaVersion}`);
  }
  if (!Number.isInteger(elementCount) || elementCount < 0) {
    throw new Error("Component element count must be a non-negative integer");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(elementsJson);
  } catch {
    throw new Error("Provide valid component JSON");
  }
  if (
    !isRecord(parsed) ||
    parsed.type !== "growprofit/saved-component" ||
    parsed.schemaVersion !== SAVED_COMPONENT_SCHEMA_VERSION ||
    !Array.isArray(parsed.elements)
  ) {
    throw new Error("Provide a valid canonical component JSON envelope");
  }
  if (parsed.elements.length === 0) {
    throw new Error("A saved component must contain at least one element");
  }
  if (parsed.elements.length !== elementCount) {
    throw new Error("Component element count does not match its payload");
  }

  const referencedFileIds = new Set<string>();
  for (const element of parsed.elements) {
    if (!isRecord(element) || typeof element.type !== "string") {
      throw new Error("Every saved component element must have a valid type");
    }
    if (
      (UNSUPPORTED_SAVED_COMPONENT_ELEMENT_TYPES as readonly string[]).includes(
        element.type,
      ) &&
      !(allowImages && element.type === "image")
    ) {
      throw new Error(
        `Saved components do not yet support ${element.type} elements`,
      );
    }
    if (element.type === "image") {
      if (typeof element.fileId !== "string" || !element.fileId.trim()) {
        throw new Error("Every saved component image must reference a file");
      }
      referencedFileIds.add(element.fileId);
    }
  }
  if (referencedFileIds.size > MAX_COMPONENT_ASSETS) {
    throw new Error(
      `Saved components support at most ${MAX_COMPONENT_ASSETS} image assets`,
    );
  }
  return referencedFileIds;
};

const toClientComponent = ({
  ownerId: _ownerId,
  status: _status,
  previewObjectKey,
  previewMimeType,
  previewSize,
  previewEtag: _previewEtag,
  previewWidth,
  previewHeight,
  previewUploadToken: _previewUploadToken,
  readyAt: _readyAt,
  ...component
}: Doc<"savedComponents">) => ({
  ...component,
  ...(previewObjectKey &&
  previewMimeType &&
  previewSize !== undefined &&
  previewWidth !== undefined &&
  previewHeight !== undefined
    ? {
        preview: {
          mimeType: previewMimeType,
          size: previewSize,
          width: previewWidth,
          height: previewHeight,
          url: `/api/assets/${previewObjectKey}`,
        },
      }
    : {}),
});

const isReadyComponent = (component: Doc<"savedComponents">) =>
  component.status !== "draft";

const paginateOwnedComponents = async (
  ctx: QueryCtx,
  ownerId: Id<"users">,
  paginationOpts: PaginationOptions,
) => {
  const result = await ctx.db
    .query("savedComponents")
    .withIndex("by_ownerId_and_status_and_updatedAt", (q) =>
      q.eq("ownerId", ownerId).eq("status", undefined),
    )
    .order("desc")
    .paginate(paginationOpts);
  return {
    ...result,
    page: result.page.filter(isReadyComponent).map(toClientComponent),
  };
};

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(savedComponentValidator),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    return await paginateOwnedComponents(ctx, ownerId, args.paginationOpts);
  },
});

export const search = query({
  args: {
    query: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(savedComponentValidator),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const normalizedQuery = normalizeComponentName(
      args.query,
    ).toLocaleLowerCase("en-US");
    if (!normalizedQuery) {
      return await paginateOwnedComponents(ctx, ownerId, args.paginationOpts);
    }

    const result = await ctx.db
      .query("savedComponents")
      .withSearchIndex("search_normalizedName", (q) =>
        q
          .search("normalizedName", normalizedQuery)
          .eq("ownerId", ownerId)
          .eq("status", undefined),
      )
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.filter(isReadyComponent).map(toClientComponent),
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    elementsJson: v.string(),
    elementCount: v.number(),
    schemaVersion: v.number(),
  },
  returns: componentMutationResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const name = validateName(args.name);
    validateElementsJson(args);
    const now = Date.now();
    const componentId = await ctx.db.insert("savedComponents", {
      ownerId,
      ...name,
      elementsJson: args.elementsJson,
      elementCount: args.elementCount,
      schemaVersion: args.schemaVersion,
      readyAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { componentId, updatedAt: now };
  },
});

const getOwnedComponent = async (
  ctx: MutationCtx | QueryCtx,
  componentId: Id<"savedComponents">,
  ownerId: Id<"users">,
) => {
  const component = await ctx.db.get("savedComponents", componentId);
  if (!component || component.ownerId !== ownerId) {
    throw new Error("Saved component not found");
  }
  return component;
};

const requireDraft = (component: Doc<"savedComponents">) => {
  if (component.status !== "draft") {
    throw new Error("Saved component is no longer a draft");
  }
};

const validateImageMetadata = (mimeType: string, size: number) => {
  if (
    !mimeType.startsWith("image/") ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_COMPONENT_ASSET_BYTES
  ) {
    throw new Error("Component assets must be images under 50 MB");
  }
};

export const createDraft = mutation({
  args: {
    name: v.string(),
    elementsJson: v.string(),
    elementCount: v.number(),
    schemaVersion: v.number(),
  },
  returns: componentMutationResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const name = validateName(args.name);
    const referencedFileIds = validateElementsJson({
      ...args,
      allowImages: true,
    });
    if (referencedFileIds.size === 0) {
      throw new Error("Image component drafts must reference an image");
    }
    const now = Date.now();
    const componentId = await ctx.db.insert("savedComponents", {
      ownerId,
      ...name,
      elementsJson: args.elementsJson,
      elementCount: args.elementCount,
      schemaVersion: args.schemaVersion,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    return { componentId, updatedAt: now };
  },
});

export const createAssetUploadGrant = mutation({
  args: {
    componentId: v.id("savedComponents"),
    fileId: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const component = await getOwnedComponent(ctx, args.componentId, ownerId);
    requireDraft(component);
    validateImageMetadata(args.mimeType, args.size);
    if (!args.fileId.trim() || args.fileId.length > 256) {
      throw new Error("Component image file ID is invalid");
    }
    const referencedFileIds = validateElementsJson({
      elementsJson: component.elementsJson,
      elementCount: component.elementCount,
      schemaVersion: component.schemaVersion,
      allowImages: true,
    });
    if (!referencedFileIds.has(args.fileId)) {
      throw new Error("The image file is not referenced by this component");
    }
    const existing = await ctx.db
      .query("savedComponentAssets")
      .withIndex("by_componentId_and_fileId", (q) =>
        q.eq("componentId", component._id).eq("fileId", args.fileId),
      )
      .unique();
    if (existing) {
      throw new Error("This component image is already registered");
    }
    const token = makeToken();
    const now = Date.now();
    await ctx.db.insert("savedComponentUploadGrants", {
      token,
      componentId: component._id,
      ownerId,
      purpose: "componentAsset",
      fileId: args.fileId,
      objectKey: `components/${
        component._id
      }/assets/${makeToken()}.${extensionForMimeType(args.mimeType)}`,
      mimeType: args.mimeType,
      size: args.size,
      createdAt: now,
      expiresAt: now + UPLOAD_GRANT_LIFETIME_MS,
    });
    return { token };
  },
});

export const createPreviewUploadGrant = mutation({
  args: {
    componentId: v.id("savedComponents"),
    mimeType: v.string(),
    size: v.number(),
    width: v.number(),
    height: v.number(),
  },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const component = await getOwnedComponent(ctx, args.componentId, ownerId);
    requireDraft(component);
    if (component.previewObjectKey) {
      throw new Error("This component preview is already registered");
    }
    if (
      args.mimeType !== "image/webp" ||
      !Number.isSafeInteger(args.size) ||
      args.size <= 0 ||
      args.size > MAX_COMPONENT_PREVIEW_BYTES
    ) {
      throw new Error("Component previews must be WebP images under 2 MB");
    }
    if (
      !Number.isSafeInteger(args.width) ||
      !Number.isSafeInteger(args.height) ||
      args.width <= 0 ||
      args.height <= 0 ||
      args.width > MAX_COMPONENT_PREVIEW_WIDTH ||
      args.height > MAX_COMPONENT_PREVIEW_HEIGHT
    ) {
      throw new Error("Component preview dimensions exceed 800×600");
    }
    const token = makeToken();
    const now = Date.now();
    await ctx.db.insert("savedComponentUploadGrants", {
      token,
      componentId: component._id,
      ownerId,
      purpose: "componentPreview",
      objectKey: `components/${component._id}/previews/${makeToken()}.webp`,
      mimeType: args.mimeType,
      size: args.size,
      previewWidth: args.width,
      previewHeight: args.height,
      createdAt: now,
      expiresAt: now + UPLOAD_GRANT_LIFETIME_MS,
    });
    return { token };
  },
});

const validateEtag = (etag: string) => {
  if (!etag.trim() || etag.length > 200) {
    throw new Error("Upload ETag is invalid");
  }
};

export const registerAssetUpload = mutation({
  args: { token: v.string(), etag: v.string() },
  returns: v.object({ status: v.literal("registered") }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    validateEtag(args.etag);
    const grant = await ctx.db
      .query("savedComponentUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!grant) {
      const registered = await ctx.db
        .query("savedComponentAssets")
        .withIndex("by_uploadToken", (q) => q.eq("uploadToken", args.token))
        .unique();
      if (registered) {
        const component = await getOwnedComponent(
          ctx,
          registered.componentId,
          ownerId,
        );
        void component;
        return { status: "registered" as const };
      }
      throw new Error("Component upload grant expired");
    }
    if (grant.ownerId !== ownerId || grant.expiresAt < Date.now()) {
      throw new Error("Component upload grant expired");
    }
    if (grant.purpose !== "componentAsset" || !grant.fileId) {
      throw new Error("A component asset grant is required");
    }
    const component = await getOwnedComponent(ctx, grant.componentId, ownerId);
    requireDraft(component);
    const referencedFileIds = validateElementsJson({
      elementsJson: component.elementsJson,
      elementCount: component.elementCount,
      schemaVersion: component.schemaVersion,
      allowImages: true,
    });
    if (!referencedFileIds.has(grant.fileId)) {
      throw new Error("The image file is not referenced by this component");
    }
    const existing = await ctx.db
      .query("savedComponentAssets")
      .withIndex("by_componentId_and_fileId", (q) =>
        q.eq("componentId", component._id).eq("fileId", grant.fileId!),
      )
      .unique();
    if (existing && existing.uploadToken !== grant.token) {
      throw new Error("A different upload already registered this image");
    }
    if (!existing) {
      const now = Date.now();
      await ctx.db.insert("savedComponentAssets", {
        componentId: component._id,
        fileId: grant.fileId,
        objectKey: grant.objectKey,
        mimeType: grant.mimeType,
        size: grant.size,
        etag: args.etag,
        uploadToken: grant.token,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.delete("savedComponentUploadGrants", grant._id);
    return { status: "registered" as const };
  },
});

export const registerPreviewUpload = mutation({
  args: { token: v.string(), etag: v.string() },
  returns: v.object({ status: v.literal("registered") }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    validateEtag(args.etag);
    const grant = await ctx.db
      .query("savedComponentUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!grant) {
      const component = await ctx.db
        .query("savedComponents")
        .withIndex("by_previewUploadToken", (q) =>
          q.eq("previewUploadToken", args.token),
        )
        .unique();
      if (component?.ownerId === ownerId) {
        return { status: "registered" as const };
      }
      throw new Error("Component upload grant expired");
    }
    if (grant.ownerId !== ownerId || grant.expiresAt < Date.now()) {
      throw new Error("Component upload grant expired");
    }
    if (
      grant.purpose !== "componentPreview" ||
      grant.previewWidth === undefined ||
      grant.previewHeight === undefined
    ) {
      throw new Error("A component preview grant is required");
    }
    const component = await getOwnedComponent(ctx, grant.componentId, ownerId);
    requireDraft(component);
    await ctx.db.patch("savedComponents", component._id, {
      previewObjectKey: grant.objectKey,
      previewMimeType: grant.mimeType,
      previewSize: grant.size,
      previewEtag: args.etag,
      previewWidth: grant.previewWidth,
      previewHeight: grant.previewHeight,
      previewUploadToken: grant.token,
    });
    await ctx.db.delete("savedComponentUploadGrants", grant._id);
    return { status: "registered" as const };
  },
});

export const finalizeDraft = mutation({
  args: { componentId: v.id("savedComponents") },
  returns: componentMutationResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const component = await getOwnedComponent(ctx, args.componentId, ownerId);
    if (component.status !== "draft") {
      return { componentId: component._id, updatedAt: component.updatedAt };
    }
    requireDraft(component);
    const referencedFileIds = validateElementsJson({
      elementsJson: component.elementsJson,
      elementCount: component.elementCount,
      schemaVersion: component.schemaVersion,
      allowImages: true,
    });
    const assets = await ctx.db
      .query("savedComponentAssets")
      .withIndex("by_componentId", (q) => q.eq("componentId", component._id))
      .take(MAX_COMPONENT_ASSETS + 1);
    const storedFileIds = new Set(assets.map((asset) => asset.fileId));
    const missing = [...referencedFileIds].filter(
      (fileId) => !storedFileIds.has(fileId),
    );
    const extra = [...storedFileIds].filter(
      (fileId) => !referencedFileIds.has(fileId),
    );
    if (missing.length || extra.length) {
      throw new Error(
        `Component asset manifest is incomplete (${missing.length} missing, ${extra.length} extra)`,
      );
    }
    if (
      !component.previewObjectKey ||
      !component.previewMimeType ||
      component.previewSize === undefined ||
      component.previewWidth === undefined ||
      component.previewHeight === undefined
    ) {
      throw new Error("Component preview is missing");
    }
    const now = Date.now();
    await ctx.db.patch("savedComponents", component._id, {
      status: undefined,
      readyAt: now,
      updatedAt: now,
    });
    return { componentId: component._id, updatedAt: now };
  },
});

const assetManifestValidator = v.object({
  fileId: v.string(),
  objectKey: v.string(),
  mimeType: v.string(),
  size: v.number(),
  etag: v.string(),
  url: v.string(),
});

const previewManifestValidator = v.object({
  objectKey: v.string(),
  mimeType: v.string(),
  size: v.number(),
  width: v.number(),
  height: v.number(),
  url: v.string(),
});

export const getAssetManifest = query({
  args: { componentId: v.id("savedComponents") },
  returns: v.object({
    elementsJson: v.string(),
    assets: v.array(assetManifestValidator),
    preview: v.optional(previewManifestValidator),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const component = await getOwnedComponent(ctx, args.componentId, ownerId);
    if (!isReadyComponent(component)) {
      throw new Error("Saved component is not ready");
    }
    const assets = await ctx.db
      .query("savedComponentAssets")
      .withIndex("by_componentId", (q) => q.eq("componentId", component._id))
      .take(MAX_COMPONENT_ASSETS + 1);
    return {
      elementsJson: component.elementsJson,
      assets: assets.map((asset) => ({
        fileId: asset.fileId,
        objectKey: asset.objectKey,
        mimeType: asset.mimeType,
        size: asset.size,
        etag: asset.etag,
        url: `/api/assets/${asset.objectKey}`,
      })),
      ...(component.previewObjectKey &&
      component.previewMimeType &&
      component.previewSize !== undefined &&
      component.previewWidth !== undefined &&
      component.previewHeight !== undefined
        ? {
            preview: {
              objectKey: component.previewObjectKey,
              mimeType: component.previewMimeType,
              size: component.previewSize,
              width: component.previewWidth,
              height: component.previewHeight,
              url: `/api/assets/${component.previewObjectKey}`,
            },
          }
        : {}),
    };
  },
});

export const cleanupAbandonedDrafts = mutation({
  args: {},
  returns: v.object({
    removedDrafts: v.number(),
    removedGrants: v.number(),
    assetDeleteToken: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const now = Date.now();
    const components = await ctx.db
      .query("savedComponents")
      .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", ownerId))
      .take(200);
    const abandonedDrafts = components.filter(
      (component) =>
        component.status === "draft" &&
        component.createdAt < now - ABANDONED_DRAFT_AGE_MS,
    );
    const abandonedIds = new Set(
      abandonedDrafts.map((component) => component._id),
    );
    const ownerGrants = await ctx.db
      .query("savedComponentUploadGrants")
      .withIndex("by_ownerId_and_createdAt", (q) => q.eq("ownerId", ownerId))
      .take(500);
    const expiredGrants = ownerGrants.filter(
      (grant) => grant.expiresAt < now || abandonedIds.has(grant.componentId),
    );
    const objectKeys = expiredGrants.map((grant) => grant.objectKey);
    for (const component of abandonedDrafts) {
      const assets = await ctx.db
        .query("savedComponentAssets")
        .withIndex("by_componentId", (q) => q.eq("componentId", component._id))
        .take(MAX_COMPONENT_ASSETS + 1);
      objectKeys.push(
        ...assets.map((asset) => asset.objectKey),
        ...(component.previewObjectKey ? [component.previewObjectKey] : []),
      );
      for (const asset of assets) {
        await ctx.db.delete("savedComponentAssets", asset._id);
      }
      await ctx.db.delete("savedComponents", component._id);
    }
    for (const grant of expiredGrants) {
      await ctx.db.delete("savedComponentUploadGrants", grant._id);
    }
    const assetDeleteToken = await createAssetDeleteGrant(
      ctx,
      ownerId,
      objectKeys,
    );
    return {
      removedDrafts: abandonedDrafts.length,
      removedGrants: expiredGrants.length,
      assetDeleteToken,
    };
  },
});

export const rename = mutation({
  args: {
    componentId: v.id("savedComponents"),
    name: v.string(),
  },
  returns: componentMutationResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    await getOwnedComponent(ctx, args.componentId, ownerId);
    const name = validateName(args.name);
    const updatedAt = Date.now();
    await ctx.db.patch("savedComponents", args.componentId, {
      ...name,
      updatedAt,
    });
    return { componentId: args.componentId, updatedAt };
  },
});

export const remove = mutation({
  args: { componentId: v.id("savedComponents") },
  returns: componentMutationResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const component = await getOwnedComponent(ctx, args.componentId, ownerId);
    const [assets, grants] = await Promise.all([
      ctx.db
        .query("savedComponentAssets")
        .withIndex("by_componentId", (q) => q.eq("componentId", component._id))
        .take(MAX_COMPONENT_ASSETS + 1),
      ctx.db
        .query("savedComponentUploadGrants")
        .withIndex("by_componentId", (q) => q.eq("componentId", component._id))
        .take(MAX_COMPONENT_ASSETS + 2),
    ]);
    const assetDeleteToken = await createAssetDeleteGrant(ctx, ownerId, [
      ...assets.map((asset) => asset.objectKey),
      ...grants.map((grant) => grant.objectKey),
      ...(component.previewObjectKey ? [component.previewObjectKey] : []),
    ]);
    for (const asset of assets) {
      await ctx.db.delete("savedComponentAssets", asset._id);
    }
    for (const grant of grants) {
      await ctx.db.delete("savedComponentUploadGrants", grant._id);
    }
    await ctx.db.delete("savedComponents", args.componentId);
    return { componentId: args.componentId, assetDeleteToken };
  },
});
