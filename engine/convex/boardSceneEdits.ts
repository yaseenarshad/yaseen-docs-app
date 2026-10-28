import { v } from "convex/values";

import {
  boardSceneEditPlanValidator,
  boardSceneEditResultValidator,
  boardSceneEntityNameValidator,
} from "./boardSceneModel";
import {
  beginBoardSnapshotRestore,
  restoreBoardSnapshot,
} from "./historyPersistence";
import {
  beginProgrammaticBoardEdit,
  patchBoardElements,
  updateBoardTextElement,
} from "./programmaticEditPersistence";
import { internalMutation } from "./_generated/server";

/**
 * The transactional halves of the server-side scene edits. Each `begin`
 * authorizes the caller and mints whatever capability the action needs; each
 * `legacy` entry point is the unchanged single-transaction path a Board that
 * has not migrated still takes. They are internal because the action wrapping
 * them is the supported API surface.
 */

export const beginRestore = internalMutation({
  args: {
    boardId: v.id("diagrams"),
    snapshotId: v.id("diagramSnapshots"),
    entityName: boardSceneEntityNameValidator,
  },
  returns: boardSceneEditPlanValidator,
  handler: async (ctx, args) =>
    await beginBoardSnapshotRestore(ctx, args, args.entityName),
});

export const restoreLegacySnapshot = internalMutation({
  args: {
    boardId: v.id("diagrams"),
    snapshotId: v.id("diagramSnapshots"),
    entityName: boardSceneEntityNameValidator,
  },
  returns: boardSceneEditResultValidator,
  handler: async (ctx, args) =>
    await restoreBoardSnapshot(ctx, args, args.entityName),
});

export const beginProgrammaticEdit = internalMutation({
  args: {
    boardId: v.id("diagrams"),
    entityName: boardSceneEntityNameValidator,
  },
  returns: boardSceneEditPlanValidator,
  handler: async (ctx, args) =>
    await beginProgrammaticBoardEdit(ctx, args.boardId, args.entityName),
});

export const updateLegacyTextElement = internalMutation({
  args: {
    boardId: v.id("diagrams"),
    elementId: v.string(),
    text: v.string(),
    entityName: boardSceneEntityNameValidator,
  },
  returns: boardSceneEditResultValidator,
  handler: async (ctx, args) =>
    await updateBoardTextElement(ctx, args, args.entityName),
});

export const patchLegacyElements = internalMutation({
  args: {
    boardId: v.id("diagrams"),
    updatesJson: v.string(),
    entityName: boardSceneEntityNameValidator,
  },
  returns: boardSceneEditResultValidator,
  handler: async (ctx, args) =>
    await patchBoardElements(ctx, args, args.entityName),
});
