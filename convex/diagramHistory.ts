import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  createDiagramSnapshotIfNeeded,
  listBoardSnapshots,
  restoreBoardSnapshot,
} from "./historyPersistence";

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

export const restore = mutation({
  args: {
    diagramId: v.id("diagrams"),
    snapshotId: v.id("diagramSnapshots"),
  },
  returns: v.object({
    version: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) =>
    await restoreBoardSnapshot(
      ctx,
      { boardId: args.diagramId, snapshotId: args.snapshotId },
      "Diagram",
    ),
});
