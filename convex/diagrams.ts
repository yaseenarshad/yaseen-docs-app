import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const MAX_SCENE_BYTES = 900_000;
const EMPTY_SCENE_JSON = JSON.stringify({
  elements: [],
  appState: {},
  files: {},
});

const diagramSummaryValidator = v.object({
  _id: v.id("diagrams"),
  slug: v.string(),
  title: v.string(),
  visibility: v.union(
    v.literal("private"),
    v.literal("unlisted"),
    v.literal("public"),
  ),
  shareEnabled: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const openedDiagramValidator = v.object({
  diagram: diagramSummaryValidator,
  sceneJson: v.string(),
  version: v.number(),
  access: v.union(v.literal("owner"), v.literal("viewer")),
});

const requireUserId = async (ctx: QueryCtx | MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
};

const makeSlug = () => crypto.randomUUID().replaceAll("-", "").slice(0, 20);

const makeShareToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

const assertSceneSize = (sceneJson: string) => {
  const bytes = new TextEncoder().encode(sceneJson).byteLength;
  if (bytes > MAX_SCENE_BYTES) {
    throw new Error(
      "This diagram is too large to save as one scene. Remove embedded data or split the diagram.",
    );
  }
};

const getUniqueSlug = async (ctx: MutationCtx) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = makeSlug();
    const existing = await ctx.db
      .query("diagrams")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!existing) {
      return slug;
    }
  }
  throw new Error("Could not generate a unique diagram URL");
};

const createDiagram = async (
  ctx: MutationCtx,
  ownerId: Id<"users">,
  title: string,
) => {
  const now = Date.now();
  const slug = await getUniqueSlug(ctx);
  const diagramId = await ctx.db.insert("diagrams", {
    ownerId,
    slug,
    title,
    visibility: "private",
    shareEnabled: false,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("diagramContents", {
    diagramId,
    sceneJson: EMPTY_SCENE_JSON,
    version: 0,
    updatedAt: now,
  });
  return { diagramId, slug };
};

const toSummary = (diagram: {
  _id: Id<"diagrams">;
  slug: string;
  title: string;
  visibility: "private" | "unlisted" | "public";
  shareEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}) => ({
  _id: diagram._id,
  slug: diagram.slug,
  title: diagram.title,
  visibility: diagram.visibility,
  shareEnabled: diagram.shareEnabled,
  createdAt: diagram.createdAt,
  updatedAt: diagram.updatedAt,
});

export const ensureDefault = mutation({
  args: {},
  returns: v.object({
    diagramId: v.id("diagrams"),
    slug: v.string(),
  }),
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("diagrams")
      .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(1);
    if (existing[0]) {
      return { diagramId: existing[0]._id, slug: existing[0].slug };
    }
    return await createDiagram(ctx, ownerId, "Untitled diagram");
  },
});

export const create = mutation({
  args: {
    title: v.string(),
  },
  returns: v.object({
    diagramId: v.id("diagrams"),
    slug: v.string(),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const title = args.title.trim() || "Untitled diagram";
    return await createDiagram(ctx, ownerId, title.slice(0, 120));
  },
});

export const listMine = query({
  args: {},
  returns: v.array(diagramSummaryValidator),
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const diagrams = await ctx.db
      .query("diagrams")
      .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(100);
    return diagrams.map(toSummary);
  },
});

export const openMine = query({
  args: {
    slug: v.string(),
  },
  returns: v.union(v.null(), openedDiagramValidator),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const diagram = await ctx.db
      .query("diagrams")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!diagram || diagram.ownerId !== ownerId) {
      return null;
    }
    const content = await ctx.db
      .query("diagramContents")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .unique();
    if (!content) {
      throw new Error("Diagram content is missing");
    }
    return {
      diagram: toSummary(diagram),
      sceneJson: content.sceneJson,
      version: content.version,
      access: "owner" as const,
    };
  },
});

