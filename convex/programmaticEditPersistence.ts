import { getAuthUserId } from "@convex-dev/auth/server";

import { createDiagramSnapshotIfNeeded } from "./historyPersistence";
import {
  patchElementsInScene,
  updateTextElementInScene,
} from "./programmaticScene";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const MAX_SCENE_BYTES = 900_000;
const MAX_TEXT_LENGTH = 10_000;
const MAX_ELEMENT_UPDATES_BYTES = 200_000;

const assertSceneSize = (sceneJson: string, entityName: string) => {
  const bytes = new TextEncoder().encode(sceneJson).byteLength;
  if (bytes > MAX_SCENE_BYTES) {
    throw new Error(
      `This ${entityName.toLowerCase()} is too large to save as one scene. Remove embedded data or split the ${entityName.toLowerCase()}.`,
    );
  }
};

const getOwnedBoardContent = async (
  ctx: MutationCtx,
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
  const content = await ctx.db
    .query("diagramContents")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
    .unique();
  if (!content) {
    throw new Error(`${entityName} content is missing`);
  }
  return { content, diagram, ownerId };
};

const commitProgrammaticScene = async (
  ctx: MutationCtx,
  args: {
    boardId: Id<"diagrams">;
    entityName: string;
    sceneJson: string;
    updatedAt: number;
    content: Awaited<ReturnType<typeof getOwnedBoardContent>>["content"];
    ownerId: Id<"users">;
  },
) => {
  assertSceneSize(args.sceneJson, args.entityName);
  await createDiagramSnapshotIfNeeded(ctx, {
    diagramId: args.boardId,
    ownerId: args.ownerId,
    sceneJson: args.content.sceneJson,
    version: args.content.version,
    now: args.updatedAt,
    force: true,
  });
  const version = args.content.version + 1;
  await ctx.db.patch("diagramContents", args.content._id, {
    sceneJson: args.sceneJson,
    version,
    updatedAt: args.updatedAt,
  });
  await ctx.db.patch("diagrams", args.boardId, {
    updatedAt: args.updatedAt,
  });
  return { version, updatedAt: args.updatedAt };
};

export const updateBoardTextElement = async (
  ctx: MutationCtx,
  args: {
    boardId: Id<"diagrams">;
    elementId: string;
    text: string;
  },
  entityName: string,
) => {
  if (args.text.length > MAX_TEXT_LENGTH) {
    throw new Error("Text is too long");
  }
  const { content, ownerId } = await getOwnedBoardContent(
    ctx,
    args.boardId,
    entityName,
  );
  const updatedAt = Date.now();
  const sceneJson = updateTextElementInScene(
    content.sceneJson,
    args.elementId,
    args.text,
    updatedAt,
  );
  return await commitProgrammaticScene(ctx, {
    boardId: args.boardId,
    entityName,
    sceneJson,
    updatedAt,
    content,
    ownerId,
  });
};

export const patchBoardElements = async (
  ctx: MutationCtx,
  args: {
    boardId: Id<"diagrams">;
    updatesJson: string;
  },
  entityName: string,
) => {
  if (
    new TextEncoder().encode(args.updatesJson).byteLength >
    MAX_ELEMENT_UPDATES_BYTES
  ) {
    throw new Error("Element updates are too large");
  }
  const { content, ownerId } = await getOwnedBoardContent(
    ctx,
    args.boardId,
    entityName,
  );
  const updatedAt = Date.now();
  const sceneJson = patchElementsInScene(
    content.sceneJson,
    args.updatesJson,
    updatedAt,
  );
  return await commitProgrammaticScene(ctx, {
    boardId: args.boardId,
    entityName,
    sceneJson,
    updatedAt,
    content,
    ownerId,
  });
};
