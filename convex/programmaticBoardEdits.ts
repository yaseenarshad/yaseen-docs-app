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
    boardId: v.id("diagrams"),
    elementId: v.string(),
    text: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) =>
    await updateBoardTextElement(ctx, args, "Board"),
});

export const patchElements = mutation({
  args: {
    boardId: v.id("diagrams"),
    updatesJson: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) => await patchBoardElements(ctx, args, "Board"),
});
