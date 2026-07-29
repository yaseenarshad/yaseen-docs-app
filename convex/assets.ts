import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";

const MAX_ASSET_BYTES = 50 * 1024 * 1024;
const GRANT_LIFETIME_MS = 10 * 60 * 1000;

const assetValidator = v.object({
  fileId: v.string(),
  mimeType: v.string(),
  size: v.number(),
  createdAt: v.number(),
  url: v.string(),
});

const requireUserId = async (ctx: Parameters<typeof getAuthUserId>[0]) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
};

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

const toAsset = (asset: {
  fileId: string;
  objectKey?: string;
  mimeType: string;
  size?: number;
  createdAt: number;
}) => {
  if (!asset.objectKey) {
    return null;
  }
  return {
    fileId: asset.fileId,
    mimeType: asset.mimeType,
    size: asset.size ?? 0,
    createdAt: asset.createdAt,
    url: `/api/assets/${asset.objectKey}`,
  };
};

export const listMine = query({
  args: {
    diagramId: v.id("diagrams"),
  },
  returns: v.array(assetValidator),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }
    const assets = await ctx.db
      .query("diagramAssets")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .take(2000);
    return assets.flatMap((asset) => {
      const value = toAsset(asset);
      return value ? [value] : [];
    });
  },
});

export const listShared = query({
  args: {
    shareToken: v.string(),
  },
  returns: v.array(assetValidator),
  handler: async (ctx, args) => {
    const diagram = await ctx.db
      .query("diagrams")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken))
      .unique();
    if (!diagram || !diagram.shareEnabled) {
      return [];
    }
    const assets = await ctx.db
      .query("diagramAssets")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .take(2000);
    return assets.flatMap((asset) => {
      const value = toAsset(asset);
      return value ? [value] : [];
    });
  },
});

export const createUploadGrant = mutation({
  args: {
    diagramId: v.id("diagrams"),
    fileId: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  returns: v.object({
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }
    if (
      !args.mimeType.startsWith("image/") ||
      args.size <= 0 ||
      args.size > MAX_ASSET_BYTES
    ) {
      throw new Error("Unsupported image or image exceeds the 50 MB limit");
    }
    const existing = await ctx.db
      .query("diagramAssets")
      .withIndex("by_diagramId_and_fileId", (q) =>
        q.eq("diagramId", diagram._id).eq("fileId", args.fileId),
      )
      .unique();
    if (existing?.objectKey) {
      throw new Error("This image is already stored");
    }

    const token = makeToken();
    const objectKey = `${diagram._id}/${makeToken()}.${extensionForMimeType(
      args.mimeType,
    )}`;
    const now = Date.now();
    await ctx.db.insert("assetUploadGrants", {
      token,
      diagramId: diagram._id,
      ownerId,
      fileId: args.fileId,
      objectKey,
      mimeType: args.mimeType,
      size: args.size,
      createdAt: now,
      expiresAt: now + GRANT_LIFETIME_MS,
    });
    return { token };
  },
});

export const validateUploadGrant = internalMutation({
  args: {
    token: v.string(),
  },
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
    if (!grant || grant.expiresAt < Date.now()) {
      return null;
    }
    return {
      objectKey: grant.objectKey,
      mimeType: grant.mimeType,
      size: grant.size,
    };
  },
});

export const registerUpload = mutation({
  args: {
    token: v.string(),
    etag: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const grant = await ctx.db
      .query("assetUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!grant || grant.ownerId !== ownerId || grant.expiresAt < Date.now()) {
      throw new Error("Upload grant expired");
    }
    const diagram = await ctx.db.get("diagrams", grant.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }
    const existing = await ctx.db
      .query("diagramAssets")
      .withIndex("by_diagramId_and_fileId", (q) =>
        q.eq("diagramId", grant.diagramId).eq("fileId", grant.fileId),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch("diagramAssets", existing._id, {
        objectKey: grant.objectKey,
        mimeType: grant.mimeType,
        size: grant.size,
        etag: args.etag,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("diagramAssets", {
        diagramId: grant.diagramId,
        fileId: grant.fileId,
        objectKey: grant.objectKey,
        mimeType: grant.mimeType,
        size: grant.size,
        etag: args.etag,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.delete("assetUploadGrants", grant._id);
    return null;
  },
});
