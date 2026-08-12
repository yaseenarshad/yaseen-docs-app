import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import {
  createInternalBoardSceneReadGrant,
  readBoardSceneManifest,
} from "./boardScenePersistence";
import { downloadBoardSceneObject } from "./boardSceneTransport";
import { boardSceneReadGrantResultValidator } from "./boardSceneModel";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";

/**
 * The observation-window tool for GRO-1426. Dual-read stays in place until this
 * is run: a migrated Board keeps its legacy `diagramContents` row until the R2
 * object that replaced it has been read back and verified byte for byte.
 *
 * Nothing schedules this. It is invoked explicitly, one bounded page at a time,
 * and it is safe to repeat: a Board whose row is already gone is simply
 * skipped, and a Board whose object fails verification keeps its row.
 */

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;
/** One page of manifests is small; the legacy rows behind them are not. */
const MAXIMUM_CONTENT_BYTES_PER_PAGE = 8 * 1024 * 1024;

export const pageMigratedBoards = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    boardIds: v.array(v.id("diagrams")),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("diagramSceneManifests")
      .order("asc")
      .paginate(args.paginationOpts);
    return {
      boardIds: page.page.map((manifest) => manifest.diagramId),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/**
 * Mints the capability the read-back needs. Deliberately does not touch the
 * legacy row: proving the object is good comes first, and the large read only
 * happens on the removal that follows.
 */
export const beginLegacyContentRemoval = internalMutation({
  args: { boardId: v.id("diagrams") },
  returns: v.union(
    v.null(),
    v.object({
      version: v.number(),
      grant: boardSceneReadGrantResultValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const manifest = await readBoardSceneManifest(ctx, args.boardId);
    if (!manifest) {
      return null;
    }
    const grant = await createInternalBoardSceneReadGrant(ctx, args.boardId);
    return grant ? { version: manifest.version, grant } : null;
  },
});

/**
 * Removes the legacy row only if the Board is still migrated at exactly the
 * version that was verified. Anything else — a save that landed in between, a
 * row that has already gone — leaves the row alone.
 */
export const finishLegacyContentRemoval = internalMutation({
  args: { boardId: v.id("diagrams"), verifiedVersion: v.number() },
  returns: v.union(
    v.literal("removed"),
    v.literal("absent"),
    v.literal("superseded"),
  ),
  handler: async (ctx, args) => {
    const manifest = await readBoardSceneManifest(ctx, args.boardId);
    if (!manifest || manifest.version !== args.verifiedVersion) {
      return "superseded";
    }
    const content = await ctx.db
      .query("diagramContents")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", args.boardId))
      .unique();
    if (!content) {
      return "absent";
    }
    await ctx.db.delete("diagramContents", content._id);
    return "removed";
  },
});

export const removeVerifiedLegacyContents = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    examined: v.number(),
    removed: v.number(),
    alreadyRemoved: v.number(),
    kept: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    examined: number;
    removed: number;
    alreadyRemoved: number;
    kept: number;
    isDone: boolean;
    continueCursor: string;
  }> => {
    const page: {
      boardIds: string[];
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.legacyBoardContent.pageMigratedBoards, {
      paginationOpts: {
        numItems: Math.min(
          Math.max(args.batchSize ?? DEFAULT_BATCH_SIZE, 1),
          MAX_BATCH_SIZE,
        ),
        cursor: args.cursor ?? null,
        maximumBytesRead: MAXIMUM_CONTENT_BYTES_PER_PAGE,
      },
    });

    let removed = 0;
    let alreadyRemoved = 0;
    let kept = 0;
    for (const boardId of page.boardIds) {
      const prepared = await ctx.runMutation(
        internal.legacyBoardContent.beginLegacyContentRemoval,
        { boardId: boardId as never },
      );
      if (!prepared) {
        kept += 1;
        continue;
      }
      try {
        await downloadBoardSceneObject(prepared.grant.path, prepared.grant);
      } catch (error) {
        // Verification is the whole point: an object that cannot be read back
        // keeps its legacy row, and the Board is reported rather than retried.
        console.warn(
          `Board scene read-back failed for ${boardId}; keeping its legacy scene`,
          error instanceof Error ? error.message : error,
        );
        kept += 1;
        continue;
      }
      const outcome = await ctx.runMutation(
        internal.legacyBoardContent.finishLegacyContentRemoval,
        { boardId: boardId as never, verifiedVersion: prepared.version },
      );
      if (outcome === "removed") {
        removed += 1;
      } else if (outcome === "absent") {
        alreadyRemoved += 1;
      } else {
        kept += 1;
      }
    }

    return {
      examined: page.boardIds.length,
      removed,
      alreadyRemoved,
      kept,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
