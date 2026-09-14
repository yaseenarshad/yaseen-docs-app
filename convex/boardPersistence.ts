import { getAuthUserId } from "@convex-dev/auth/server";

import { LEGACY_BOARD_SCENE_RAW_BYTES } from "../board-scenes/types";

import { internal } from "./_generated/api";
import { createAssetDeleteGrant } from "./assetDeletePersistence";
import { toBoardSceneManifestSummary } from "./boardSceneModel";
import {
  assertBoardSceneNotMigrated,
  purgeBoardSceneRecords,
  readBoardSceneManifest,
} from "./boardScenePersistence";
import { toBoardPreviewSummary } from "./boardPreviewModel";
import { createDiagramSnapshotIfNeeded } from "./diagramHistory";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
import {
  areScenesEquivalentIgnoringDerivedBindings,
  hasElementVersionRegression,
} from "./sceneConflict";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { PaginationOptions } from "convex/server";

const EMPTY_SCENE_JSON = JSON.stringify({
  elements: [],
  appState: {},
  files: {},
});

export const DEFAULT_BOARD_TITLE = "Untitled board";
export const BOARD_SORTS = [
  "name-asc",
  "name-desc",
  "created-desc",
  "created-asc",
  "modified-desc",
  "modified-asc",
] as const;
export type BoardSort = typeof BOARD_SORTS[number];

export const normalizeBoardTitle = (title: string) =>
  title.trim().toLocaleLowerCase("en-US");

export const requireUserId = async (ctx: QueryCtx | MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
};

const makeSlug = () => crypto.randomUUID().replaceAll("-", "").slice(0, 20);

const makeShareToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

const assertSceneSize = (sceneJson: string, entityName: string) => {
  const bytes = new TextEncoder().encode(sceneJson).byteLength;
  if (bytes > LEGACY_BOARD_SCENE_RAW_BYTES) {
    throw new Error(
      `This ${entityName.toLowerCase()} is too large to save as one scene. Remove embedded data or split the ${entityName.toLowerCase()}.`,
    );
  }
};

const getUniqueSlug = async (ctx: MutationCtx, entityName: string) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = makeSlug();
    const existing = await ctx.db
      .query("diagrams")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!existing) {
      return slug;
    }
  }
  throw new Error(
    `Could not generate a unique ${entityName.toLowerCase()} URL`,
  );
};

