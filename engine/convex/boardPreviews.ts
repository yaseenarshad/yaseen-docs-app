import { v } from "convex/values";

import { mutation } from "./_generated/server";
import {
  createBoardPreviewUploadGrant,
  recordEmptyBoardPreview,
  registerBoardPreviewUpload,
} from "./boardPreviewPersistence";

const cleanupResultValidator = v.object({
  assetDeleteToken: v.union(v.string(), v.null()),
});

export const createUploadGrant = mutation({
  args: {
    boardId: v.id("diagrams"),
    sourceVersion: v.number(),
    mimeType: v.string(),
    size: v.number(),
    width: v.number(),
    height: v.number(),
  },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) => await createBoardPreviewUploadGrant(ctx, args),
});

export const registerUpload = mutation({
  args: {
    token: v.string(),
    etag: v.string(),
  },
  returns: v.object({
    status: v.union(v.literal("registered"), v.literal("stale")),
    assetDeleteToken: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) =>
    await registerBoardPreviewUpload(ctx, args.token, args.etag),
});

export const recordEmpty = mutation({
  args: {
    boardId: v.id("diagrams"),
    sourceVersion: v.number(),
  },
  returns: cleanupResultValidator,
  handler: async (ctx, args) =>
    await recordEmptyBoardPreview(ctx, args.boardId, args.sourceVersion),
});
