import { getAuthUserId } from "@convex-dev/auth/server";

import { shouldCreateDiagramSnapshot } from "./snapshotPolicy";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Reading the newest snapshot document costs a full scene read on every save,
// so snapshot timing lives on the small diagram row instead. Boards written
// before those fields existed are backfilled from the snapshot table once.
const readDiagramSnapshotTiming = async (
  ctx: MutationCtx,
  diagram: Doc<"diagrams">,
) => {
  if (
    diagram.lastSnapshotAt !== undefined &&
    diagram.lastSnapshotVersion !== undefined
  ) {
    return {
      lastSnapshotAt: diagram.lastSnapshotAt,
      lastSnapshotVersion: diagram.lastSnapshotVersion,
    };
  }
  const latestSnapshot = await ctx.db
    .query("diagramSnapshots")
    .withIndex("by_diagramId_and_version", (q) => q.eq("diagramId", diagram._id))
    .order("desc")
    .first();
  if (!latestSnapshot) {
    return { lastSnapshotAt: null, lastSnapshotVersion: null };
  }
  await ctx.db.patch("diagrams", diagram._id, {
    lastSnapshotAt: latestSnapshot.createdAt,
    lastSnapshotVersion: latestSnapshot.version,
  });
  return {
    lastSnapshotAt: latestSnapshot.createdAt,
    lastSnapshotVersion: latestSnapshot.version,
  };
};

export const createDiagramSnapshotIfNeeded = async (
  ctx: MutationCtx,
  args: {
    diagram: Doc<"diagrams">;
    ownerId: Id<"users">;
    sceneJson: string;
    version: number;
    now: number;
    force: boolean;
  },
) => {
  const timing = await readDiagramSnapshotTiming(ctx, args.diagram);

  if (
    timing.lastSnapshotVersion === args.version ||
    !shouldCreateDiagramSnapshot({
      currentVersion: args.version,
      force: args.force,
      lastSnapshotAt: timing.lastSnapshotAt,
      now: args.now,
    })
  ) {
    return false;
  }

  await ctx.db.insert("diagramSnapshots", {
    diagramId: args.diagram._id,
    createdBy: args.ownerId,
    sceneJson: args.sceneJson,
    version: args.version,
    createdAt: args.now,
  });
  await ctx.db.patch("diagrams", args.diagram._id, {
    lastSnapshotAt: args.now,
    lastSnapshotVersion: args.version,
  });
  return true;
};

export const listBoardSnapshots = async (
  ctx: QueryCtx,
  boardId: Id<"diagrams">,
  entityName: string,
) => {
  const ownerId = await getAuthUserId(ctx);
  if (!ownerId) {
    throw new Error("Authentication required");
  }
  const diagram = await ctx.db.get("diagrams", boardId);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error(`${entityName} not found`);
  }

  const snapshots = await ctx.db
    .query("diagramSnapshots")
    .withIndex("by_diagramId_and_version", (q) => q.eq("diagramId", boardId))
    .order("desc")
    .take(100);
  return snapshots.map((snapshot) => ({
    _id: snapshot._id,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
  }));
};

export const restoreBoardSnapshot = async (
  ctx: MutationCtx,
  args: {
    boardId: Id<"diagrams">;
    snapshotId: Id<"diagramSnapshots">;
  },
  entityName: string,
) => {
  const ownerId = await getAuthUserId(ctx);
  if (!ownerId) {
    throw new Error("Authentication required");
  }
  const [diagram, snapshot] = await Promise.all([
    ctx.db.get("diagrams", args.boardId),
    ctx.db.get("diagramSnapshots", args.snapshotId),
  ]);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error(`${entityName} not found`);
  }
  if (!snapshot || snapshot.diagramId !== diagram._id) {
    throw new Error(`${entityName} snapshot not found`);
  }
  const content = await ctx.db
    .query("diagramContents")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
    .unique();
  if (!content) {
    throw new Error(`${entityName} content is missing`);
  }

  const updatedAt = Date.now();
  await createDiagramSnapshotIfNeeded(ctx, {
    diagram,
    ownerId,
    sceneJson: content.sceneJson,
    version: content.version,
    now: updatedAt,
    force: true,
  });

  const version = content.version + 1;
  await ctx.db.patch("diagramContents", content._id, {
    sceneJson: snapshot.sceneJson,
    version,
    updatedAt,
  });
  await ctx.db.patch("diagrams", diagram._id, {
    contentVersion: version,
    updatedAt,
  });
  return { version, updatedAt };
};
