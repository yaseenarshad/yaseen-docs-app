import { v } from "convex/values";

import { DOC_CONTENT_ENCODING } from "../doc-content/types";
import { DOC_PLACEMENT_REFS_PROTOCOL_VERSION } from "../doc-placement/types";

export const DOC_UNFILED_SCOPE = "unfiled";
export const DOC_REFS_PROTOCOL_VERSION = DOC_PLACEMENT_REFS_PROTOCOL_VERSION;

export const docLifecycleValidator = v.union(
  v.literal("active"),
  v.literal("trashed"),
  v.literal("purged"),
);

export const docContentEncodingValidator = v.literal(DOC_CONTENT_ENCODING);

export const docContentIntegrityFields = {
  encoding: docContentEncodingValidator,
  rawSize: v.number(),
  compressedSize: v.number(),
  rawSha256: v.string(),
  compressedSha256: v.string(),
};

export const docContentObjectFields = {
  objectKey: v.string(),
  ...docContentIntegrityFields,
  etag: v.string(),
};

/**
 * The actual asset-reference rows belong to the Doc-asset domain. Content and
 * snapshots keep only a bounded integrity summary so they never grow an
 * unbounded array inside one Convex document.
 */
export const docAssetReferenceSummaryFields = {
  assetRefsHash: v.string(),
  assetCount: v.number(),
};

export const docRefsManifestFields = {
  docRefsHash: v.optional(v.string()),
  docRefsProtocolVersion: v.optional(v.number()),
};

export const docPlacementRefValidator = v.object({
  docId: v.id("docs"),
  elementId: v.string(),
});

/** Optional as a group so clients deployed before Docs retain their hot path. */
export const boardDocRefsUploadFields = {
  docRefsProtocolVersion: v.optional(v.number()),
  docRefsHash: v.optional(v.string()),
  docRefs: v.optional(v.array(docPlacementRefValidator)),
};

export const docFolderScope = (folderId?: string) =>
  folderId ?? DOC_UNFILED_SCOPE;
