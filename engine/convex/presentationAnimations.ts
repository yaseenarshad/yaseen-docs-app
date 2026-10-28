import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import {
  PRESENTATION_ANIMATION_GRANT_LIFETIME_MS,
  PRESENTATION_ANIMATION_MIME_TYPE,
  PRESENTATION_ANIMATION_READ_GRANT_LIFETIME_MS,
  assertPresentationAnimationManifest,
  makePresentationAnimationToken,
  presentationAnimationUploadResultValidator,
  presentationAnimationReferenceValidator,
  toPresentationAnimationReference,
} from "./presentationAnimationModel";
import { createAssetDeleteGrant } from "./assetDeletePersistence";
import { internalQuery, mutation } from "./_generated/server";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const requireUserId = async (ctx: MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
};

const findAssetVersion = async (
  ctx: MutationCtx,
  diagramId: Id<"diagrams">,
  assetId: string,
  version: number,
) =>
  await ctx.db
    .query("presentationAnimationAssets")
    .withIndex("by_diagramId_and_assetId_and_version", (q) =>
      q
        .eq("diagramId", diagramId)
        .eq("assetId", assetId)
        .eq("version", version),
    )
    .unique();

export const createUploadGrant = mutation({
  args: {
    diagramId: v.id("diagrams"),
    assetId: v.string(),
    version: v.number(),
    sourceElementId: v.string(),
    slideId: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sha256: v.string(),
    previewFileId: v.optional(v.string()),
    replacementForVersion: v.optional(v.number()),
  },
  returns: presentationAnimationUploadResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Board not found");
    }
    assertPresentationAnimationManifest(args);

    const existing = await findAssetVersion(
      ctx,
      diagram._id,
      args.assetId,
      args.version,
    );
    if (existing) {
      if (
        existing.sha256 !== args.sha256 ||
        existing.size !== args.size ||
        existing.sourceElementId !== args.sourceElementId ||
        existing.slideId !== args.slideId
      ) {
        throw new Error("Presentation animation version already exists");
      }
      return {
        kind: "registered" as const,
        asset: toPresentationAnimationReference(existing),
      };
    }

    const latest = await ctx.db
      .query("presentationAnimationAssets")
      .withIndex("by_diagramId_and_assetId_and_version", (q) =>
        q.eq("diagramId", diagram._id).eq("assetId", args.assetId),
      )
      .order("desc")
      .first();
    if (latest) {
      if (
        args.replacementForVersion !== latest.version ||
        args.version <= latest.version
      ) {
        throw new Error(
          "Replacing a presentation animation requires its current version",
        );
      }
    } else if (args.replacementForVersion !== undefined) {
      throw new Error("Replacement presentation animation was not found");
    }

    const existingGrant = await ctx.db
      .query("presentationAnimationUploadGrants")
      .withIndex("by_diagramId_and_assetId_and_version", (q) =>
        q
          .eq("diagramId", diagram._id)
          .eq("assetId", args.assetId)
          .eq("version", args.version),
      )
      .unique();
    const now = Date.now();
    if (
      existingGrant &&
      existingGrant.expiresAt >= now &&
      existingGrant.registeredAt === undefined &&
      existingGrant.sha256 === args.sha256 &&
      existingGrant.size === args.size &&
      existingGrant.sourceElementId === args.sourceElementId &&
      existingGrant.slideId === args.slideId
    ) {
      return {
        kind: "upload" as const,
        token: existingGrant.token,
        assetId: args.assetId,
        version: args.version,
      };
    }
    if (existingGrant) {
      await ctx.db.delete(
        "presentationAnimationUploadGrants",
        existingGrant._id,
      );
    }

    const token = makePresentationAnimationToken();
    await ctx.db.insert("presentationAnimationUploadGrants", {
      token,
      diagramId: diagram._id,
      ownerId,
      assetId: args.assetId,
      version: args.version,
      sourceElementId: args.sourceElementId,
      slideId: args.slideId,
      objectKey: `${
        diagram._id
      }/presentation-animations/${makePresentationAnimationToken()}.html`,
      mimeType: PRESENTATION_ANIMATION_MIME_TYPE,
      size: args.size,
      sha256: args.sha256,
      previewFileId: args.previewFileId,
      replacementForVersion: args.replacementForVersion,
      createdAt: now,
      expiresAt: now + PRESENTATION_ANIMATION_GRANT_LIFETIME_MS,
    });
    return {
      kind: "upload" as const,
      token,
      assetId: args.assetId,
      version: args.version,
    };
  },
});

