import { v } from "convex/values";

import {
  DOC_CONTENT_CONTENT_TYPE,
  DOC_CONTENT_ENCODING,
  DOC_CONTENT_KEY_PREFIX,
  DOC_CONTENT_READ_ROUTE_PREFIX,
  MAX_DOC_CONTENT_ASSET_REFS,
  MAX_DOC_CONTENT_COMPRESSED_BYTES,
  MAX_DOC_CONTENT_RAW_BYTES,
} from "../doc-content/types";

import { docAssetReferenceSummaryFields } from "./docModel";

export const DOC_CONTENT_UPLOAD_GRANT_LIFETIME_MS = 10 * 60 * 1000;
export const DOC_CONTENT_READ_GRANT_LIFETIME_MS = 5 * 60 * 1000;
export const DOC_CONTENT_DELETE_GRANT_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const MAX_PENDING_DOC_CONTENT_CLEANUP_TOKENS = 20;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const docContentIntegrityFields = {
  encoding: v.literal(DOC_CONTENT_ENCODING),
  rawSize: v.number(),
  compressedSize: v.number(),
  rawSha256: v.string(),
  compressedSha256: v.string(),
};

export const docContentGrantObjectFields = {
  objectKey: v.string(),
  ...docContentIntegrityFields,
  etag: v.string(),
};

export const docContentUploadGrantResultValidator = v.union(
  v.object({ status: v.literal("upgrade-required") }),
  v.object({ status: v.literal("conflict"), version: v.number() }),
  v.object({
    status: v.literal("unchanged"),
    version: v.number(),
    updatedAt: v.number(),
  }),
  v.object({
    status: v.literal("upload"),
    token: v.string(),
    version: v.number(),
    expiresAt: v.number(),
  }),
);

export const docContentCommitResultValidator = v.union(
  v.object({ status: v.literal("upgrade-required") }),
  v.object({
    status: v.literal("conflict"),
    version: v.number(),
    cleanupToken: v.union(v.string(), v.null()),
  }),
  v.object({
    status: v.literal("committed"),
    version: v.number(),
    updatedAt: v.number(),
    snapshotCreated: v.boolean(),
    cleanupToken: v.union(v.string(), v.null()),
  }),
);

export const docContentReadGrantResultValidator = v.object({
  token: v.string(),
  path: v.string(),
  version: v.number(),
  expiresAt: v.number(),
  ...docContentIntegrityFields,
  etag: v.string(),
});

export const docContentUploadGrantContractValidator = v.object({
  objectKey: v.string(),
  docId: v.string(),
  version: v.number(),
  encoding: v.literal(DOC_CONTENT_ENCODING),
  contentType: v.literal(DOC_CONTENT_CONTENT_TYPE),
  compressedSize: v.number(),
  compressedSha256: v.string(),
  rawSize: v.number(),
  rawSha256: v.string(),
});

export const docContentReadGrantContractValidator =
  docContentUploadGrantContractValidator.extend({
    etag: v.string(),
    expiresAt: v.number(),
  });

export const docContentDeleteGrantContractValidator = v.object({
  objectKeys: v.array(v.string()),
  objectKeyPrefix: v.optional(v.string()),
});

export const docAssetReferenceArgs = {
  assetIds: v.array(v.string()),
  ...docAssetReferenceSummaryFields,
};

export const makeDocContentToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

export const docContentKeyPrefixForDoc = (docId: string) =>
  `${DOC_CONTENT_KEY_PREFIX}${docId}/`;

export const makeDocContentObjectKey = (docId: string) =>
  `${docContentKeyPrefixForDoc(docId)}${makeDocContentToken()}.bin`;

export const docContentReadPath = (token: string) =>
  `${DOC_CONTENT_READ_ROUTE_PREFIX}${token}`;

export const assertDocContentIntegrity = (object: {
  encoding: string;
  rawSize: number;
  compressedSize: number;
  rawSha256: string;
  compressedSha256: string;
}) => {
  if (object.encoding !== DOC_CONTENT_ENCODING) {
    throw new Error("Doc content encoding is not supported");
  }
  if (
    !Number.isSafeInteger(object.rawSize) ||
    object.rawSize < 0 ||
    object.rawSize > MAX_DOC_CONTENT_RAW_BYTES ||
    !Number.isSafeInteger(object.compressedSize) ||
    object.compressedSize < 1 ||
    object.compressedSize > MAX_DOC_CONTENT_COMPRESSED_BYTES
  ) {
    throw new Error("This Doc is too large to save");
  }
  if (
    !SHA256_PATTERN.test(object.rawSha256) ||
    !SHA256_PATTERN.test(object.compressedSha256)
  ) {
    throw new Error("Doc content checksum is invalid");
  }
};

const sha256Hex = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const assertDocAssetReferences = async (args: {
  assetIds: string[];
  assetRefsHash: string;
  assetCount: number;
}) => {
  const canonicalIds = [...new Set(args.assetIds)].sort();
  if (
    args.assetIds.length > MAX_DOC_CONTENT_ASSET_REFS ||
    !Number.isSafeInteger(args.assetCount) ||
    args.assetCount !== canonicalIds.length ||
    args.assetIds.some((assetId, index) => assetId !== canonicalIds[index]) ||
    !SHA256_PATTERN.test(args.assetRefsHash) ||
    args.assetRefsHash !== (await sha256Hex(canonicalIds.join("\n")))
  ) {
    throw new Error("Doc asset references are invalid");
  }
};

export const assertDocContentEtag = (etag: string) => {
  if (etag.trim() !== etag || etag.length < 1 || etag.length > 256) {
    throw new Error("Invalid Doc content etag");
  }
};

export const toDocContentGrantContract = (grant: {
  objectKey: string;
  docId: string;
  version: number;
  encoding: typeof DOC_CONTENT_ENCODING;
  compressedSize: number;
  compressedSha256: string;
  rawSize: number;
  rawSha256: string;
}) => ({
  objectKey: grant.objectKey,
  docId: grant.docId,
  version: grant.version,
  encoding: grant.encoding,
  contentType: DOC_CONTENT_CONTENT_TYPE as typeof DOC_CONTENT_CONTENT_TYPE,
  compressedSize: grant.compressedSize,
  compressedSha256: grant.compressedSha256,
  rawSize: grant.rawSize,
  rawSha256: grant.rawSha256,
});
