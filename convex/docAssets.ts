import { v } from "convex/values";

import {
  DOC_ASSET_ID_PATTERN,
  DOC_ASSET_KEY_PREFIX,
  DOC_ASSET_READ_ROUTE_PREFIX,
  MAX_DOC_ASSET_BYTES,
} from "../doc-assets/types";

import { internalMutation, mutation, query } from "./_generated/server";
import { requireUserId } from "./boardPersistence";
import {
  getDocsMode,
  requireDocsReadable,
  requireDocsWritable,
} from "./docsMode";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const TOKEN_LIFETIME_MS = 10 * 60 * 1000;
const READ_LIFETIME_MS = 5 * 60 * 1000;
const DELETE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const UNREFERENCED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

const token = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
const assetId = () => crypto.randomUUID().replaceAll("-", "");

const requireReadyAsset = async (ctx: MutationCtx, id: string) => {
  const asset = await ctx.db
    .query("docAssets")
    .withIndex("by_assetId", (q) => q.eq("assetId", id))
    .unique();
  return asset?.status === "ready" ? asset : null;
};

const hasSharedAssetAccess = async (
  ctx: MutationCtx,
  asset: Doc<"docAssets">,
  diagramId: Id<"diagrams">,
) => {
  const refs = await ctx.db
    .query("docAssetReferences")
    .withIndex("by_assetId_and_source", (q) =>
      q.eq("assetId", asset.assetId).eq("source", "current"),
    )
    .take(1000);
  for (const ref of refs) {
    const doc = await ctx.db.get("docs", ref.docId);
    if (!doc || doc.lifecycle !== "active" || doc.ownerId !== asset.ownerId) {
      continue;
    }
    const placement = await ctx.db
      .query("docPlacements")
      .withIndex("by_diagramId_and_docId", (q) =>
        q.eq("diagramId", diagramId).eq("docId", ref.docId),
      )
      .first();
    if (placement) {
      return true;
    }
  }
  return false;
};

export const createUploadGrant = mutation({
  args: {
    docId: v.id("docs"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sha256: v.string(),
  },
  returns: v.object({
    token: v.string(),
    assetId: v.string(),
    path: v.string(),
  }),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const doc = await ctx.db.get("docs", args.docId);
    if (!doc || doc.ownerId !== ownerId || doc.lifecycle !== "active") {
      throw new Error("Doc not found");
    }
    if (
      !SAFE_FILENAME.test(args.filename) ||
      !args.mimeType ||
      args.mimeType === "image/svg+xml" ||
      args.size <= 0 ||
      args.size > MAX_DOC_ASSET_BYTES ||
      !SHA256.test(args.sha256)
    ) {
      throw new Error("Unsupported file or file exceeds the 50 MB limit");
    }
    const id = assetId();
    const grantToken = token();
    const now = Date.now();
    await ctx.db.insert("docAssetUploadGrants", {
      token: grantToken,
      assetId: id,
      docId: doc._id,
      ownerId,
      filename: args.filename,
      mimeType: args.mimeType,
      size: args.size,
      sha256: args.sha256,
      objectKey: `${DOC_ASSET_KEY_PREFIX}${ownerId}/${id}`,
      createdAt: now,
      expiresAt: now + TOKEN_LIFETIME_MS,
    });
    return {
      token: grantToken,
      assetId: id,
      path: `assets/${id}/${args.filename}`,
    };
  },
});

