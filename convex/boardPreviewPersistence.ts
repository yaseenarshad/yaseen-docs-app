import { getAuthUserId } from "@convex-dev/auth/server";

import { createAssetDeleteGrant } from "./assetDeletePersistence";
import { readBoardSceneManifest } from "./boardScenePersistence";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const MAX_PREVIEW_WIDTH = 1200;
const MAX_PREVIEW_HEIGHT = 800;
const GRANT_LIFETIME_MS = 10 * 60 * 1000;

const makeToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

const requireUserId = async (ctx: MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
};

const getOwnedBoard = async (
  ctx: MutationCtx,
  boardId: Id<"diagrams">,
  ownerId: Id<"users">,
) => {
  const diagram = await ctx.db.get("diagrams", boardId);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error("Board not found");
  }
  return diagram;
};

const getBoardContent = async (ctx: MutationCtx, boardId: Id<"diagrams">) => {
  const content = await ctx.db
    .query("diagramContents")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", boardId))
    .unique();
  if (!content) {
    throw new Error("Board content is missing");
  }
  return content;
};

/**
 * A preview is only ever generated from a committed version. The manifest is
 * the authority for a migrated Board, and the legacy content row is consulted
 * only for a Board that has neither a manifest nor a recorded version.
 */
const getCurrentBoardVersion = async (
  ctx: MutationCtx,
  diagram: Awaited<ReturnType<typeof getOwnedBoard>>,
) => {
  const manifest = await readBoardSceneManifest(ctx, diagram._id);
  if (manifest) {
    return manifest.version;
  }
  return (
    diagram.contentVersion ?? (await getBoardContent(ctx, diagram._id)).version
  );
};

export const createBoardPreviewUploadGrant = async (
  ctx: MutationCtx,
  args: {
    boardId: Id<"diagrams">;
    sourceVersion: number;
    mimeType: string;
    size: number;
    width: number;
    height: number;
  },
) => {
  const ownerId = await requireUserId(ctx);
  const diagram = await getOwnedBoard(ctx, args.boardId, ownerId);
  const currentVersion = await getCurrentBoardVersion(ctx, diagram);
  if (currentVersion !== args.sourceVersion) {
    throw new Error("The saved Board version changed before preview upload");
  }
  if (
    args.mimeType !== "image/webp" ||
    !Number.isSafeInteger(args.size) ||
    args.size <= 0 ||
    args.size > MAX_PREVIEW_BYTES
  ) {
    throw new Error("Board previews must be WebP images under 5 MB");
  }
  if (
    !Number.isSafeInteger(args.width) ||
    !Number.isSafeInteger(args.height) ||
    args.width <= 0 ||
    args.height <= 0 ||
    args.width > MAX_PREVIEW_WIDTH ||
    args.height > MAX_PREVIEW_HEIGHT
  ) {
    throw new Error("Board preview dimensions exceed 1200×800");
  }

  const token = makeToken();
  const now = Date.now();
  await ctx.db.insert("assetUploadGrants", {
    token,
    diagramId: args.boardId,
    ownerId,
    fileId: `board-preview:${args.sourceVersion}`,
    objectKey: `${args.boardId}/previews/${makeToken()}.webp`,
    mimeType: args.mimeType,
    size: args.size,
    purpose: "boardPreview",
    sourceVersion: args.sourceVersion,
    previewWidth: args.width,
    previewHeight: args.height,
    createdAt: now,
    expiresAt: now + GRANT_LIFETIME_MS,
  });
  return { token };
};

export const registerBoardPreviewUpload = async (
  ctx: MutationCtx,
  token: string,
  etag: string,
) => {
  const ownerId = await requireUserId(ctx);
  const grant = await ctx.db
    .query("assetUploadGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!grant || grant.ownerId !== ownerId || grant.expiresAt < Date.now()) {
    throw new Error("Upload grant expired");
  }
  if (
    grant.purpose !== "boardPreview" ||
    grant.sourceVersion === undefined ||
    grant.previewWidth === undefined ||
    grant.previewHeight === undefined
  ) {
    throw new Error("A Board preview grant is required");
  }
  const diagram = await getOwnedBoard(ctx, grant.diagramId, ownerId);
  const currentVersion = await getCurrentBoardVersion(ctx, diagram);
  const isStale =
    grant.sourceVersion < currentVersion ||
    (diagram.previewVersion !== undefined &&
      diagram.previewVersion >= grant.sourceVersion);
  if (isStale) {
    const assetDeleteToken = await createAssetDeleteGrant(ctx, ownerId, [
      grant.objectKey,
    ]);
    await ctx.db.delete("assetUploadGrants", grant._id);
    return { status: "stale" as const, assetDeleteToken };
  }

  const assetDeleteToken = await createAssetDeleteGrant(
    ctx,
    ownerId,
    diagram.previewObjectKey ? [diagram.previewObjectKey] : [],
  );
  await ctx.db.patch("diagrams", diagram._id, {
    previewObjectKey: grant.objectKey,
    previewVersion: grant.sourceVersion,
    previewMimeType: grant.mimeType,
    previewWidth: grant.previewWidth,
    previewHeight: grant.previewHeight,
    previewUpdatedAt: Date.now(),
  });
  await ctx.db.delete("assetUploadGrants", grant._id);
  void etag;
  return { status: "registered" as const, assetDeleteToken };
};

export const recordEmptyBoardPreview = async (
  ctx: MutationCtx,
  boardId: Id<"diagrams">,
  sourceVersion: number,
) => {
  const ownerId = await requireUserId(ctx);
  const diagram = await getOwnedBoard(ctx, boardId, ownerId);
  const currentVersion = await getCurrentBoardVersion(ctx, diagram);
  if (currentVersion !== sourceVersion) {
    throw new Error("The saved Board version changed before preview update");
  }
  if (
    diagram.previewVersion !== undefined &&
    diagram.previewVersion >= sourceVersion
  ) {
    return { assetDeleteToken: null };
  }
  const assetDeleteToken = await createAssetDeleteGrant(
    ctx,
    ownerId,
    diagram.previewObjectKey ? [diagram.previewObjectKey] : [],
  );
  await ctx.db.patch("diagrams", diagram._id, {
    previewObjectKey: undefined,
    previewVersion: sourceVersion,
    previewMimeType: undefined,
    previewWidth: undefined,
    previewHeight: undefined,
    previewUpdatedAt: Date.now(),
  });
  return { assetDeleteToken };
};
