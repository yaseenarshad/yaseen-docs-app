import { v } from "convex/values";

export const savedComponentFields = {
  ownerId: v.id("users"),
  name: v.string(),
  normalizedName: v.string(),
  elementsJson: v.string(),
  elementCount: v.number(),
  schemaVersion: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
