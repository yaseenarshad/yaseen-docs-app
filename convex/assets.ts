import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import {
  createBoardAssetUploadGrant,
  listOwnedBoardAssets,
  listSharedBoardAssets,
  registerBoardAssetUpload,
} from "./assetPersistence";

const assetValidator = v.object({
  fileId: v.string(),
  mimeType: v.string(),
  size: v.number(),
  createdAt: v.number(),
  url: v.string(),
});

export const listMine = query({
  args: { diagramId: v.id("diagrams") },
  returns: v.array(assetValidator),
  handler: async (ctx, args) =>
    await listOwnedBoardAssets(ctx, args.diagramId, "Diagram"),
});

export const listShared = query({
  args: { shareToken: v.string() },
  returns: v.array(assetValidator),
  handler: async (ctx, args) =>
    await listSharedBoardAssets(ctx, args.shareToken),
});

export const createUploadGrant = mutation({
  args: {
    diagramId: v.id("diagrams"),
    fileId: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) =>
    await createBoardAssetUploadGrant(
      ctx,
      {
        boardId: args.diagramId,
        fileId: args.fileId,
        mimeType: args.mimeType,
        size: args.size,
      },
      "Diagram",
    ),
});

export const validateUploadGrant = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      objectKey: v.string(),
      mimeType: v.string(),
      size: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("assetUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (grant && grant.expiresAt >= Date.now()) {
      return {
        objectKey: grant.objectKey,
        mimeType: grant.mimeType,
        size: grant.size,
      };
    }
    const componentGrant = await ctx.db
      .query("savedComponentUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!componentGrant || componentGrant.expiresAt < Date.now()) {
      return null;
    }
    return {
      objectKey: componentGrant.objectKey,
      mimeType: componentGrant.mimeType,
      size: componentGrant.size,
    };
  },
});

export const consumeDeleteGrant = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      objectKeys: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("assetDeleteGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!grant) {
      return null;
    }
    await ctx.db.delete("assetDeleteGrants", grant._id);
    if (grant.expiresAt < Date.now()) {
      return null;
    }
    return { objectKeys: grant.objectKeys };
  },
});

export const registerUpload = mutation({
  args: {
    token: v.string(),
    etag: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await registerBoardAssetUpload(ctx, args.token, args.etag, "Diagram");
    return null;
  },
});
