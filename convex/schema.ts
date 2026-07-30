import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { mediaKindValidator, mediaProviderValidator } from "./mediaTypes";

const mediaFields = {
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
};

export default defineSchema({
  ...authTables,
  diagrams: defineTable({
    ownerId: v.id("users"),
    slug: v.string(),
    title: v.string(),
    visibility: v.union(
      v.literal("private"),
      v.literal("unlisted"),
      v.literal("public"),
    ),
    shareEnabled: v.boolean(),
    shareToken: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerId_and_updatedAt", ["ownerId", "updatedAt"])
    .index("by_slug", ["slug"])
    .index("by_shareToken", ["shareToken"]),
  diagramContents: defineTable({
    diagramId: v.id("diagrams"),
    sceneJson: v.string(),
    version: v.number(),
    updatedAt: v.number(),
  }).index("by_diagramId", ["diagramId"]),
  diagramSnapshots: defineTable({
    diagramId: v.id("diagrams"),
    createdBy: v.id("users"),
    sceneJson: v.string(),
    version: v.number(),
    createdAt: v.number(),
  })
    .index("by_diagramId_and_version", ["diagramId", "version"])
    .index("by_diagramId_and_createdAt", ["diagramId", "createdAt"]),
  diagramAssets: defineTable({
    diagramId: v.id("diagrams"),
    fileId: v.string(),
    storageId: v.optional(v.id("_storage")),
    objectKey: v.optional(v.string()),
    mimeType: v.string(),
    size: v.optional(v.number()),
    etag: v.optional(v.string()),
    sourceItemKey: v.optional(v.string()),
    sourceProvider: v.optional(mediaProviderValidator),
    sourceUrl: v.optional(v.string()),
    attribution: v.optional(v.string()),
    licenseName: v.optional(v.string()),
    licenseUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_diagramId", ["diagramId"])
    .index("by_diagramId_and_fileId", ["diagramId", "fileId"]),
  assetUploadGrants: defineTable({
    token: v.string(),
    diagramId: v.id("diagrams"),
    ownerId: v.id("users"),
    fileId: v.string(),
    objectKey: v.string(),
    mimeType: v.string(),
    size: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_diagramId", ["diagramId"]),
  assetDeleteGrants: defineTable({
    token: v.string(),
    ownerId: v.id("users"),
    objectKeys: v.array(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),
  mediaFavorites: defineTable({
    ownerId: v.id("users"),
    ...mediaFields,
    updatedAt: v.number(),
  })
    .index("by_ownerId_and_itemKey", ["ownerId", "itemKey"])
    .index("by_ownerId_and_updatedAt", ["ownerId", "updatedAt"]),
  mediaRecent: defineTable({
    ownerId: v.id("users"),
    ...mediaFields,
    updatedAt: v.number(),
  })
    .index("by_ownerId_and_itemKey", ["ownerId", "itemKey"])
    .index("by_ownerId_and_updatedAt", ["ownerId", "updatedAt"]),
});