const createRecord = async (
  ctx: MutationCtx,
  ownerId: Id<"users">,
  title: string,
  entityName: string,
) => {
  const now = Date.now();
  const slug = await getUniqueSlug(ctx, entityName);
  const diagramId = await ctx.db.insert("diagrams", {
    ownerId,
    slug,
    title,
    normalizedTitle: normalizeBoardTitle(title),
    visibility: "private",
    shareEnabled: false,
    contentVersion: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("diagramContents", {
    diagramId,
    sceneJson: EMPTY_SCENE_JSON,
    version: 0,
    updatedAt: now,
  });
  return { diagramId, slug };
};

export const toBoardSummary = (diagram: {
  _id: Id<"diagrams">;
  slug: string;
  title: string;
  visibility: "private" | "unlisted" | "public";
  shareEnabled: boolean;
  folderId?: Id<"boardFolders">;
  createdAt: number;
  updatedAt: number;
  previewObjectKey?: string;
  previewVersion?: number;
  previewMimeType?: string;
  previewWidth?: number;
  previewHeight?: number;
  previewUpdatedAt?: number;
}) => ({
  _id: diagram._id,
  slug: diagram.slug,
  title: diagram.title,
  visibility: diagram.visibility,
  shareEnabled: diagram.shareEnabled,
  ...(diagram.folderId ? { folderId: diagram.folderId } : {}),
  createdAt: diagram.createdAt,
  updatedAt: diagram.updatedAt,
  preview: toBoardPreviewSummary(diagram),
});

const toSharedBoardSummary = (diagram: {
  _id: Id<"diagrams">;
  slug: string;
  title: string;
  visibility: "private" | "unlisted" | "public";
  shareEnabled: boolean;
  folderId?: Id<"boardFolders">;
  createdAt: number;
  updatedAt: number;
}) => ({
  _id: diagram._id,
  slug: diagram.slug,
  title: diagram.title,
  visibility: diagram.visibility,
  shareEnabled: diagram.shareEnabled,
  ...(diagram.folderId ? { folderId: diagram.folderId } : {}),
  createdAt: diagram.createdAt,
  updatedAt: diagram.updatedAt,
});

export const ensureDefaultRecord = async (
  ctx: MutationCtx,
  entityName: string,
) => {
  const ownerId = await requireUserId(ctx);
  const existing = await ctx.db
    .query("diagrams")
    .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", ownerId))
    .order("desc")
    .take(1);
  if (existing[0]) {
    return { diagramId: existing[0]._id, slug: existing[0].slug };
  }
  return await createRecord(ctx, ownerId, DEFAULT_BOARD_TITLE, entityName);
};

export const createBoardRecord = async (
  ctx: MutationCtx,
  title: string,
  entityName: string,
) => {
  const ownerId = await requireUserId(ctx);
  const normalizedTitle = title.trim() || DEFAULT_BOARD_TITLE;
  return await createRecord(
    ctx,
    ownerId,
    normalizedTitle.slice(0, 120),
    entityName,
  );
};

export const listOwnedBoardRecords = async (ctx: QueryCtx) => {
  const ownerId = await requireUserId(ctx);
  const diagrams = await ctx.db
    .query("diagrams")
    .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", ownerId))
    .order("desc")
    .take(100);
  return diagrams.map(toBoardSummary);
};

export const paginateOwnedBoardRecords = async (
  ctx: QueryCtx,
  paginationOpts: PaginationOptions,
  sort: BoardSort,
  searchQuery: string,
) => {
  const ownerId = await requireUserId(ctx);
  const normalizedQuery = normalizeBoardTitle(searchQuery);
  if (normalizedQuery) {
    const result = await ctx.db
      .query("diagrams")
      .withSearchIndex("search_normalizedTitle", (q) =>
        q.search("normalizedTitle", normalizedQuery).eq("ownerId", ownerId),
      )
      .paginate(paginationOpts);
    const page = result.page.map(toBoardSummary);
    page.sort(getBoardSummaryComparator(sort));
    return { ...result, page };
  }

  const result =
    sort === "name-asc" || sort === "name-desc"
      ? await ctx.db
          .query("diagrams")
          .withIndex("by_ownerId_and_normalizedTitle", (q) =>
            q.eq("ownerId", ownerId),
          )
          .order(sort === "name-asc" ? "asc" : "desc")
          .paginate(paginationOpts)
      : sort === "created-asc" || sort === "created-desc"
      ? await ctx.db
          .query("diagrams")
          .withIndex("by_ownerId_and_createdAt", (q) =>
            q.eq("ownerId", ownerId),
          )
          .order(sort === "created-asc" ? "asc" : "desc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("diagrams")
          .withIndex("by_ownerId_and_updatedAt", (q) =>
            q.eq("ownerId", ownerId),
          )
          .order(sort === "modified-asc" ? "asc" : "desc")
          .paginate(paginationOpts);
  return {
    ...result,
    page: result.page.map(toBoardSummary),
  };
};

const getBoardSummaryComparator =
  (sort: BoardSort) =>
  (
    left: ReturnType<typeof toBoardSummary>,
    right: ReturnType<typeof toBoardSummary>,
  ) => {
    const direction =
      sort === "name-desc" ||
      sort === "created-desc" ||
      sort === "modified-desc"
        ? -1
        : 1;
    const value =
      sort === "name-asc" || sort === "name-desc"
        ? normalizeBoardTitle(left.title).localeCompare(
            normalizeBoardTitle(right.title),
          )
        : sort === "created-asc" || sort === "created-desc"
        ? left.createdAt - right.createdAt
        : left.updatedAt - right.updatedAt;
    return value === 0
      ? left._id.localeCompare(right._id) * direction
      : value * direction;
  };

// The reactive open subscription re-runs on every committed write, so it must
// never touch `diagramContents`. The version already lives on the small diagram
// row; only a Board written before that field existed needs the content read.
const readBoardContentVersion = async (
  ctx: QueryCtx,
  diagramId: Id<"diagrams">,
  contentVersion: number | undefined,
) => {
  if (contentVersion !== undefined) {
    return contentVersion;
  }
  const content = await ctx.db
    .query("diagramContents")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", diagramId))
    .unique();
  if (!content) {
    throw new Error("Board content is missing");
  }
  return content.version;
};

const readBoardScene = async (ctx: QueryCtx, diagramId: Id<"diagrams">) => {
  // Once a manifest exists the scene lives in R2, and neither an open nor a
  // save may fall back to the large legacy document.
  await assertBoardSceneNotMigrated(ctx, diagramId);
  const content = await ctx.db
    .query("diagramContents")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", diagramId))
    .unique();
  if (!content) {
    throw new Error("Board content is missing");
  }
  return {
    boardId: diagramId,
    sceneJson: content.sceneJson,
    version: content.version,
  };
};

export const openOwnedBoardMetadata = async (ctx: QueryCtx, slug: string) => {
  const ownerId = await requireUserId(ctx);
  const diagram = await ctx.db
    .query("diagrams")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!diagram || diagram.ownerId !== ownerId) {
    return null;
  }
  const manifest = await readBoardSceneManifest(ctx, diagram._id);
  return {
    board: toBoardSummary(diagram),
    version: manifest
      ? manifest.version
      : await readBoardContentVersion(ctx, diagram._id, diagram.contentVersion),
    access: "owner" as const,
    ...(manifest
      ? { sceneManifest: toBoardSceneManifestSummary(manifest) }
      : null),
  };
};

export const readOwnedBoardScene = async (ctx: QueryCtx, slug: string) => {
  const ownerId = await requireUserId(ctx);
  const diagram = await ctx.db
    .query("diagrams")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!diagram || diagram.ownerId !== ownerId) {
    return null;
  }
  return await readBoardScene(ctx, diagram._id);
};

export const openSharedBoardMetadata = async (
  ctx: QueryCtx,
  shareToken: string,
) => {
  const diagram = await ctx.db
    .query("diagrams")
    .withIndex("by_shareToken", (q) => q.eq("shareToken", shareToken))
    .unique();
  if (!diagram || !diagram.shareEnabled) {
    return null;
  }
  const manifest = await readBoardSceneManifest(ctx, diagram._id);
  return {
    board: toSharedBoardSummary(diagram),
    version: manifest
      ? manifest.version
      : await readBoardContentVersion(ctx, diagram._id, diagram.contentVersion),
    access: "viewer" as const,
    ...(manifest
      ? { sceneManifest: toBoardSceneManifestSummary(manifest) }
      : null),
  };
};

export const readSharedBoardScene = async (
  ctx: QueryCtx,
  shareToken: string,
) => {
  const diagram = await ctx.db
    .query("diagrams")
    .withIndex("by_shareToken", (q) => q.eq("shareToken", shareToken))
    .unique();
  if (!diagram || !diagram.shareEnabled) {
    return null;
  }
  return await readBoardScene(ctx, diagram._id);
};

export const openOwnedBoardRecord = async (ctx: QueryCtx, slug: string) => {
  const ownerId = await requireUserId(ctx);
  const diagram = await ctx.db
    .query("diagrams")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!diagram || diagram.ownerId !== ownerId) {
    return null;
  }
  await assertBoardSceneNotMigrated(ctx, diagram._id);
  const content = await ctx.db
    .query("diagramContents")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
    .unique();
  if (!content) {
    throw new Error("Board content is missing");
  }
  return {
    board: toBoardSummary(diagram),
    sceneJson: content.sceneJson,
    version: content.version,
    access: "owner" as const,
  };
};