export const validateUploadGrant = internalQuery({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      objectKey: v.string(),
      mimeType: v.literal(PRESENTATION_ANIMATION_MIME_TYPE),
      size: v.number(),
      sha256: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("presentationAnimationUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (
      !grant ||
      grant.expiresAt < Date.now() ||
      grant.registeredAt !== undefined
    ) {
      return null;
    }
    return {
      objectKey: grant.objectKey,
      mimeType: PRESENTATION_ANIMATION_MIME_TYPE,
      size: grant.size,
      sha256: grant.sha256,
    };
  },
});

export const createReadGrant = mutation({
  args: {
    diagramId: v.optional(v.id("diagrams")),
    shareToken: v.optional(v.string()),
    assetId: v.string(),
    version: v.number(),
  },
  returns: v.object({
    token: v.string(),
    path: v.string(),
    expiresAt: v.number(),
    assetId: v.string(),
    version: v.number(),
    etag: v.string(),
  }),
  handler: async (ctx, args) => {
    if ((args.diagramId === undefined) === (args.shareToken === undefined)) {
      throw new Error("Choose owner or shared board access");
    }

    let diagram;
    let access: "owner" | "shared";
    if (args.diagramId !== undefined) {
      const ownerId = await requireUserId(ctx);
      diagram = await ctx.db.get("diagrams", args.diagramId);
      if (!diagram || diagram.ownerId !== ownerId) {
        throw new Error("Board not found");
      }
      access = "owner";
    } else {
      diagram = await ctx.db
        .query("diagrams")
        .withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken))
        .unique();
      if (!diagram || !diagram.shareEnabled) {
        throw new Error("Shared board not found");
      }
      access = "shared";
    }

    const asset = await findAssetVersion(
      ctx,
      diagram._id,
      args.assetId,
      args.version,
    );
    if (!asset || asset.status !== "ready") {
      throw new Error("Presentation animation not found");
    }

    const token = makePresentationAnimationToken();
    const now = Date.now();
    const expiresAt = now + PRESENTATION_ANIMATION_READ_GRANT_LIFETIME_MS;
    await ctx.db.insert("presentationAnimationReadGrants", {
      token,
      diagramId: diagram._id,
      assetRecordId: asset._id,
      assetId: asset.assetId,
      version: asset.version,
      objectKey: asset.objectKey,
      mimeType: PRESENTATION_ANIMATION_MIME_TYPE,
      size: asset.size,
      sha256: asset.sha256,
      etag: asset.etag,
      access,
      ...(access === "shared" ? { shareToken: args.shareToken } : null),
      createdAt: now,
      expiresAt,
    });
    return {
      token,
      path: `/api/presentation-animations/${token}`,
      expiresAt,
      assetId: asset.assetId,
      version: asset.version,
      etag: asset.etag,
    };
  },
});

export const validateReadGrant = internalQuery({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      objectKey: v.string(),
      mimeType: v.literal(PRESENTATION_ANIMATION_MIME_TYPE),
      size: v.number(),
      sha256: v.string(),
      etag: v.string(),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("presentationAnimationReadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!grant || grant.expiresAt < Date.now()) {
      return null;
    }
    const [diagram, asset] = await Promise.all([
      ctx.db.get("diagrams", grant.diagramId),
      ctx.db.get("presentationAnimationAssets", grant.assetRecordId),
    ]);
    if (
      !diagram ||
      !asset ||
      asset.diagramId !== grant.diagramId ||
      asset.assetId !== grant.assetId ||
      asset.version !== grant.version ||
      asset.objectKey !== grant.objectKey ||
      asset.sha256 !== grant.sha256 ||
      asset.etag !== grant.etag ||
      asset.status !== "ready" ||
      (grant.access === "shared" &&
        (!diagram.shareEnabled || diagram.shareToken !== grant.shareToken))
    ) {
      return null;
    }
    return {
      objectKey: grant.objectKey,
      mimeType: PRESENTATION_ANIMATION_MIME_TYPE,
      size: grant.size,
      sha256: grant.sha256,
      etag: grant.etag,
      expiresAt: grant.expiresAt,
    };
  },
});

