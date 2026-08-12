import { v } from "convex/values";

import { runBoardSceneEdit } from "./boardSceneEditing";
import { listBoardSnapshots } from "./historyPersistence";
import { internal } from "./_generated/api";
import { action, query } from "./_generated/server";

import type { BoardSceneEditResult } from "./boardSceneEditing";

const snapshotSummaryValidator = v.object({
  _id: v.id("diagramSnapshots"),
  version: v.number(),
  createdAt: v.number(),
});

// Legacy and R2 snapshots are listed identically: a snapshot row carries either
// an inline scene or object metadata, and neither is part of this summary.
export const list = query({
  args: { boardId: v.id("diagrams") },
  returns: v.array(snapshotSummaryValidator),
  handler: async (ctx, args) =>
    await listBoardSnapshots(ctx, args.boardId, "Board"),
});

/**
 * Restoring a migrated Board privately reads the snapshot object and commits it
 * as a new current version, force-preserving the version it displaces. That
 * needs an R2 fetch, which a mutation cannot do, so the transport is an action;
 * the arguments and the result are unchanged.
 */
export const restore = action({
  args: {
    boardId: v.id("diagrams"),
    snapshotId: v.id("diagramSnapshots"),
  },
  returns: v.object({
    version: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args): Promise<BoardSceneEditResult> =>
    await runBoardSceneEdit(ctx, {
      boardId: args.boardId,
      begin: async () =>
        await ctx.runMutation(internal.boardSceneEdits.beginRestore, {
          ...args,
          entityName: "Board",
        }),
      legacy: async () =>
        await ctx.runMutation(internal.boardSceneEdits.restoreLegacySnapshot, {
          ...args,
          entityName: "Board",
        }),
      transform: (sceneJson) => sceneJson,
    }),
});
