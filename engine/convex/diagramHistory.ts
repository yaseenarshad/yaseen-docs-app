import { v } from "convex/values";

import { runBoardSceneEdit } from "./boardSceneEditing";
import {
  createDiagramSnapshotIfNeeded,
  listBoardSnapshots,
} from "./historyPersistence";
import { internal } from "./_generated/api";
import { action, query } from "./_generated/server";

import type { BoardSceneEditResult } from "./boardSceneEditing";

export { createDiagramSnapshotIfNeeded };

const snapshotSummaryValidator = v.object({
  _id: v.id("diagramSnapshots"),
  version: v.number(),
  createdAt: v.number(),
});

export const list = query({
  args: { diagramId: v.id("diagrams") },
  returns: v.array(snapshotSummaryValidator),
  handler: async (ctx, args) =>
    await listBoardSnapshots(ctx, args.diagramId, "Diagram"),
});

export const restore = action({
  args: {
    diagramId: v.id("diagrams"),
    snapshotId: v.id("diagramSnapshots"),
  },
  returns: v.object({
    version: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args): Promise<BoardSceneEditResult> =>
    await runBoardSceneEdit(ctx, {
      boardId: args.diagramId,
      begin: async () =>
        await ctx.runMutation(internal.boardSceneEdits.beginRestore, {
          boardId: args.diagramId,
          snapshotId: args.snapshotId,
          entityName: "Diagram",
        }),
      legacy: async () =>
        await ctx.runMutation(internal.boardSceneEdits.restoreLegacySnapshot, {
          boardId: args.diagramId,
          snapshotId: args.snapshotId,
          entityName: "Diagram",
        }),
      transform: (sceneJson) => sceneJson,
    }),
});