export const registerUpload = mutation({
  args: { token: v.string(), etag: v.string() },
  returns: presentationAnimationReferenceValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    if (
      args.etag.trim() !== args.etag ||
      args.etag.length < 1 ||
      args.etag.length > 256
    ) {
      throw new Error("Invalid presentation animation etag");
    }
    const grant = await ctx.db
      .query("presentationAnimationUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!grant || grant.ownerId !== ownerId) {
      throw new Error("Animation upload grant expired");
    }
    const diagram = await ctx.db.get("diagrams", grant.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Board not found");
    }
    const existing = await findAssetVersion(
      ctx,
      grant.diagramId,
      grant.assetId,
      grant.version,
    );
    if (existing) {
      if (
        existing.objectKey !== grant.objectKey ||
        existing.sha256 !== grant.sha256 ||
        existing.etag !== args.etag
      ) {
        throw new Error("Presentation animation version already exists");
      }
      if (grant.registeredAt === undefined) {
        await ctx.db.patch("presentationAnimationUploadGrants", grant._id, {
          registeredAt: Date.now(),
          etag: args.etag,
        });
      }
      return toPresentationAnimationReference(existing);
    }
    if (grant.registeredAt !== undefined || grant.expiresAt < Date.now()) {
      throw new Error("Animation upload grant expired");
    }
    if (grant.replacementForVersion !== undefined) {
      const replaced = await findAssetVersion(
        ctx,
        grant.diagramId,
        grant.assetId,
        grant.replacementForVersion,
      );
      if (!replaced) {
        throw new Error("Replacement presentation animation was not found");
      }
    }
    const now = Date.now();
    await ctx.db.insert("presentationAnimationAssets", {
      diagramId: grant.diagramId,
      assetId: grant.assetId,
      version: grant.version,
      sourceElementId: grant.sourceElementId,
      slideId: grant.slideId,
      objectKey: grant.objectKey,
      mimeType: PRESENTATION_ANIMATION_MIME_TYPE,
      size: grant.size,
      sha256: grant.sha256,
      etag: args.etag,
      status: "ready",
      previewFileId: grant.previewFileId,
      replacementForVersion: grant.replacementForVersion,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("presentationAnimationUploadGrants", grant._id, {
      registeredAt: now,
      etag: args.etag,
    });
    return {
      assetId: grant.assetId,
      version: grant.version,
      mimeType: PRESENTATION_ANIMATION_MIME_TYPE,
      size: grant.size,
      sha256: grant.sha256,
      etag: args.etag,
      sourceElementId: grant.sourceElementId,
      slideId: grant.slideId,
      ...(grant.previewFileId ? { previewFileId: grant.previewFileId } : null),
    };
  },
});

export const abandonUpload = mutation({
  args: { token: v.string() },
  returns: v.object({ deleteToken: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const grant = await ctx.db
      .query("presentationAnimationUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!grant || grant.ownerId !== ownerId) {
      throw new Error("Animation upload grant not found");
    }
    if (grant.registeredAt !== undefined) {
      throw new Error("Registered animation uploads cannot be abandoned");
    }
    const deleteToken = await createAssetDeleteGrant(ctx, ownerId, [
      grant.objectKey,
    ]);
    await ctx.db.delete("presentationAnimationUploadGrants", grant._id);
    return { deleteToken };
  },
});

export const removeVersion = mutation({
  args: {
    diagramId: v.id("diagrams"),
    assetId: v.string(),
    version: v.number(),
  },
  returns: v.object({ deleteToken: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Board not found");
    }
    const asset = await findAssetVersion(
      ctx,
      diagram._id,
      args.assetId,
      args.version,
    );
    if (!asset) {
      return { deleteToken: null };
    }
    const deleteToken = await createAssetDeleteGrant(ctx, ownerId, [
      asset.objectKey,
    ]);
    const readGrants = await ctx.db
      .query("presentationAnimationReadGrants")
      .withIndex("by_assetRecordId", (q) => q.eq("assetRecordId", asset._id))
      .collect();
    for (const grant of readGrants) {
      await ctx.db.delete("presentationAnimationReadGrants", grant._id);
    }
    await ctx.db.delete("presentationAnimationAssets", asset._id);
    return { deleteToken };
  },
});
