import { v } from "convex/values";

export const mediaProviderValidator = v.union(
  v.literal("pixabay"),
  v.literal("iconify"),
  v.literal("shape"),
);

export const mediaKindValidator = v.union(
  v.literal("photo"),
  v.literal("illustration"),
  v.literal("icon"),
  v.literal("logo"),
  v.literal("shape"),
);

export const mediaItemValidator = v.object({
  itemKey: v.string(),
  provider: mediaProviderValidator,
  providerId: v.string(),
  kind: mediaKindValidator,
  title: v.string(),
  previewUrl: v.optional(v.string()),
  creator: v.optional(v.string()),
  creatorUrl: v.optional(v.string()),
  collectionName: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  licenseName: v.optional(v.string()),
  licenseUrl: v.optional(v.string()),
  attribution: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  trademarkNotice: v.optional(v.boolean()),
});
