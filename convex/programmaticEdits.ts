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

export const updateTextElement = action({
  args: {
    diagramId: v.id("diagrams"),
    elementId: v.string(),
    text: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args): Promise<BoardSceneEditResult> => {
    if (args.text.length > MAX_PROGRAMMATIC_TEXT_LENGTH) {
      throw new Error("Text is too long");
    }
    return await runBoardSceneEdit(ctx, {
      boardId: args.diagramId,
      begin: async () =>
        await ctx.runMutation(internal.boardSceneEdits.beginProgrammaticEdit, {
          boardId: args.diagramId,
          entityName: "Diagram",
        }),
      legacy: async () =>
        await ctx.runMutation(
          internal.boardSceneEdits.updateLegacyTextElement,
          {
            boardId: args.diagramId,
            elementId: args.elementId,
            text: args.text,
            entityName: "Diagram",
          },
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
    diagramId: v.id("diagrams"),
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
      boardId: args.diagramId,
      begin: async () =>
        await ctx.runMutation(internal.boardSceneEdits.beginProgrammaticEdit, {
          boardId: args.diagramId,
          entityName: "Diagram",
        }),
      legacy: async () =>
        await ctx.runMutation(internal.boardSceneEdits.patchLegacyElements, {
          boardId: args.diagramId,
          updatesJson: args.updatesJson,
          entityName: "Diagram",
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
