import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import {
  createDocContentDeleteGrant,
  removeSnapshotAssetReferences,
} from "./docContentPersistence";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import {
  MINIMUM_RETAINED_SNAPSHOTS,
  selectExpiredDiagramSnapshotIds,
  SNAPSHOT_RETENTION_MS,
  shouldContinueSnapshotBatchCleanup,
} from "./snapshotPolicy";
import { getDocsMode } from "./docsMode";

const DOC_PAGE_SIZE = 20;
const SNAPSHOT_PAGE_SIZE = 20;

export const startDailyCleanup = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    if (getDocsMode() !== "on") {
      return 0;
    }
    const cutoff = Date.now() - SNAPSHOT_RETENTION_MS;
    await ctx.scheduler.runAfter(
      0,
      internal.docSnapshotRetention.pruneDocPage,
      {
        cutoff,
        paginationOpts: { numItems: DOC_PAGE_SIZE, cursor: null },
      },
    );
    return cutoff;
  },
});

export const pruneDocPage = internalMutation({
  args: { cutoff: v.number(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    docsScheduled: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("docs")
      .order("asc")
      .paginate(args.paginationOpts);
    for (const doc of page.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.docSnapshotRetention.collectRetentionFloor,
        {
          docId: doc._id,
          cutoff: args.cutoff,
          retainedIds: [],
          paginationOpts: { numItems: SNAPSHOT_PAGE_SIZE, cursor: null },
        },
      );
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.docSnapshotRetention.pruneDocPage,
        {
          cutoff: args.cutoff,
          paginationOpts: {
            ...args.paginationOpts,
            cursor: page.continueCursor,
          },
        },
      );
    }
    return {
      docsScheduled: page.page.length,
      continuationScheduled: !page.isDone,
    };
  },
});

export const collectRetentionFloor = internalMutation({
  args: {
    docId: v.id("docs"),
    cutoff: v.number(),
    retainedIds: v.array(v.id("docContentSnapshots")),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    retainedSnapshots: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("docContentSnapshots")
      .withIndex("by_docId_and_createdAt", (q) => q.eq("docId", args.docId))
      .order("desc")
      .paginate(args.paginationOpts);
    const remainingFloor = MINIMUM_RETAINED_SNAPSHOTS - args.retainedIds.length;
    const retainedIds = [
      ...args.retainedIds,
      ...page.page.slice(0, remainingFloor).map((snapshot) => snapshot._id),
    ];
    if (retainedIds.length >= MINIMUM_RETAINED_SNAPSHOTS || page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.docSnapshotRetention.pruneSnapshots,
        { docId: args.docId, cutoff: args.cutoff, retainedIds },
      );
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.docSnapshotRetention.collectRetentionFloor,
        {
          ...args,
          retainedIds,
          paginationOpts: {
            ...args.paginationOpts,
            cursor: page.continueCursor,
          },
        },
      );
    }
    return {
      retainedSnapshots: retainedIds.length,
      continuationScheduled: true,
    };
  },
});

export const pruneSnapshots = internalMutation({
  args: {
    docId: v.id("docs"),
    cutoff: v.number(),
    retainedIds: v.array(v.id("docContentSnapshots")),
  },
  returns: v.object({
    deleted: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("docContentSnapshots")
      .withIndex("by_docId_and_createdAt", (q) =>
        q.eq("docId", args.docId).lt("createdAt", args.cutoff),
      )
      .order("asc")
      .paginate({ numItems: SNAPSHOT_PAGE_SIZE, cursor: null });
    const retainedIds = new Set(args.retainedIds);
    const candidates = page.page.filter(
      (snapshot) => !retainedIds.has(snapshot._id),
    );
    const idsToDelete = selectExpiredDiagramSnapshotIds({
      snapshotsNewestFirst: [
        ...args.retainedIds.map((id) => ({ id, createdAt: args.cutoff })),
        ...candidates.toReversed().map((snapshot) => ({
          id: snapshot._id,
          createdAt: snapshot.createdAt,
        })),
      ],
      cutoff: args.cutoff,
      minimumRetained: args.retainedIds.length,
    });
    const deleting = new Set(idsToDelete);
    const objectKeys = candidates
      .filter((snapshot) => deleting.has(snapshot._id))
      .map((snapshot) => snapshot.objectKey);
    const doc =
      objectKeys.length > 0 ? await ctx.db.get("docs", args.docId) : null;
    if (doc && objectKeys.length > 0) {
      await createDocContentDeleteGrant(ctx, {
        ownerId: doc.ownerId,
        docId: doc._id,
        objectKeys,
      });
    }
    for (const snapshotId of idsToDelete) {
      const snapshot = await ctx.db.get("docContentSnapshots", snapshotId);
      if (snapshot) {
        await removeSnapshotAssetReferences(ctx, {
          docId: snapshot.docId,
          version: snapshot.version,
          now: Date.now(),
        });
      }
      await ctx.db.delete("docContentSnapshots", snapshotId);
    }
    const continuationScheduled = shouldContinueSnapshotBatchCleanup({
      deleted: idsToDelete.length,
      pageSize: page.page.length,
      isDone: page.isDone,
    });
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.docSnapshotRetention.pruneSnapshots,
        args,
      );
    }
    return { deleted: idsToDelete.length, continuationScheduled };
  },
});
