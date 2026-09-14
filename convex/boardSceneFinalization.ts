import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import {
  BOARD_SCENE_FINALIZER_DRAIN_MS,
  BOARD_SCENE_UPLOAD_GRANT_LIFETIME_MS,
  boardSceneCommitResultValidator,
  boardSceneUploadGrantContractValidator,
  makeBoardSceneToken,
  toBoardSceneGrantContract,
} from "./boardSceneModel";
import { commitBoardSceneUpload } from "./boardScenePersistence";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
import { internalMutation } from "./_generated/server";

import type { MutationCtx } from "./_generated/server";

const stagedGrantValidator = boardSceneUploadGrantContractValidator.extend({
  stagingObjectKey: v.string(),
  expiresAt: v.number(),
  semanticSha256: v.string(),
});

const ownedGrant = async (ctx: MutationCtx, token: string) => {
  const ownerId = await getAuthUserId(ctx);
  if (!ownerId) {
    throw new Error("Authentication required");
  }
  const grant = await ctx.db
    .query("boardSceneUploadGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!grant || grant.ownerId !== ownerId || !grant.stagingObjectKey) {
    throw new Error("Board scene upload grant not found");
  }
  const board = await ctx.db.get("diagrams", grant.diagramId);
  if (!board || board.ownerId !== ownerId) {
    throw new Error("Board not found");
  }
  return grant;
};

const stagedContract = (grant: Awaited<ReturnType<typeof ownedGrant>>) => ({
  ...toBoardSceneGrantContract(grant),
  stagingObjectKey: grant.stagingObjectKey!,
  expiresAt: grant.expiresAt,
  semanticSha256: grant.semanticSha256,
});

export const prepare = internalMutation({
  args: { token: v.string() },
  returns: stagedGrantValidator,
  handler: async (ctx, { token }) => {
    const grant = await ownedGrant(ctx, token);
    if (
      grant.expiresAt <= Date.now() ||
      grant.abandonedAt !== undefined ||
      grant.finalizationId !== undefined ||
      grant.registeredAt !== undefined
    ) {
      throw new Error("Board scene upload grant expired");
    }
    return stagedContract(grant);
  },
});

export const claim = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      status: v.literal("claimed"),
      claimId: v.string(),
      grant: stagedGrantValidator,
    }),
    v.object({
      status: v.literal("finished"),
      result: boardSceneCommitResultValidator,
    }),
  ),
  handler: async (ctx, { token }) => {
    const grant = await ownedGrant(ctx, token);
    if (grant.commitResult) {
      return { status: "finished" as const, result: grant.commitResult };
    }
    if (grant.expiresAt <= Date.now() || grant.abandonedAt !== undefined) {
      throw new Error("Board scene upload grant expired");
    }
    if (grant.finalizationId) {
      throw new Error("Board scene is already being finalized");
    }
    const claimId = makeBoardSceneToken();
    await ctx.db.patch("boardSceneUploadGrants", grant._id, {
      finalizationId: claimId,
      finalizingAt: Date.now(),
    });
    return {
      status: "claimed" as const,
      claimId,
      grant: stagedContract(grant),
    };
  },
});

export const commit = internalMutation({
  args: { token: v.string(), claimId: v.string(), etag: v.string() },
  returns: boardSceneCommitResultValidator,
  handler: async (ctx, args) => {
    const grant = await ownedGrant(ctx, args.token);
    const result = await commitBoardSceneUpload(
      ctx,
      {
        clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
        token: args.token,
        etag: args.etag,
      },
      { forceSnapshot: grant.forceSnapshot ?? false, claimId: args.claimId },
    );
    if (result.status !== "upgrade-required") {
      await ctx.db.patch("boardSceneUploadGrants", grant._id, {
        commitResult: result,
      });
    }
    return result;
  },
});

// Cleanup claims are irreversible. Rows survive provider failures, and no new
// finalizer may start once cleanup has claimed a key.
export const beginCleanup = internalMutation({
  args: { grantId: v.id("boardSceneUploadGrants") },
  returns: v.union(
    v.null(),
    v.object({ objectKey: v.string() }),
    v.object({ waitUntil: v.number() }),
  ),
  handler: async (ctx, { grantId }) => {
    const grant = await ctx.db.get("boardSceneUploadGrants", grantId);
    if (!grant || !grant.stagingObjectKey) {
      return null;
    }
    if (grant.registeredAt !== undefined) {
      await ctx.db.delete("boardSceneUploadGrants", grantId);
      return null;
    }
    const now = Date.now();
    const waitUntil = Math.max(
      grant.createdAt + BOARD_SCENE_UPLOAD_GRANT_LIFETIME_MS,
      (grant.finalizingAt ?? grant.createdAt) + BOARD_SCENE_FINALIZER_DRAIN_MS,
    );
    if (grant.abandonedAt === undefined) {
      await ctx.db.patch("boardSceneUploadGrants", grantId, {
        abandonedAt: now,
      });
    }
    if (now < waitUntil) {
      return { waitUntil };
    }
    return { objectKey: grant.objectKey };
  },
});

export const finishCleanup = internalMutation({
  args: { grantId: v.id("boardSceneUploadGrants") },
  returns: v.null(),
  handler: async (ctx, { grantId }) => {
    const grant = await ctx.db.get("boardSceneUploadGrants", grantId);
    if (grant?.abandonedAt !== undefined && grant.registeredAt === undefined) {
      await ctx.db.delete("boardSceneUploadGrants", grantId);
    }
    return null;
  },
});
