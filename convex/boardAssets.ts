import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
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
  args: { boardId: v.id("diagrams") },
  returns: v.array(assetValidator),
  handler: async (ctx, args) =>
    await listOwnedBoardAssets(ctx, args.boardId, "Board"),
});

export const listShared = query({
  args: { shareToken: v.string() },
  returns: v.array(assetValidator),
  handler: async (ctx, args) =>
    await listSharedBoardAssets(ctx, args.shareToken),
});

export const createUploadGrant = mutation({
  args: {
    boardId: v.id("diagrams"),
    fileId: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) =>
    await createBoardAssetUploadGrant(ctx, args, "Board"),
});

export const registerUpload = mutation({
  args: {
    token: v.string(),
    etag: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await registerBoardAssetUpload(ctx, args.token, args.etag, "Board");
    return null;
  },
});