export const openSharedBoardRecord = async (
  ctx: QueryCtx,
  shareToken: string,
) => {
  const diagram = await ctx.db
    .query("diagrams")
    .withIndex("by_shareToken", (q) => q.eq("shareToken", shareToken))
    .unique();
  if (!diagram || !diagram.shareEnabled) {
    return null;
  }
  await assertBoardSceneNotMigrated(ctx, diagram._id);
  const content = await ctx.db
    .query("diagramContents")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
    .unique();
  if (!content) {
    throw new Error("Board content is missing");
  }
  return {
    board: toSharedBoardSummary(diagram),
    sceneJson: content.sceneJson,
    version: content.version,
    access: "viewer" as const,
  };
};

export const saveBoardRecord = async (
  ctx: MutationCtx,
  args: {
    boardId: Id<"diagrams">;
    clientSaveProtocol?: number;
    expectedVersion: number;
    sceneJson: string;
  },
  entityName: string,
) => {
  if (args.clientSaveProtocol !== CLOUD_SAVE_PROTOCOL_VERSION) {
    return { status: "upgrade-required" as const };
  }
  const ownerId = await requireUserId(ctx);
  const diagram = await ctx.db.get("diagrams", args.boardId);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error(`${entityName} not found`);
  }
  // A migrated Board only accepts the R2 commit path. A client old enough to
  // still send a whole scene is told to reload rather than silently ignored.
  if (await readBoardSceneManifest(ctx, diagram._id)) {
    return { status: "upgrade-required" as const };
  }
  assertSceneSize(args.sceneJson, entityName);
  if (
    diagram.contentVersion !== undefined &&
    diagram.contentVersion !== args.expectedVersion
  ) {
    return {
      status: "conflict" as const,
      version: diagram.contentVersion,
    };
  }
  const content = await ctx.db
    .query("diagramContents")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
    .unique();
  if (!content) {
    throw new Error(`${entityName} content is missing`);
  }
  if (content.version !== args.expectedVersion) {
    return { status: "conflict" as const, version: content.version };
  }
  if (
    content.sceneJson === args.sceneJson ||
    areScenesEquivalentIgnoringDerivedBindings(
      content.sceneJson,
      args.sceneJson,
    )
  ) {
    if (diagram.contentVersion !== content.version) {
      await ctx.db.patch("diagrams", diagram._id, {
        contentVersion: content.version,
      });
    }
    return {
      status: "saved" as const,
      version: content.version,
      updatedAt: content.updatedAt,
    };
  }
  if (hasElementVersionRegression(content.sceneJson, args.sceneJson)) {
    return { status: "conflict" as const, version: content.version };
  }
  const now = Date.now();
  await createDiagramSnapshotIfNeeded(ctx, {
    diagram,
    ownerId,
    sceneJson: content.sceneJson,
    version: content.version,
    now,
    force: false,
  });
  const version = content.version + 1;
  await ctx.db.patch("diagramContents", content._id, {
    sceneJson: args.sceneJson,
    version,
    updatedAt: now,
  });
  await ctx.db.patch("diagrams", diagram._id, {
    contentVersion: version,
    updatedAt: now,
  });
  return { status: "saved" as const, version, updatedAt: now };
};

