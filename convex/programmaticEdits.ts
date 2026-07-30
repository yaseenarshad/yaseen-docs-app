import { v } from "convex/values";

import { mutation } from "./_generated/server";
import {
  patchBoardElements,
  updateBoardTextElement,
} from "./programmaticEditPersistence";

const resultValidator = v.object({
  version: v.number(),
  updatedAt: v.number(),
});

export const updateTextElement = mutation({
  args: {
    diagramId: v.id("diagrams"),
    elementId: v.string(),
    text: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) =>
    await updateBoardTextElement(
      ctx,
      {
        boardId: args.diagramId,
        elementId: args.elementId,
        text: args.text,
      },
      "Diagram",
    ),
});

export const patchElements = mutation({
  args: {
    diagramId: v.id("diagrams"),
    updatesJson: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) =>
    await patchBoardElements(
      ctx,
      { boardId: args.diagramId, updatesJson: args.updatesJson },
      "Diagram",
    ),
});
