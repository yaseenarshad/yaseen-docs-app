import { v } from "convex/values";

import { createBoardSceneDeleteGrant } from "./boardScenePersistence";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

import type { Id } from "./_generated/dataModel";

const GRANT_PAGE_SIZE = 100;

/**
 * Bounded, idempotent and safe to repeat: expired coordination rows are dropped
 * and the objects an unregistered upload may have left behind are re-offered as
 * cleanup work. A committed scene is never touched.
 */
export const pruneExpiredGrants = internalMutation({
  args: {},
  returns: v.object({
    uploadGrants: v.number(),
    readGrants: v.number(),
    deleteGrants: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const [uploadGrants, readGrants, deleteGrants] = await Promise.all([
      ctx.db
        .query("boardSceneUploadGrants")
        .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
        .order("asc")
        .take(GRANT_PAGE_SIZE),
      ctx.db
        .query("boardSceneReadGrants")
        .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
        .order("asc")
        .take(GRANT_PAGE_SIZE),
      ctx.db
        .query("boardSceneDeleteGrants")
        .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
        .order("asc")
        .take(GRANT_PAGE_SIZE),
    ]);

    const orphansByOwner = new Map<Id<"users">, string[]>();
    for (const grant of uploadGrants) {
      if (grant.stagingObjectKey && grant.registeredAt === undefined) {
        // Retain a durable tombstone until R2 confirms deletion. Move it out of
        // this expiry page so a provider outage cannot cause a tight scan loop.
        await ctx.db.patch("boardSceneUploadGrants", grant._id, {
          abandonedAt: grant.abandonedAt ?? now,
          expiresAt: now + 60 * 60 * 1000,
        });
        await ctx.scheduler.runAfter(0, internal.boardSceneUploads.cleanup, {
          grantId: grant._id,
        });
        continue;
      }
      if (grant.registeredAt === undefined) {
        orphansByOwner.set(grant.ownerId, [
          ...(orphansByOwner.get(grant.ownerId) ?? []),
          grant.objectKey,
        ]);
      }
      await ctx.db.delete("boardSceneUploadGrants", grant._id);
    }
    for (const [ownerId, objectKeys] of orphansByOwner) {
      await createBoardSceneDeleteGrant(ctx, { ownerId, objectKeys });
    }
    for (const grant of readGrants) {
      await ctx.db.delete("boardSceneReadGrants", grant._id);
    }
    for (const grant of deleteGrants) {
      await ctx.db.delete("boardSceneDeleteGrants", grant._id);
    }

    const continuationScheduled =
      uploadGrants.length === GRANT_PAGE_SIZE ||
      readGrants.length === GRANT_PAGE_SIZE ||
      deleteGrants.length === GRANT_PAGE_SIZE;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.boardSceneCleanup.pruneExpiredGrants,
        {},
      );
    }

    return {
      uploadGrants: uploadGrants.length,
      readGrants: readGrants.length,
      deleteGrants: deleteGrants.length,
      continuationScheduled,
    };
  },
});

export const startCleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.boardSceneCleanup.pruneExpiredGrants,
      {},
    );
    return null;
  },
});