export const renameBoardRecord = async (
  ctx: MutationCtx,
  boardId: Id<"diagrams">,
  title: string,
  entityName: string,
) => {
  const ownerId = await requireUserId(ctx);
  const diagram = await ctx.db.get("diagrams", boardId);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error(`${entityName} not found`);
  }
  const normalizedTitle = title.trim() || DEFAULT_BOARD_TITLE;
  await ctx.db.patch("diagrams", diagram._id, {
    title: normalizedTitle.slice(0, 120),
    normalizedTitle: normalizeBoardTitle(normalizedTitle.slice(0, 120)),
    updatedAt: Date.now(),
  });
};

export const moveBoardToFolderRecord = async (
  ctx: MutationCtx,
  boardId: Id<"diagrams">,
  folderId: Id<"boardFolders"> | null,
) => {
  const ownerId = await requireUserId(ctx);
  const board = await ctx.db.get("diagrams", boardId);
  if (!board || board.ownerId !== ownerId) {
    throw new Error("Board not found");
  }
  if (folderId) {
    const folder = await ctx.db.get("boardFolders", folderId);
    if (!folder || folder.ownerId !== ownerId) {
      throw new Error("Folder not found");
    }
  }
  if ((board.folderId ?? null) === folderId) {
    return;
  }
  await ctx.db.patch("diagrams", board._id, {
    folderId: folderId ?? undefined,
  });
};

