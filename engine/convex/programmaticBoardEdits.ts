import { v } from "convex/values";

import { runBoardSceneEdit } from "./boardSceneEditing";
import {
  MAX_PROGRAMMATIC_TEXT_LENGTH,
  MAX_PROGRAMMATIC_UPDATES_BYTES,
} from "./programmaticEditPersistence";
import {
  patchElementsInScene,
  updateTextElementInScene,
} from "./programmaticScene";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

import type { BoardSceneEditResult } from "./boardSceneEditing";

const resultValidator = v.object({
  version: v.number(),
  updatedAt: v.number(),
});

/**
 * A migrated Board's scene lives in R2, which a mutation cannot fetch, so both
 * programmatic edits are actions: they read the current scene privately, apply
 * the same validated transformation, and commit the replacement through the
 * ordinary upload contract. Arguments and results are unchanged, and a Board
 * that has not migrated still takes the single-transaction mutation path.
 */
export const updateTextElement = action({
  args: {
    boardId: v.id("diagrams"),
    elementId: v.string(),
    text: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args): Promise<BoardSceneEditResult> => {
    if (args.text.length > MAX_PROGRAMMATIC_TEXT_LENGTH) {
      throw new Error("Text is too long");
    }
    return await runBoardSceneEdit(ctx, {
      boardId: args.boardId,
      begin: async () =>
        await ctx.runMutation(internal.boardSceneEdits.beginProgrammaticEdit, {
          boardId: args.boardId,
          entityName: "Board",
        }),
      legacy: async () =>
        await ctx.runMutation(
          internal.boardSceneEdits.updateLegacyTextElement,
          { ...args, entityName: "Board" },
        ),
      transform: (sceneJson) => {
        const updated = updateTextElementInScene(
          sceneJson,
          args.elementId,
          args.text,
          Date.now(),
        );
        return updated;
      },
    });
  },
});

export const patchElements = action({
  args: {
    boardId: v.id("diagrams"),
    updatesJson: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args): Promise<BoardSceneEditResult> => {
    if (
      new TextEncoder().encode(args.updatesJson).byteLength >
      MAX_PROGRAMMATIC_UPDATES_BYTES
    ) {
      throw new Error("Element updates are too large");
    }
    return await runBoardSceneEdit(ctx, {
      boardId: args.boardId,
      begin: async () =>
        await ctx.runMutation(internal.boardSceneEdits.beginProgrammaticEdit, {
          boardId: args.boardId,
          entityName: "Board",
        }),
      legacy: async () =>
        await ctx.runMutation(internal.boardSceneEdits.patchLegacyElements, {
          ...args,
          entityName: "Board",
        }),
      transform: (sceneJson) => {
        const updated = patchElementsInScene(
          sceneJson,
          args.updatesJson,
          Date.now(),
        );
        return updated;
      },
    });
  },
});
