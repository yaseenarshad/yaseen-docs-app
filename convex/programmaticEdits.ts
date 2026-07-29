import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { mutation } from "./_generated/server";
import { createDiagramSnapshotIfNeeded } from "./diagramHistory";
import {
  patchElementsInScene,
  updateTextElementInScene,
} from "./programmaticScene";

const MAX_SCENE_BYTES = 900_000;
const MAX_TEXT_LENGTH = 10_000;
const MAX_ELEMENT_UPDATES_BYTES = 200_000;

const assertSceneSize = (sceneJson: string) => {
  const bytes = new TextEncoder().encode(sceneJson).byteLength;
  if (bytes > MAX_SCENE_BYTES) {
    throw new Error(
      "This diagram is too large to save as one scene. Remove embedded data or split the diagram.",
    );
  }
};

export const updateTextElement = mutation({
  args: {
    diagramId: v.id("diagrams"),
    elementId: v.string(),
    text: v.string(),
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
    if (args.text.length > MAX_TEXT_LENGTH) {
      throw new Error("Text is too long");
    }

    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }

    const content = await ctx.db
      .query("diagramContents")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .unique();
    if (!content) {
      throw new Error("Diagram content is missing");
    }

    const updatedAt = Date.now();
    const sceneJson = updateTextElementInScene(
      content.sceneJson,
      args.elementId,
      args.text,
      updatedAt,
    );
    assertSceneSize(sceneJson);

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
      sceneJson,
      version,
      updatedAt,
    });
    await ctx.db.patch("diagrams", diagram._id, { updatedAt });

    return { version, updatedAt };
  },
});

export const patchElements = mutation({
  args: {
    diagramId: v.id("diagrams"),
    updatesJson: v.string(),
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
    if (
      new TextEncoder().encode(args.updatesJson).byteLength >
      MAX_ELEMENT_UPDATES_BYTES
    ) {
      throw new Error("Element updates are too large");
    }

    const diagram = await ctx.db.get("diagrams", args.diagramId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Diagram not found");
    }
    const content = await ctx.db
      .query("diagramContents")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .unique();
    if (!content) {
      throw new Error("Diagram content is missing");
    }

    const updatedAt = Date.now();
    const sceneJson = patchElementsInScene(
      content.sceneJson,
      args.updatesJson,
      updatedAt,
    );
    assertSceneSize(sceneJson);
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
      sceneJson,
      version,
      updatedAt,
    });
    await ctx.db.patch("diagrams", diagram._id, { updatedAt });
    return { version, updatedAt };
  },
});
