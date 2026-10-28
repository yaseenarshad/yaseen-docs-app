import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  createBoardRecord,
  ensureDefaultRecord,
  listOwnedBoardRecords,
  openOwnedBoardRecord,
  openSharedBoardRecord,
  removeBoardRecord,
  renameBoardRecord,
  saveBoardRecord,
  setBoardSharingRecord,
} from "./boardPersistence";
import { boardPreviewSummaryValidator } from "./boardPreviewModel";

const sharedDiagramSummaryValidator = v.object({
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

const diagramSummaryValidator = sharedDiagramSummaryValidator.extend({
  preview: boardPreviewSummaryValidator,
});

const openedOwnedDiagramValidator = v.object({
  diagram: diagramSummaryValidator,
  sceneJson: v.string(),
  version: v.number(),
  access: v.union(v.literal("owner"), v.literal("viewer")),
});

const openedSharedDiagramValidator = v.object({
  diagram: sharedDiagramSummaryValidator,
  sceneJson: v.string(),
  version: v.number(),
  access: v.literal("viewer"),
});

export const ensureDefault = mutation({
  args: {},
  returns: v.object({
    diagramId: v.id("diagrams"),
    slug: v.string(),
  }),
  handler: async (ctx) => await ensureDefaultRecord(ctx, "Diagram"),
});

export const create = mutation({
  args: { title: v.string() },
  returns: v.object({
    diagramId: v.id("diagrams"),
    slug: v.string(),
  }),
  handler: async (ctx, args) =>
    await createBoardRecord(ctx, args.title, "Diagram"),
});

export const listMine = query({
  args: {},
  returns: v.array(diagramSummaryValidator),
  handler: async (ctx) => await listOwnedBoardRecords(ctx),
});

export const openMine = query({
  args: { slug: v.string() },
  returns: v.union(v.null(), openedOwnedDiagramValidator),
  handler: async (ctx, args) => {
    const opened = await openOwnedBoardRecord(ctx, args.slug);
    if (!opened) {
      return null;
    }
    const { board, ...content } = opened;
    return { ...content, diagram: board };
  },
});

export const openShared = query({
  args: { shareToken: v.string() },
  returns: v.union(v.null(), openedSharedDiagramValidator),
  handler: async (ctx, args) => {
    const opened = await openSharedBoardRecord(ctx, args.shareToken);
    if (!opened) {
      return null;
    }
    const { board, ...content } = opened;
    return { ...content, diagram: board };
  },
});

export const save = mutation({
  args: {
    diagramId: v.id("diagrams"),
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
  handler: async (ctx, args) =>
    await saveBoardRecord(
      ctx,
      {
        boardId: args.diagramId,
        clientSaveProtocol: args.clientSaveProtocol,
        expectedVersion: args.expectedVersion,
        sceneJson: args.sceneJson,
      },
      "Diagram",
    ),
});

export const rename = mutation({
  args: {
    diagramId: v.id("diagrams"),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await renameBoardRecord(ctx, args.diagramId, args.title, "Diagram");
    return null;
  },
});

export const remove = mutation({
  args: { diagramId: v.id("diagrams") },
  returns: v.object({
    assetDeleteToken: v.union(v.string(), v.null()),
    sceneDeleteToken: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) =>
    await removeBoardRecord(ctx, args.diagramId, "Diagram"),
});

export const setSharing = mutation({
  args: {
    diagramId: v.id("diagrams"),
    enabled: v.boolean(),
  },
  returns: v.object({
    enabled: v.boolean(),
    shareToken: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) =>
    await setBoardSharingRecord(ctx, args.diagramId, args.enabled, "Diagram"),
});