export const openShared = query({
  args: {
    shareToken: v.string(),
  },
  returns: v.union(v.null(), openedDiagramValidator),
  handler: async (ctx, args) => {
    const diagram = await ctx.db
      .query("diagrams")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken))
      .unique();
    if (!diagram || !diagram.shareEnabled) {
      return null;
    }
    const content = await ctx.db
      .query("diagramContents")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .unique();
    if (!content) {
      throw new Error("Diagram content is missing");
    }
    return {
      diagram: toSummary(diagram),
      sceneJson: content.sceneJson,
      version: content.version,
      access: "viewer" as const,
    };
  },
});

export const save = mutation({
  args: {
    diagramId: v.id("diagrams"),
    expectedVersion: v.number(),
    sceneJson: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.literal("saved"),
      version: v.number(),
      updatedAt: v.number(),
    }),
    v.object({
      status: v.literal("conflict"),
      version: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }
    assertSceneSize(args.sceneJson);
    const content = await ctx.db
      .query("diagramContents")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .unique();
    if (!content) {
      throw new Error("Diagram content is missing");
    }
    if (content.version !== args.expectedVersion) {
      return { status: "conflict" as const, version: content.version };
    }
    const now = Date.now();
    const version = content.version + 1;
    await ctx.db.patch("diagramContents", content._id, {
      sceneJson: args.sceneJson,
      version,
      updatedAt: now,
    });
    await ctx.db.patch("diagrams", diagram._id, { updatedAt: now });
    return { status: "saved" as const, version, updatedAt: now };
  },
});

export const rename = mutation({
  args: {
    diagramId: v.id("diagrams"),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }
    const title = args.title.trim() || "Untitled diagram";
    await ctx.db.patch("diagrams", diagram._id, {
      title: title.slice(0, 120),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: {
    diagramId: v.id("diagrams"),
  },
  returns: v.object({
    assetDeleteToken: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }

    const [content, snapshots, assets, uploadGrants] = await Promise.all([
      ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
        .unique(),
      ctx.db
        .query("diagramSnapshots")
        .withIndex("by_diagramId_and_version", (q) =>
          q.eq("diagramId", diagram._id),
        )
        .take(1000),
      ctx.db
        .query("diagramAssets")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
        .take(2000),
      ctx.db
        .query("assetUploadGrants")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
        .take(1000),
    ]);

    const objectKeys = assets.flatMap((asset) =>
      asset.objectKey ? [asset.objectKey] : [],
    );
    const assetDeleteToken = objectKeys.length > 0 ? makeShareToken() : null;
    if (assetDeleteToken) {
      const now = Date.now();
      await ctx.db.insert("assetDeleteGrants", {
        token: assetDeleteToken,
        ownerId,
        objectKeys,
        createdAt: now,
        expiresAt: now + 10 * 60 * 1000,
      });
    }

    if (content) {
      await ctx.db.delete("diagramContents", content._id);
    }
    for (const snapshot of snapshots) {
      await ctx.db.delete("diagramSnapshots", snapshot._id);
    }
    for (const asset of assets) {
      if (asset.storageId) {
        await ctx.storage.delete(asset.storageId);
      }
      await ctx.db.delete("diagramAssets", asset._id);
    }
    for (const grant of uploadGrants) {
      await ctx.db.delete("assetUploadGrants", grant._id);
    }
    await ctx.db.delete("diagrams", diagram._id);

    return { assetDeleteToken };
  },
});

export const setSharing = mutation({
  args: {
    diagramId: v.id("diagrams"),
    enabled: v.boolean(),
  },
  returns: v.object({
    enabled: v.boolean(),
    shareToken: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }
    if (!args.enabled) {
      await ctx.db.patch("diagrams", diagram._id, {
        shareEnabled: false,
        visibility: "private",
        updatedAt: Date.now(),
      });
      return { enabled: false, shareToken: null };
    }
    const shareToken = diagram.shareToken ?? makeShareToken();
    await ctx.db.patch("diagrams", diagram._id, {
      shareEnabled: true,
      shareToken,
      visibility: "unlisted",
      updatedAt: Date.now(),
    });
    return { enabled: true, shareToken };
  },
});
