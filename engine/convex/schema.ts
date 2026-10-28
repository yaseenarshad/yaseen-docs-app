import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  boardSceneIntegrityFields,
  boardSceneObjectFields,
  boardSceneSnapshotFields,
  boardScenePurposeValidator,
  boardSceneServerCommitResultValidator,
} from "./boardSceneModel";
import {
  docAssetReferenceSummaryFields,
  docContentObjectFields,
  docLifecycleValidator,
  docRefsManifestFields,
  boardDocRefsUploadFields,
} from "./docModel";
import {
  docAssetReferenceArgs,
  docContentGrantObjectFields,
  docContentIntegrityFields,
} from "./docContentModel";
import { mediaKindValidator, mediaProviderValidator } from "./mediaTypes";
import { savedComponentFields } from "./savedComponentModel";

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
    normalizedTitle: v.optional(v.string()),
    folderId: v.optional(v.id("boardFolders")),
    visibility: v.union(
      v.literal("private"),
      v.literal("unlisted"),
      v.literal("public"),
    ),
    shareEnabled: v.boolean(),
    shareToken: v.optional(v.string()),
    previewObjectKey: v.optional(v.string()),
    previewVersion: v.optional(v.number()),
    previewMimeType: v.optional(v.string()),
    previewWidth: v.optional(v.number()),
    previewHeight: v.optional(v.number()),
    previewUpdatedAt: v.optional(v.number()),
    contentVersion: v.optional(v.number()),
    lastSnapshotAt: v.optional(v.number()),
    lastSnapshotVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerId_and_updatedAt", ["ownerId", "updatedAt"])
    .index("by_ownerId_and_createdAt", ["ownerId", "createdAt"])
    .index("by_ownerId_and_normalizedTitle", ["ownerId", "normalizedTitle"])
    .index("by_ownerId_and_folderId", ["ownerId", "folderId"])
    .index("by_slug", ["slug"])
    .index("by_shareToken", ["shareToken"])
    .searchIndex("search_normalizedTitle", {
      searchField: "normalizedTitle",
      filterFields: ["ownerId"],
    }),
  boardFolders: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    normalizedName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerId_and_normalizedName", ["ownerId", "normalizedName"]),
  docFolders: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    normalizedName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerId_and_normalizedName", ["ownerId", "normalizedName"])
    .index("by_ownerId_and_updatedAt", ["ownerId", "updatedAt"]),
  docs: defineTable({
    ownerId: v.id("users"),
    folderId: v.optional(v.id("docFolders")),
    folderScope: v.string(),
    title: v.string(),
    normalizedTitle: v.string(),
    lifecycle: docLifecycleValidator,
    deletedAt: v.optional(v.number()),
    purgeAfter: v.optional(v.number()),
    purgeRequestedAt: v.optional(v.number()),
    purgeCleanupToken: v.optional(v.string()),
    purgedAt: v.optional(v.number()),
    lastSnapshotAt: v.optional(v.number()),
    lastSnapshotVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerId_and_lifecycle_and_updatedAt", [
      "ownerId",
      "lifecycle",
      "updatedAt",
    ])
    .index("by_ownerId_and_lifecycle_and_normalizedTitle", [
      "ownerId",
      "lifecycle",
      "normalizedTitle",
    ])
    .index("by_ownerId_and_lifecycle_and_createdAt", [
      "ownerId",
      "lifecycle",
      "createdAt",
    ])
    .index("by_ownerId_and_folderScope_and_normalizedTitle", [
      "ownerId",
      "folderScope",
      "normalizedTitle",
    ])
    .index("by_ownerId_and_folderScope_and_updatedAt", [
      "ownerId",
      "folderScope",
      "updatedAt",
    ])
    .index("by_lifecycle_and_purgeAfter", ["lifecycle", "purgeAfter"])
    .searchIndex("search_normalizedTitle", {
      searchField: "normalizedTitle",
      filterFields: ["ownerId", "lifecycle"],
    }),
  docContents: defineTable({
    docId: v.id("docs"),
    version: v.number(),
    ...docContentObjectFields,
    ...docAssetReferenceSummaryFields,
    assetIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_docId", ["docId"])
    .index("by_objectKey", ["objectKey"]),
  docContentSnapshots: defineTable({
    docId: v.id("docs"),
    version: v.number(),
    ...docContentObjectFields,
    ...docAssetReferenceSummaryFields,
    assetIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
  })
    .index("by_docId_and_version", ["docId", "version"])
    .index("by_docId_and_createdAt", ["docId", "createdAt"])
    .index("by_objectKey", ["objectKey"]),
  docContentUploadGrants: defineTable({
    token: v.string(),
    docId: v.id("docs"),
    ownerId: v.id("users"),
    expectedVersion: v.number(),
    version: v.number(),
    objectKey: v.string(),
    ...docContentIntegrityFields,
    ...docAssetReferenceArgs,
    resolvedAt: v.optional(v.number()),
    registeredAt: v.optional(v.number()),
    etag: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_docId", ["docId"])
    .index("by_expiresAt", ["expiresAt"]),
  docContentReadGrants: defineTable({
    token: v.string(),
    docId: v.id("docs"),
    source: v.union(v.literal("current"), v.literal("snapshot")),
    snapshotId: v.optional(v.id("docContentSnapshots")),
    version: v.number(),
    ...docContentGrantObjectFields,
    access: v.union(v.literal("owner"), v.literal("shared")),
    diagramId: v.optional(v.id("diagrams")),
    shareToken: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_docId", ["docId"])
    .index("by_expiresAt", ["expiresAt"]),
  docContentDeleteGrants: defineTable({
    token: v.string(),
    ownerId: v.id("users"),
    docId: v.optional(v.id("docs")),
    objectKeys: v.array(v.string()),
    objectKeyPrefix: v.optional(v.string()),
    retainUntilConfirmed: v.optional(v.boolean()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_ownerId_and_createdAt", ["ownerId", "createdAt"])
    .index("by_expiresAt", ["expiresAt"]),
  docAssets: defineTable({
    assetId: v.string(),
    ownerId: v.id("users"),
    sourceDocId: v.id("docs"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sha256: v.string(),
    objectKey: v.string(),
    etag: v.string(),
    status: v.union(
      v.literal("ready"),
      v.literal("purging"),
      v.literal("purged"),
    ),
    currentRefCount: v.number(),
    snapshotRefCount: v.number(),
    unreferencedAt: v.optional(v.number()),
    purgedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_assetId", ["assetId"])
    .index("by_ownerId_and_assetId", ["ownerId", "assetId"])
    .index("by_unreferencedAt", ["unreferencedAt"]),
  docAssetUploadGrants: defineTable({
    token: v.string(),
    assetId: v.string(),
    docId: v.id("docs"),
    ownerId: v.id("users"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sha256: v.string(),
    objectKey: v.string(),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_expiresAt", ["expiresAt"]),
  docAssetReadGrants: defineTable({
    token: v.string(),
    assetId: v.string(),
    ownerId: v.id("users"),
    access: v.union(v.literal("owner"), v.literal("shared")),
    diagramId: v.optional(v.id("diagrams")),
    shareToken: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_expiresAt", ["expiresAt"]),
  docAssetDeleteGrants: defineTable({
    token: v.string(),
    assetId: v.string(),
    ownerId: v.id("users"),
    objectKey: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_expiresAt", ["expiresAt"]),
  docAssetReferences: defineTable({
    docId: v.id("docs"),
    assetId: v.string(),
    source: v.union(v.literal("current"), v.literal("snapshot")),
    sourceVersion: v.number(),
    createdAt: v.number(),
  })
    .index("by_docId_and_source", ["docId", "source"])
    .index("by_assetId_and_source", ["assetId", "source"])
    .index("by_docId_and_assetId_and_source", ["docId", "assetId", "source"]),
  docPlacements: defineTable({
    diagramId: v.id("diagrams"),
    docId: v.id("docs"),
    elementId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_diagramId_and_elementId", ["diagramId", "elementId"])
    .index("by_diagramId_and_docId", ["diagramId", "docId"])
    .index("by_docId_and_diagramId", ["docId", "diagramId"]),
  diagramContents: defineTable({
    diagramId: v.id("diagrams"),
    sceneJson: v.string(),
    version: v.number(),
    updatedAt: v.number(),
  }).index("by_diagramId", ["diagramId"]),
  // A snapshot row holds either the legacy inline `sceneJson` or the metadata
  // of one immutable R2 scene object. New snapshots are always metadata-only.
  diagramSnapshots: defineTable({
    diagramId: v.id("diagrams"),
    createdBy: v.id("users"),
    sceneJson: v.optional(v.string()),
    ...boardSceneSnapshotFields,
    version: v.number(),
    createdAt: v.number(),
  })
    .index("by_diagramId_and_version", ["diagramId", "version"])
    .index("by_diagramId_and_createdAt", ["diagramId", "createdAt"]),
  // One row per migrated Board pointing at its current scene object. Small by
  // construction: it never contains scene bytes.
  diagramSceneManifests: defineTable({
    diagramId: v.id("diagrams"),
    version: v.number(),
    ...boardSceneObjectFields,
    ...docRefsManifestFields,
    lastSnapshotAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_diagramId", ["diagramId"])
    .index("by_objectKey", ["objectKey"]),
  boardSceneUploadGrants: defineTable({
    token: v.string(),
    purpose: boardScenePurposeValidator,
    diagramId: v.id("diagrams"),
    ownerId: v.id("users"),
    expectedVersion: v.number(),
    version: v.number(),
    objectKey: v.string(),
    ...boardSceneIntegrityFields,
    ...boardDocRefsUploadFields,
    stagingObjectKey: v.optional(v.string()),
    forceSnapshot: v.optional(v.boolean()),
    finalizationId: v.optional(v.string()),
    finalizingAt: v.optional(v.number()),
    abandonedAt: v.optional(v.number()),
    commitResult: v.optional(boardSceneServerCommitResultValidator),
    resolvedAt: v.optional(v.number()),
    registeredAt: v.optional(v.number()),
    etag: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_diagramId", ["diagramId"])
    .index("by_expiresAt", ["expiresAt"]),
  boardSceneReadGrants: defineTable({
    token: v.string(),
    diagramId: v.id("diagrams"),
    source: v.union(v.literal("current"), v.literal("snapshot")),
    snapshotId: v.optional(v.id("diagramSnapshots")),
    version: v.number(),
    ...boardSceneObjectFields,
    access: v.union(v.literal("owner"), v.literal("shared")),
    shareToken: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_diagramId", ["diagramId"])
    .index("by_expiresAt", ["expiresAt"]),
  boardSceneDeleteGrants: defineTable({
    token: v.string(),
    ownerId: v.id("users"),
    diagramId: v.optional(v.id("diagrams")),
    objectKeys: v.array(v.string()),
    objectKeyPrefix: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_ownerId_and_createdAt", ["ownerId", "createdAt"])
    .index("by_expiresAt", ["expiresAt"]),
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
    purpose: v.optional(
      v.union(v.literal("sceneAsset"), v.literal("boardPreview")),
    ),
    sourceVersion: v.optional(v.number()),
    previewWidth: v.optional(v.number()),
    previewHeight: v.optional(v.number()),
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
  presentationAnimationAssets: defineTable({
    diagramId: v.id("diagrams"),
    assetId: v.string(),
    version: v.number(),
    sourceElementId: v.string(),
    slideId: v.string(),
    objectKey: v.string(),
    mimeType: v.literal("text/html"),
    size: v.number(),
    sha256: v.string(),
    etag: v.string(),
    status: v.literal("ready"),
    previewFileId: v.optional(v.string()),
    replacementForVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_diagramId", ["diagramId"])
    .index("by_diagramId_and_assetId_and_version", [
      "diagramId",
      "assetId",
      "version",
    ])
    .index("by_objectKey", ["objectKey"]),
  presentationAnimationUploadGrants: defineTable({
    token: v.string(),
    diagramId: v.id("diagrams"),
    ownerId: v.id("users"),
    assetId: v.string(),
    version: v.number(),
    sourceElementId: v.string(),
    slideId: v.string(),
    objectKey: v.string(),
    mimeType: v.literal("text/html"),
    size: v.number(),
    sha256: v.string(),
    previewFileId: v.optional(v.string()),
    replacementForVersion: v.optional(v.number()),
    registeredAt: v.optional(v.number()),
    etag: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_diagramId", ["diagramId"])
    .index("by_diagramId_and_assetId_and_version", [
      "diagramId",
      "assetId",
      "version",
    ]),
  presentationAnimationReadGrants: defineTable({
    token: v.string(),
    diagramId: v.id("diagrams"),
    assetRecordId: v.id("presentationAnimationAssets"),
    assetId: v.string(),
    version: v.number(),
    objectKey: v.string(),
    mimeType: v.literal("text/html"),
    size: v.number(),
    sha256: v.string(),
    etag: v.string(),
    access: v.union(v.literal("owner"), v.literal("shared")),
    shareToken: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_diagramId", ["diagramId"])
    .index("by_assetRecordId", ["assetRecordId"]),
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
  savedComponents: defineTable(savedComponentFields)
    .index("by_ownerId_and_updatedAt", ["ownerId", "updatedAt"])
    .index("by_ownerId_and_status_and_updatedAt", [
      "ownerId",
      "status",
      "updatedAt",
    ])
    .index("by_ownerId_and_normalizedName", ["ownerId", "normalizedName"])
    .index("by_previewUploadToken", ["previewUploadToken"])
    .searchIndex("search_normalizedName", {
      searchField: "normalizedName",
      filterFields: ["ownerId", "status"],
    }),
  savedComponentAssets: defineTable({
    componentId: v.id("savedComponents"),
    fileId: v.string(),
    objectKey: v.string(),
    mimeType: v.string(),
    size: v.number(),
    etag: v.string(),
    uploadToken: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_componentId", ["componentId"])
    .index("by_componentId_and_fileId", ["componentId", "fileId"])
    .index("by_uploadToken", ["uploadToken"]),
  savedComponentUploadGrants: defineTable({
    token: v.string(),
    componentId: v.id("savedComponents"),
    ownerId: v.id("users"),
    purpose: v.union(
      v.literal("componentAsset"),
      v.literal("componentPreview"),
    ),
    fileId: v.optional(v.string()),
    objectKey: v.string(),
    mimeType: v.string(),
    size: v.number(),
    previewWidth: v.optional(v.number()),
    previewHeight: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_componentId", ["componentId"])
    .index("by_ownerId_and_createdAt", ["ownerId", "createdAt"]),
});
