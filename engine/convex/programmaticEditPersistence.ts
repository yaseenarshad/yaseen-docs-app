import { getAuthUserId } from "@convex-dev/auth/server";

import { LEGACY_BOARD_SCENE_RAW_BYTES } from "../board-scenes/types";

import {
  assertBoardSceneNotMigrated,
  createBoardSceneReadGrant,
  readBoardSceneManifest,
} from "./boardScenePersistence";
import { createDiagramSnapshotIfNeeded } from "./historyPersistence";
import {
  patchElementsInScene,
  updateTextElementInScene,
} from "./programmaticScene";

import type { BoardSceneEditPlan } from "./boardSceneModel";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// The input ceilings are checked by the action before it reads any scene, and
// again here for a Board that takes the single-transaction path.
export const MAX_PROGRAMMATIC_TEXT_LENGTH = 10_000;
export const MAX_PROGRAMMATIC_UPDATES_BYTES = 200_000;

export const assertSceneSize = (sceneJson: string, entityName: string) => {
  const bytes = new TextEncoder().encode(sceneJson).byteLength;
  if (bytes > LEGACY_BOARD_SCENE_RAW_BYTES) {
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
  // Programmatic edits of a migrated Board need an action that can fetch R2, so
  // this mutation path refuses rather than reading a scene that is not here.
  await assertBoardSceneNotMigrated(ctx, diagram._id);
  const content = await ctx.db
    .query("diagramContents")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
    .unique();
  if (!content) {
    throw new Error(`${entityName} content is missing`);
  }
  return { content, diagram, ownerId };
};

/**
 * Authorizes a programmatic edit and reports what the editing action has to
 * read. A Board that never migrated stays on the single-transaction mutation
 * path, so its result is produced exactly as it was before.
 */
export const beginProgrammaticBoardEdit = async (
  ctx: MutationCtx,
  boardId: Id<"diagrams">,
  entityName: string,
): Promise<BoardSceneEditPlan> => {
  const ownerId = await getAuthUserId(ctx);
  if (!ownerId) {
    throw new Error("Authentication required");
  }
  const diagram = await ctx.db.get("diagrams", boardId);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error(`${entityName} not found`);
  }
  const manifest = await readBoardSceneManifest(ctx, diagram._id);
  if (!manifest) {
    return { mode: "legacy" };
  }
  return {
    mode: "object",
    currentVersion: manifest.version,
    ...(manifest.docRefsHash !== undefined
      ? { currentDocRefsHash: manifest.docRefsHash }
      : null),
    grant: await createBoardSceneReadGrant(ctx, { boardId: diagram._id }),
  };
};

const commitProgrammaticScene = async (
  ctx: MutationCtx,
  args: {
    diagram: Awaited<ReturnType<typeof getOwnedBoardContent>>["diagram"];
    entityName: string;
    sceneJson: string;
    updatedAt: number;
    content: Awaited<ReturnType<typeof getOwnedBoardContent>>["content"];
    ownerId: Id<"users">;
  },
) => {
  assertSceneSize(args.sceneJson, args.entityName);
  await createDiagramSnapshotIfNeeded(ctx, {
    diagram: args.diagram,
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
  await ctx.db.patch("diagrams", args.diagram._id, {
    contentVersion: version,
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
  if (args.text.length > MAX_PROGRAMMATIC_TEXT_LENGTH) {
    throw new Error("Text is too long");
  }
  const { content, diagram, ownerId } = await getOwnedBoardContent(
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
    diagram,
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
    MAX_PROGRAMMATIC_UPDATES_BYTES
  ) {
    throw new Error("Element updates are too large");
  }
  const { content, diagram, ownerId } = await getOwnedBoardContent(
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
    diagram,
    entityName,
    sceneJson,
    updatedAt,
    content,
    ownerId,
  });
};