export const removeBoardRecord = async (
  ctx: MutationCtx,
  boardId: Id<"diagrams">,
  entityName: string,
) => {
  const ownerId = await requireUserId(ctx);
  const diagram = await ctx.db.get("diagrams", boardId);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error(`${entityName} not found`);
  }

  const [
    content,
    assets,
    uploadGrants,
    animationAssets,
    animationUploadGrants,
    animationReadGrants,
    docPlacements,
  ] = await Promise.all([
    ctx.db
      .query("diagramContents")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .unique(),
    ctx.db
      .query("diagramAssets")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .take(2000),
    ctx.db
      .query("assetUploadGrants")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .take(1000),
    ctx.db
      .query("presentationAnimationAssets")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .take(1000),
    ctx.db
      .query("presentationAnimationUploadGrants")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .take(1000),
    ctx.db
      .query("presentationAnimationReadGrants")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .take(2000),
    ctx.db
      .query("docPlacements")
      .withIndex("by_diagramId_and_elementId", (q) =>
        q.eq("diagramId", diagram._id),
      )
      .take(1001),
  ]);

  const objectKeys = [
    ...assets.flatMap((asset) => (asset.objectKey ? [asset.objectKey] : [])),
    ...animationAssets.map((asset) => asset.objectKey),
    ...animationUploadGrants.map((grant) => grant.objectKey),
    ...(diagram.previewObjectKey ? [diagram.previewObjectKey] : []),
  ];
  const assetDeleteToken = await createAssetDeleteGrant(
    ctx,
    ownerId,
    objectKeys,
  );
  const sceneDeleteToken = await purgeBoardSceneRecords(ctx, diagram, ownerId);

  if (content) {
    await ctx.db.delete("diagramContents", content._id);
  }
  for (const asset of assets) {
    if (asset.storageId) {
      await ctx.storage.delete(asset.storageId);
    }
    await ctx.db.delete("diagramAssets", asset._id);
  }
  for (const grant of uploadGrants) {
    await ctx.db.delete("assetUploadGrants", grant._id);
  }
  for (const asset of animationAssets) {
    await ctx.db.delete("presentationAnimationAssets", asset._id);
  }
  for (const grant of animationUploadGrants) {
    await ctx.db.delete("presentationAnimationUploadGrants", grant._id);
  }
  for (const grant of animationReadGrants) {
    await ctx.db.delete("presentationAnimationReadGrants", grant._id);
  }
  if (docPlacements.length > 1000) {
    throw new Error("Board has too many Doc placement rows to remove");
  }
  for (const placement of docPlacements) {
    await ctx.db.delete("docPlacements", placement._id);
  }
  await ctx.db.delete("diagrams", diagram._id);
  await ctx.scheduler.runAfter(
    0,
    internal.snapshotRetention.deleteDiagramSnapshots,
    {
      diagramId: diagram._id,
    },
  );

  return { assetDeleteToken, sceneDeleteToken };
};

export const setBoardSharingRecord = async (
  ctx: MutationCtx,
  boardId: Id<"diagrams">,
  enabled: boolean,
  entityName: string,
) => {
  const ownerId = await requireUserId(ctx);
  const diagram = await ctx.db.get("diagrams", boardId);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error(`${entityName} not found`);
  }
  if (!enabled) {
    await ctx.db.patch("diagrams", diagram._id, {
      shareEnabled: false,
      visibility: "private",
      updatedAt: Date.now(),
    });
    return { enabled: false, shareToken: null };
  }
  const shareToken = diagram.shareToken ?? makeShareToken();
  await ctx.db.patch("diagrams", diagram._id, {
    shareEnabled: true,
    shareToken,
    visibility: "unlisted",
    updatedAt: Date.now(),
  });
  return { enabled: true, shareToken };
};
