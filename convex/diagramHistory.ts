import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { shouldCreateDiagramSnapshot } from "./snapshotPolicy";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const createDiagramSnapshotIfNeeded = async (
  ctx: MutationCtx,
  args: {
    diagramId: Id<"diagrams">;
    ownerId: Id<"users">;
    sceneJson: string;
    version: number;
    now: number;
    force: boolean;
  },
) => {
  const latestSnapshot = await ctx.db
    .query("diagramSnapshots")
    .withIndex("by_diagramId_and_version", (q) =>
      q.eq("diagramId", args.diagramId),
    )
    .order("desc")
    .first();

  if (
    latestSnapshot?.version === args.version ||
    !shouldCreateDiagramSnapshot({
      currentVersion: args.version,
      force: args.force,
      lastSnapshotAt: latestSnapshot?.createdAt ?? null,
      now: args.now,
    })
  ) {
    return false;
  }

  await ctx.db.insert("diagramSnapshots", {
    diagramId: args.diagramId,
    createdBy: args.ownerId,
    sceneJson: args.sceneJson,
    version: args.version,
    createdAt: args.now,
  });
  return true;
};

export const list = query({
  args: {
    diagramId: v.id("diagrams"),
  },
  returns: v.array(
    v.object({
      _id: v.id("diagramSnapshots"),
      version: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerId = await getAuthUserId(ctx);
    if (!ownerId) {
      throw new Error("Authentication required");
    }
    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }

    const snapshots = await ctx.db
      .query("diagramSnapshots")
      .withIndex("by_diagramId_and_version", (q) =>
        q.eq("diagramId", args.diagramId),
      )
      .order("desc")
      .take(100);
    return snapshots.map((snapshot) => ({
      _id: snapshot._id,
      version: snapshot.version,
      createdAt: snapshot.createdAt,
    }));
  },
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
  handler: async (ctx, args) => {
    const ownerId = await getAuthUserId(ctx);
    if (!ownerId) {
      throw new Error("Authentication required");
    }
    const [diagram, snapshot] = await Promise.all([
      ctx.db.get("diagrams", args.diagramId),
      ctx.db.get("diagramSnapshots", args.snapshotId),
    ]);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }
    if (!snapshot || snapshot.diagramId !== diagram._id) {
      throw new Error("Diagram snapshot not found");
    }
    const content = await ctx.db
      .query("diagramContents")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .unique();
    if (!content) {
      throw new Error("Diagram content is missing");
    }

    const updatedAt = Date.now();
    await createDiagramSnapshotIfNeeded(ctx, {
      diagramId: diagram._id,
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
    await ctx.db.patch("diagrams", diagram._id, { updatedAt });
    return { version, updatedAt };
  },
});
