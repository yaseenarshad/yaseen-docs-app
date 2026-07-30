import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { listBoardSnapshots, restoreBoardSnapshot } from "./historyPersistence";

const snapshotSummaryValidator = v.object({
  _id: v.id("diagramSnapshots"),
  version: v.number(),
  createdAt: v.number(),
});

export const list = query({
  args: { boardId: v.id("diagrams") },
  returns: v.array(snapshotSummaryValidator),
  handler: async (ctx, args) =>
    await listBoardSnapshots(ctx, args.boardId, "Board"),
});

export const restore = mutation({
  args: {
    boardId: v.id("diagrams"),
    snapshotId: v.id("diagramSnapshots"),
  },
  returns: v.object({
    version: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => await restoreBoardSnapshot(ctx, args, "Board"),
});
