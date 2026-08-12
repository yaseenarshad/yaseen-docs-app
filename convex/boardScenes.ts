import { v } from "convex/values";

import {
  boardSceneCommitResultValidator,
  boardSceneDeleteGrantContractValidator,
  boardSceneIntegrityFields,
  boardScenePurposeValidator,
  boardSceneReadGrantContractValidator,
  boardSceneReadGrantResultValidator,
  boardSceneUploadGrantContractValidator,
  boardSceneUploadGrantResultValidator,
} from "./boardSceneModel";
import {
  abandonBoardSceneUpload,
  commitBoardSceneUpload,
  consumeBoardSceneDeleteGrant,
  createBoardSceneReadGrant,
  createBoardSceneUploadGrant,
  listPendingBoardSceneCleanup,
  resolveBoardSceneReadGrant,
  resolveBoardSceneUploadGrant,
} from "./boardScenePersistence";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

export const createUploadGrant = mutation({
  args: {
    boardId: v.id("diagrams"),
    clientSaveProtocol: v.optional(v.number()),
    purpose: boardScenePurposeValidator,
    expectedVersion: v.number(),
    ...boardSceneIntegrityFields,
  },
  returns: boardSceneUploadGrantResultValidator,
  handler: async (ctx, args) => await createBoardSceneUploadGrant(ctx, args),
});

export const commitUpload = mutation({
  args: {
    clientSaveProtocol: v.optional(v.number()),
    token: v.string(),
    etag: v.string(),
  },
  returns: boardSceneCommitResultValidator,
  handler: async (ctx, args) => await commitBoardSceneUpload(ctx, args),
});

export const abandonUpload = mutation({
  args: { token: v.string() },
  returns: v.object({ cleanupToken: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => await abandonBoardSceneUpload(ctx, args.token),
});

export const createReadGrant = mutation({
  args: {
    boardId: v.optional(v.id("diagrams")),
    shareToken: v.optional(v.string()),
    snapshotId: v.optional(v.id("diagramSnapshots")),
  },
  returns: boardSceneReadGrantResultValidator,
  handler: async (ctx, args) => await createBoardSceneReadGrant(ctx, args),
});

export const pendingCleanup = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => await listPendingBoardSceneCleanup(ctx),
});

export const resolveUploadGrant = internalMutation({
  args: { token: v.string() },
  returns: v.union(v.null(), boardSceneUploadGrantContractValidator),
  handler: async (ctx, args) =>
    await resolveBoardSceneUploadGrant(ctx, args.token),
});

export const resolveReadGrant = internalQuery({
  args: { token: v.string() },
  returns: v.union(v.null(), boardSceneReadGrantContractValidator),
  handler: async (ctx, args) =>
    await resolveBoardSceneReadGrant(ctx, args.token),
});

export const consumeDeleteGrant = internalMutation({
  args: { token: v.string() },
  returns: v.union(v.null(), boardSceneDeleteGrantContractValidator),
  handler: async (ctx, args) =>
    await consumeBoardSceneDeleteGrant(ctx, args.token),
});