export const registerUpload = mutation({
  args: { token: v.string(), etag: v.string() },
  returns: v.object({ assetId: v.string(), path: v.string() }),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const grant = await ctx.db
      .query("docAssetUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (
      !grant ||
      grant.ownerId !== ownerId ||
      grant.expiresAt < Date.now() ||
      grant.resolvedAt === undefined
    ) {
      throw new Error("Asset upload grant expired");
    }
    const now = Date.now();
    await ctx.db.insert("docAssets", {
      assetId: grant.assetId,
      ownerId,
      sourceDocId: grant.docId,
      filename: grant.filename,
      mimeType: grant.mimeType,
      size: grant.size,
      sha256: grant.sha256,
      objectKey: grant.objectKey,
      etag: args.etag,
      status: "ready",
      currentRefCount: 0,
      snapshotRefCount: 0,
      unreferencedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.delete("docAssetUploadGrants", grant._id);
    return {
      assetId: grant.assetId,
      path: `assets/${grant.assetId}/${grant.filename}`,
    };
  },
});

export const pendingCleanup = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const now = Date.now();
    const grants = await ctx.db.query("docAssetDeleteGrants").collect();
    return grants
      .filter((grant) => grant.ownerId === ownerId && grant.expiresAt >= now)
      .slice(0, 20)
      .map((grant) => grant.token);
  },
});

export const createReadGrant = mutation({
  args: {
    assetId: v.string(),
    boardId: v.union(v.id("diagrams"), v.null()),
    shareToken: v.union(v.string(), v.null()),
  },
  returns: v.object({
    token: v.string(),
    path: v.string(),
    expiresAt: v.number(),
    mimeType: v.string(),
    filename: v.string(),
    size: v.number(),
    sha256: v.string(),
  }),
  handler: async (ctx, args) => {
    requireDocsReadable();
    if (!DOC_ASSET_ID_PATTERN.test(args.assetId)) {
      throw new Error("Asset not found");
    }
    const asset = await requireReadyAsset(ctx, args.assetId);
    if (!asset) {
      throw new Error("Asset not found");
    }
    let access: "owner" | "shared";
    let diagramId: Id<"diagrams"> | undefined;
    if (args.shareToken === null) {
      if ((await requireUserId(ctx)) !== asset.ownerId) {
        throw new Error("Asset not found");
      }
      if (args.boardId !== null) {
        const diagram = await ctx.db.get("diagrams", args.boardId);
        if (!diagram || diagram.ownerId !== asset.ownerId) {
          throw new Error("Asset not found");
        }
      }
      access = "owner";
    } else if (args.boardId === null && args.shareToken !== null) {
      const diagram = await ctx.db
        .query("diagrams")
        .withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken!))
        .unique();
      if (
        !diagram ||
        !diagram.shareEnabled ||
        diagram.ownerId !== asset.ownerId ||
        !(await hasSharedAssetAccess(ctx, asset, diagram._id))
      ) {
        throw new Error("Asset not found");
      }
      access = "shared";
      diagramId = diagram._id;
    } else {
      throw new Error("Invalid asset access");
    }
    const grantToken = token();
    const expiresAt = Date.now() + READ_LIFETIME_MS;
    await ctx.db.insert("docAssetReadGrants", {
      token: grantToken,
      assetId: asset.assetId,
      ownerId: asset.ownerId,
      access,
      ...(diagramId ? { diagramId, shareToken: args.shareToken! } : {}),
      createdAt: Date.now(),
      expiresAt,
    });
    return {
      token: grantToken,
      path: `${DOC_ASSET_READ_ROUTE_PREFIX}${grantToken}`,
      expiresAt,
      mimeType: asset.mimeType,
      filename: asset.filename,
      size: asset.size,
      sha256: asset.sha256,
    };
  },
});

export const resolveUploadGrant = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      objectKey: v.string(),
      assetId: v.string(),
      mimeType: v.string(),
      size: v.number(),
      sha256: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const grant = await ctx.db
      .query("docAssetUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (
      !grant ||
      grant.expiresAt < Date.now() ||
      grant.resolvedAt !== undefined
    ) {
      return null;
    }
    await ctx.db.patch("docAssetUploadGrants", grant._id, {
      resolvedAt: Date.now(),
    });
    return {
      objectKey: grant.objectKey,
      assetId: grant.assetId,
      mimeType: grant.mimeType,
      size: grant.size,
      sha256: grant.sha256,
    };
  },
});

