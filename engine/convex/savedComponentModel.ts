import { v } from "convex/values";

export const savedComponentFields = {
  ownerId: v.id("users"),
  name: v.string(),
  normalizedName: v.string(),
  elementsJson: v.string(),
  elementCount: v.number(),
  schemaVersion: v.number(),
  status: v.optional(v.union(v.literal("draft"), v.literal("ready"))),
  previewObjectKey: v.optional(v.string()),
  previewMimeType: v.optional(v.string()),
  previewSize: v.optional(v.number()),
  previewEtag: v.optional(v.string()),
  previewWidth: v.optional(v.number()),
  previewHeight: v.optional(v.number()),
  previewUploadToken: v.optional(v.string()),
  readyAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};
