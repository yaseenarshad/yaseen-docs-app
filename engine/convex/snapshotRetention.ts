import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { createBoardSceneDeleteGrant } from "./boardScenePersistence";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import {
  MINIMUM_RETAINED_SNAPSHOTS,
  selectExpiredDiagramSnapshotIds,
  SNAPSHOT_RETENTION_MS,
  shouldContinueSnapshotBatchCleanup,
} from "./snapshotPolicy";

const DIAGRAM_PAGE_SIZE = 20;
const SNAPSHOT_PAGE_SIZE = 20;
const MAXIMUM_SNAPSHOT_BYTES_PER_PAGE = 4 * 1024 * 1024;

export const startDailyCleanup = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - SNAPSHOT_RETENTION_MS;
    await ctx.scheduler.runAfter(
      0,
      internal.snapshotRetention.pruneDiagramPage,
      {
        cutoff,
        paginationOpts: {
          numItems: DIAGRAM_PAGE_SIZE,
          cursor: null,
        },
      },
    );
    return cutoff;
  },
});

export const pruneDiagramPage = internalMutation({
  args: {
    cutoff: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    diagramsScheduled: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("diagrams")
      .order("asc")
      .paginate(args.paginationOpts);

    for (const diagram of page.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.snapshotRetention.collectRetentionFloor,
        {
          diagramId: diagram._id,
          cutoff: args.cutoff,
          retainedIds: [],
          paginationOpts: {
            numItems: SNAPSHOT_PAGE_SIZE,
            cursor: null,
            maximumBytesRead: MAXIMUM_SNAPSHOT_BYTES_PER_PAGE,
          },
        },
      );
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.snapshotRetention.pruneDiagramPage,
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
      diagramsScheduled: page.page.length,
      continuationScheduled: !page.isDone,
    };
  },
});

export const collectRetentionFloor = internalMutation({
  args: {
    diagramId: v.id("diagrams"),
    cutoff: v.number(),
    retainedIds: v.array(v.id("diagramSnapshots")),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    retainedSnapshots: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("diagramSnapshots")
      .withIndex("by_diagramId_and_createdAt", (q) =>
        q.eq("diagramId", args.diagramId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const remainingFloor = MINIMUM_RETAINED_SNAPSHOTS - args.retainedIds.length;
    const retainedIds = [
      ...args.retainedIds,
      ...page.page.slice(0, remainingFloor).map((snapshot) => snapshot._id),
    ];
    const floorComplete =
      retainedIds.length >= MINIMUM_RETAINED_SNAPSHOTS || page.isDone;

    if (floorComplete) {
      await ctx.scheduler.runAfter(
        0,
        internal.snapshotRetention.pruneDiagramSnapshots,
        {
          diagramId: args.diagramId,
          cutoff: args.cutoff,
          retainedIds,
        },
      );
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.snapshotRetention.collectRetentionFloor,
        {
          diagramId: args.diagramId,
          cutoff: args.cutoff,
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

export const pruneDiagramSnapshots = internalMutation({
  args: {
    diagramId: v.id("diagrams"),
    cutoff: v.number(),
    retainedIds: v.array(v.id("diagramSnapshots")),
  },
  returns: v.object({
    deleted: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("diagramSnapshots")
      .withIndex("by_diagramId_and_createdAt", (q) =>
        q.eq("diagramId", args.diagramId).lt("createdAt", args.cutoff),
      )
      .order("asc")
      .paginate({
        numItems: SNAPSHOT_PAGE_SIZE,
        cursor: null,
        maximumBytesRead: MAXIMUM_SNAPSHOT_BYTES_PER_PAGE,
      });
    const retainedIds = new Set(args.retainedIds);
    const expiredSnapshotsOutsideRetentionFloor = page.page.filter(
      (snapshot) => !retainedIds.has(snapshot._id),
    );
    const snapshotIdsToDelete = selectExpiredDiagramSnapshotIds({
      snapshotsNewestFirst: [
        ...args.retainedIds.map((id) => ({
          id,
          createdAt: args.cutoff,
        })),
        ...expiredSnapshotsOutsideRetentionFloor
          .toReversed()
          .map((snapshot) => ({
            id: snapshot._id,
            createdAt: snapshot.createdAt,
          })),
      ],
      cutoff: args.cutoff,
      minimumRetained: args.retainedIds.length,
    });

    const deletedIds = new Set(snapshotIdsToDelete);
    // Retiring an R2 snapshot must also retire its object, through the same
    // idempotent capability the rest of the cleanup uses.
    const expiredObjectKeys = expiredSnapshotsOutsideRetentionFloor.flatMap(
      (snapshot) =>
        deletedIds.has(snapshot._id) && snapshot.objectKey
          ? [snapshot.objectKey]
          : [],
    );
    if (expiredObjectKeys.length > 0) {
      const diagram = await ctx.db.get("diagrams", args.diagramId);
      if (diagram) {
        await createBoardSceneDeleteGrant(ctx, {
          ownerId: diagram.ownerId,
          diagramId: diagram._id,
          objectKeys: expiredObjectKeys,
        });
      }
    }

    for (const snapshotId of snapshotIdsToDelete) {
      await ctx.db.delete("diagramSnapshots", snapshotId);
    }

    const continuationScheduled = shouldContinueSnapshotBatchCleanup({
      deleted: snapshotIdsToDelete.length,
      pageSize: page.page.length,
      isDone: page.isDone,
    });
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.snapshotRetention.pruneDiagramSnapshots,
        args,
      );
    }

    return {
      deleted: snapshotIdsToDelete.length,
      continuationScheduled,
    };
  },
});

export const deleteDiagramSnapshots = internalMutation({
  args: {
    diagramId: v.id("diagrams"),
  },
  returns: v.object({
    deleted: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("diagramSnapshots")
      .withIndex("by_diagramId_and_version", (q) =>
        q.eq("diagramId", args.diagramId),
      )
      .order("asc")
      .paginate({
        numItems: SNAPSHOT_PAGE_SIZE,
        cursor: null,
        maximumBytesRead: MAXIMUM_SNAPSHOT_BYTES_PER_PAGE,
      });

    for (const snapshot of page.page) {
      await ctx.db.delete("diagramSnapshots", snapshot._id);
    }

    const continuationScheduled = shouldContinueSnapshotBatchCleanup({
      deleted: page.page.length,
      pageSize: page.page.length,
      isDone: page.isDone,
    });
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.snapshotRetention.deleteDiagramSnapshots,
        args,
      );
    }

    return {
      deleted: page.page.length,
      continuationScheduled,
    };
  },
});
