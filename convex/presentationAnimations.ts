import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import {
  PRESENTATION_ANIMATION_GRANT_LIFETIME_MS,
  PRESENTATION_ANIMATION_MIME_TYPE,
  assertPresentationAnimationManifest,
  makePresentationAnimationToken,
  presentationAnimationUploadResultValidator,
  toPresentationAnimationReference,
} from "./presentationAnimationModel";
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