export const resolveReadGrant = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      objectKey: v.string(),
      assetId: v.string(),
      mimeType: v.string(),
      filename: v.string(),
      size: v.number(),
      sha256: v.string(),
      etag: v.string(),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    requireDocsReadable();
    const grant = await ctx.db
      .query("docAssetReadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    const asset = grant ? await requireReadyAsset(ctx, grant.assetId) : null;
    if (!grant || !asset || grant.expiresAt < Date.now()) {
      return null;
    }
    if (grant.access === "shared") {
      const diagram = grant.diagramId
        ? await ctx.db.get("diagrams", grant.diagramId)
        : null;
      if (
        !diagram ||
        !diagram.shareEnabled ||
        diagram.shareToken !== grant.shareToken ||
        !(await hasSharedAssetAccess(ctx, asset, diagram._id))
      ) {
        return null;
      }
    }
    return {
      objectKey: asset.objectKey,
      assetId: asset.assetId,
      mimeType: asset.mimeType,
      filename: asset.filename,
      size: asset.size,
      sha256: asset.sha256,
      etag: asset.etag,
      expiresAt: grant.expiresAt,
    };
  },
});

export const startCleanup = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    if (getDocsMode() !== "on") {
      return 0;
    }
    const now = Date.now();
    const expired = await ctx.db
      .query("docAssetDeleteGrants")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .take(100);
    for (const grant of expired) {
      const asset = await ctx.db
        .query("docAssets")
        .withIndex("by_assetId", (q) => q.eq("assetId", grant.assetId))
        .unique();
      if (
        asset?.status === "purging" &&
        asset.currentRefCount + asset.snapshotRefCount === 0
      ) {
        await ctx.db.patch("docAssets", asset._id, {
          status: "ready",
          updatedAt: now,
        });
      }
      await ctx.db.delete("docAssetDeleteGrants", grant._id);
    }
    const cutoff = now - UNREFERENCED_RETENTION_MS;
    const candidates = await ctx.db
      .query("docAssets")
      .withIndex("by_unreferencedAt", (q) => q.lt("unreferencedAt", cutoff))
      .take(100);
    let scheduled = 0;
    for (const asset of candidates) {
      if (
        asset.status !== "ready" ||
        asset.currentRefCount !== 0 ||
        asset.snapshotRefCount !== 0
      ) {
        continue;
      }
      const grantToken = token();
      await ctx.db.insert("docAssetDeleteGrants", {
        token: grantToken,
        assetId: asset.assetId,
        ownerId: asset.ownerId,
        objectKey: asset.objectKey,
        createdAt: now,
        expiresAt: now + DELETE_LIFETIME_MS,
      });
      await ctx.db.patch("docAssets", asset._id, {
        status: "purging",
        updatedAt: now,
      });
      scheduled += 1;
    }
    return scheduled;
  },
});

export const consumeDeleteGrant = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({ objectKey: v.string(), assetId: v.string() }),
  ),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const grant = await ctx.db
      .query("docAssetDeleteGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!grant) {
      return null;
    }
    await ctx.db.delete("docAssetDeleteGrants", grant._id);
    const asset = await ctx.db
      .query("docAssets")
      .withIndex("by_assetId", (q) => q.eq("assetId", grant.assetId))
      .unique();
    if (
      grant.expiresAt < Date.now() ||
      !asset ||
      asset.currentRefCount !== 0 ||
      asset.snapshotRefCount !== 0
    ) {
      if (asset?.status === "purging") {
        await ctx.db.patch("docAssets", asset._id, {
          status: "ready",
          updatedAt: Date.now(),
        });
      }
      return null;
    }
    await ctx.db.patch("docAssets", asset._id, {
      status: "purged",
      purgedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { objectKey: grant.objectKey, assetId: grant.assetId };
  },
});
