import { v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";

import { mutation, query } from "./_generated/server";
import {
  createBoardRecord,
  ensureDefaultRecord,
  listOwnedBoardRecords,
  paginateOwnedBoardRecords,
  openOwnedBoardMetadata,
  openOwnedBoardRecord,
  openSharedBoardMetadata,
  openSharedBoardRecord,
  moveBoardToFolderRecord,
  readOwnedBoardScene,
  readSharedBoardScene,
  removeBoardRecord,
  renameBoardRecord,
  saveBoardRecord,
  setBoardSharingRecord,
} from "./boardPersistence";
import { boardPreviewSummaryValidator } from "./boardPreviewModel";
import { boardSceneManifestSummaryValidator } from "./boardSceneModel";

const boardSortValidator = v.union(
  v.literal("name-asc"),
  v.literal("name-desc"),
  v.literal("created-desc"),
  v.literal("created-asc"),
  v.literal("modified-desc"),
  v.literal("modified-asc"),
);

const sharedBoardSummaryValidator = v.object({
  _id: v.id("diagrams"),
  slug: v.string(),
  title: v.string(),
  visibility: v.union(
    v.literal("private"),
    v.literal("unlisted"),
    v.literal("public"),
  ),
  shareEnabled: v.boolean(),
  folderId: v.optional(v.id("boardFolders")),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const boardSummaryValidator = sharedBoardSummaryValidator.extend({
  preview: boardPreviewSummaryValidator,
});

const openedOwnedBoardValidator = v.object({
  board: boardSummaryValidator,
  sceneJson: v.string(),
  version: v.number(),
  access: v.union(v.literal("owner"), v.literal("viewer")),
});

const openedSharedBoardValidator = v.object({
  board: sharedBoardSummaryValidator,
  sceneJson: v.string(),
  version: v.number(),
  access: v.literal("viewer"),
});

// A migrated Board carries small manifest metadata instead of a scene. The
// object key is never part of it: only a capability can name a scene object.
const openedOwnedBoardMetadataValidator = openedOwnedBoardValidator
  .omit("sceneJson")
  .extend({ sceneManifest: v.optional(boardSceneManifestSummaryValidator) });

const openedSharedBoardMetadataValidator = openedSharedBoardValidator
  .omit("sceneJson")
  .extend({ sceneManifest: v.optional(boardSceneManifestSummaryValidator) });

const boardSceneValidator = v.object({
  boardId: v.id("diagrams"),
  sceneJson: v.string(),
  version: v.number(),
});

export const ensureDefault = mutation({
  args: {},
  returns: v.object({
    boardId: v.id("diagrams"),
    slug: v.string(),
  }),
  handler: async (ctx) => {
    const result = await ensureDefaultRecord(ctx, "Board");
    return { boardId: result.diagramId, slug: result.slug };
  },
});

export const create = mutation({
  args: { title: v.string() },
  returns: v.object({
    boardId: v.id("diagrams"),
    slug: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await createBoardRecord(ctx, args.title, "Board");
    return { boardId: result.diagramId, slug: result.slug };
  },
});

export const listMine = query({
  args: {},
  returns: v.array(boardSummaryValidator),
  handler: async (ctx) => await listOwnedBoardRecords(ctx),
});

export const listMinePaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: v.optional(boardSortValidator),
    query: v.optional(v.string()),
  },
  returns: paginationResultValidator(boardSummaryValidator),
  handler: async (ctx, args) =>
    await paginateOwnedBoardRecords(
      ctx,
      args.paginationOpts,
      args.sort ?? "modified-desc",
      args.query ?? "",
    ),
});

export const openMine = query({
  args: { slug: v.string() },
  returns: v.union(v.null(), openedOwnedBoardValidator),
  handler: async (ctx, args) => await openOwnedBoardRecord(ctx, args.slug),
});

export const openShared = query({
  args: { shareToken: v.string() },
  returns: v.union(v.null(), openedSharedBoardValidator),
  handler: async (ctx, args) =>
    await openSharedBoardRecord(ctx, args.shareToken),
});

// `openMineMetadata` and `openSharedMetadata` are the reactive subscriptions:
// they carry no scene, so a save no longer re-streams the whole Board to every
// subscribed tab. Their scene counterparts are fetched once per version change.
export const openMineMetadata = query({
  args: { slug: v.string() },
  returns: v.union(v.null(), openedOwnedBoardMetadataValidator),
  handler: async (ctx, args) => await openOwnedBoardMetadata(ctx, args.slug),
});

export const openMineScene = query({
  args: { slug: v.string() },
  returns: v.union(v.null(), boardSceneValidator),
  handler: async (ctx, args) => await readOwnedBoardScene(ctx, args.slug),
});

export const openSharedMetadata = query({
  args: { shareToken: v.string() },
  returns: v.union(v.null(), openedSharedBoardMetadataValidator),
  handler: async (ctx, args) =>
    await openSharedBoardMetadata(ctx, args.shareToken),
});

export const openSharedScene = query({
  args: { shareToken: v.string() },
  returns: v.union(v.null(), boardSceneValidator),
  handler: async (ctx, args) =>
    await readSharedBoardScene(ctx, args.shareToken),
});

export const save = mutation({
  args: {
    boardId: v.id("diagrams"),
    clientSaveProtocol: v.optional(v.number()),
    expectedVersion: v.number(),
    sceneJson: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.literal("saved"),
      version: v.number(),
      updatedAt: v.number(),
    }),
    v.object({
      status: v.literal("conflict"),
      version: v.number(),
    }),
    v.object({
      status: v.literal("upgrade-required"),
    }),
  ),
  handler: async (ctx, args) => await saveBoardRecord(ctx, args, "Board"),
});

export const rename = mutation({
  args: {
    boardId: v.id("diagrams"),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await renameBoardRecord(ctx, args.boardId, args.title, "Board");
    return null;
  },
});

export const moveToFolder = mutation({
  args: {
    boardId: v.id("diagrams"),
    folderId: v.union(v.id("boardFolders"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await moveBoardToFolderRecord(ctx, args.boardId, args.folderId);
    return null;
  },
});

export const remove = mutation({
  args: { boardId: v.id("diagrams") },
  returns: v.object({
    assetDeleteToken: v.union(v.string(), v.null()),
    sceneDeleteToken: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) =>
    await removeBoardRecord(ctx, args.boardId, "Board"),
});

export const setSharing = mutation({
  args: {
    boardId: v.id("diagrams"),
    enabled: v.boolean(),
  },
  returns: v.object({
    enabled: v.boolean(),
    shareToken: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) =>
    await setBoardSharingRecord(ctx, args.boardId, args.enabled, "Board"),
});
