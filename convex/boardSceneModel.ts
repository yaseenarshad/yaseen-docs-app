import { ConvexError, v } from "convex/values";

import { BoardSceneSizeError } from "../board-scenes/sizePolicy";

import {
  BOARD_SCENE_CONTENT_TYPE,
  BOARD_SCENE_ENCODING,
  BOARD_SCENE_KEY_PREFIX,
  BOARD_SCENE_READ_ROUTE_PREFIX,
  MAX_BOARD_SCENE_COMPRESSED_BYTES,
  MAX_BOARD_SCENE_RAW_BYTES,
} from "../board-scenes/types";

import type { Infer } from "convex/values";

/** An upload capability only has to survive one compress-and-upload round. */
export const BOARD_SCENE_UPLOAD_GRANT_LIFETIME_MS = 10 * 60 * 1000;
/** Read capabilities are deliberately short-lived; the client re-mints them. */
export const BOARD_SCENE_READ_GRANT_LIFETIME_MS = 5 * 60 * 1000;
/** Cleanup is best-effort work a client drains, so it survives a session. */
export const BOARD_SCENE_DELETE_GRANT_LIFETIME_MS = 24 * 60 * 60 * 1000;

export const MAX_PENDING_BOARD_SCENE_CLEANUP_TOKENS = 20;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const boardSceneEncodingValidator = v.literal(BOARD_SCENE_ENCODING);

/**
 * The integrity contract a client declares before uploading. `semanticSha256`
 * is the binding-insensitive digest that lets a save be recognised as an echo
 * without ever reading scene bytes.
 */
export const boardSceneIntegrityFields = {
  encoding: boardSceneEncodingValidator,
  rawSize: v.number(),
  compressedSize: v.number(),
  rawSha256: v.string(),
  compressedSha256: v.string(),
  semanticSha256: v.string(),
};

/** Everything Convex records about one immutable stored scene object. */
export const boardSceneObjectFields = {
  objectKey: v.string(),
  ...boardSceneIntegrityFields,
  etag: v.string(),
};

/** Object metadata a snapshot row carries instead of a legacy `sceneJson`. */
export const boardSceneSnapshotFields = {
  objectKey: v.optional(v.string()),
  encoding: v.optional(boardSceneEncodingValidator),
  rawSize: v.optional(v.number()),
  compressedSize: v.optional(v.number()),
  rawSha256: v.optional(v.string()),
  compressedSha256: v.optional(v.string()),
  semanticSha256: v.optional(v.string()),
  etag: v.optional(v.string()),
};

export const boardSceneManifestSummaryValidator = v.object({
  version: v.number(),
  ...boardSceneIntegrityFields,
  etag: v.string(),
  updatedAt: v.number(),
  docRefsHash: v.optional(v.string()),
  docRefsProtocolVersion: v.optional(v.number()),
});

export const boardScenePurposeValidator = v.union(
  v.literal("migration"),
  v.literal("save"),
);

export const boardSceneUploadGrantResultValidator = v.union(
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

/**
 * A trusted server-side edit has already authorized its caller and is never a
 * binding echo, so neither `upgrade-required` nor `unchanged` can occur.
 */
export const boardSceneServerUploadGrantResultValidator = v.union(
  v.object({ status: v.literal("conflict"), version: v.number() }),
  v.object({
    status: v.literal("upload"),
    token: v.string(),
    version: v.number(),
    expiresAt: v.number(),
  }),
);

export const boardSceneServerCommitResultValidator = v.union(
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

export const boardSceneCommitResultValidator = v.union(
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

export const boardSceneReadGrantResultValidator = v.object({
  token: v.string(),
  path: v.string(),
  version: v.number(),
  expiresAt: v.number(),
  ...boardSceneIntegrityFields,
  etag: v.string(),
});

export const boardSceneEntityNameValidator = v.union(
  v.literal("Board"),
  v.literal("Diagram"),
);

/**
 * What an authorizing mutation tells a server-side edit it has to read: nothing
 * at all for a Board that never migrated, one legacy snapshot document, or one
 * capability naming an immutable R2 object.
 */
export const boardSceneEditPlanValidator = v.union(
  v.object({ mode: v.literal("legacy") }),
  v.object({
    mode: v.literal("inline"),
    currentVersion: v.number(),
    currentDocRefsHash: v.optional(v.string()),
    sceneJson: v.string(),
  }),
  v.object({
    mode: v.literal("object"),
    currentVersion: v.number(),
    currentDocRefsHash: v.optional(v.string()),
    grant: boardSceneReadGrantResultValidator,
  }),
);

export type BoardSceneEditPlan = Infer<typeof boardSceneEditPlanValidator>;

export const boardSceneEditResultValidator = v.object({
  version: v.number(),
  updatedAt: v.number(),
});

/** Exactly the shape `parseBoardSceneUploadGrant` accepts. */
export const boardSceneUploadGrantContractValidator = v.object({
  objectKey: v.string(),
  diagramId: v.string(),
  version: v.number(),
  encoding: boardSceneEncodingValidator,
  contentType: v.literal(BOARD_SCENE_CONTENT_TYPE),
  compressedSize: v.number(),
  compressedSha256: v.string(),
  rawSize: v.number(),
  rawSha256: v.string(),
});

/** Exactly the shape `parseBoardSceneReadGrant` accepts. */
export const boardSceneReadGrantContractValidator =
  boardSceneUploadGrantContractValidator.extend({
    etag: v.string(),
    expiresAt: v.number(),
  });

/** Exactly the shape `parseBoardSceneDeleteGrant` accepts. */
export const boardSceneDeleteGrantContractValidator = v.object({
  objectKeys: v.array(v.string()),
  objectKeyPrefix: v.optional(v.string()),
});

export const makeBoardSceneToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

/**
 * Object keys are chosen here and never accepted from a caller: an unguessable
 * suffix keeps every committed version immutable and independently addressable.
 */
export const makeBoardSceneObjectKey = (diagramId: string) =>
  `${boardSceneKeyPrefixForDiagram(diagramId)}${makeBoardSceneToken()}.bin`;

export const boardSceneKeyPrefixForDiagram = (diagramId: string) =>
  `${BOARD_SCENE_KEY_PREFIX}${diagramId}/`;

export const assertBoardSceneIntegrity = (object: {
  encoding: string;
  rawSize: number;
  compressedSize: number;
  rawSha256: string;
  compressedSha256: string;
  semanticSha256: string;
}) => {
  if (object.encoding !== BOARD_SCENE_ENCODING) {
    throw new Error("Board scene encoding is not supported");
  }
  if (
    !Number.isSafeInteger(object.rawSize) ||
    object.rawSize < 1 ||
    !Number.isSafeInteger(object.compressedSize) ||
    object.compressedSize < 1
  ) {
    throw new Error("Board scene size is invalid");
  }
  if (
    object.rawSize > MAX_BOARD_SCENE_RAW_BYTES ||
    object.compressedSize > MAX_BOARD_SCENE_COMPRESSED_BYTES
  ) {
    throw new ConvexError(new BoardSceneSizeError(object.rawSize).data);
  }
  if (
    !SHA256_PATTERN.test(object.rawSha256) ||
    !SHA256_PATTERN.test(object.compressedSha256) ||
    !SHA256_PATTERN.test(object.semanticSha256)
  ) {
    throw new Error("Board scene checksum is invalid");
  }
};

export const assertBoardSceneEtag = (etag: string) => {
  if (etag.trim() !== etag || etag.length < 1 || etag.length > 256) {
    throw new Error("Invalid Board scene etag");
  }
};

export const toBoardSceneManifestSummary = (manifest: {
  version: number;
  encoding: typeof BOARD_SCENE_ENCODING;
  rawSize: number;
  compressedSize: number;
  rawSha256: string;
  compressedSha256: string;
  semanticSha256: string;
  etag: string;
  updatedAt: number;
  docRefsHash?: string;
  docRefsProtocolVersion?: number;
}) => ({
  version: manifest.version,
  encoding: manifest.encoding,
  rawSize: manifest.rawSize,
  compressedSize: manifest.compressedSize,
  rawSha256: manifest.rawSha256,
  compressedSha256: manifest.compressedSha256,
  semanticSha256: manifest.semanticSha256,
  etag: manifest.etag,
  updatedAt: manifest.updatedAt,
  ...(manifest.docRefsHash !== undefined
    ? { docRefsHash: manifest.docRefsHash }
    : null),
  ...(manifest.docRefsProtocolVersion !== undefined
    ? { docRefsProtocolVersion: manifest.docRefsProtocolVersion }
    : null),
});

export const toBoardSceneGrantContract = (grant: {
  objectKey: string;
  diagramId: string;
  version: number;
  encoding: typeof BOARD_SCENE_ENCODING;
  compressedSize: number;
  compressedSha256: string;
  rawSize: number;
  rawSha256: string;
}) => ({
  objectKey: grant.objectKey,
  diagramId: grant.diagramId,
  version: grant.version,
  encoding: grant.encoding,
  contentType: BOARD_SCENE_CONTENT_TYPE as typeof BOARD_SCENE_CONTENT_TYPE,
  compressedSize: grant.compressedSize,
  compressedSha256: grant.compressedSha256,
  rawSize: grant.rawSize,
  rawSha256: grant.rawSha256,
});

export const boardSceneReadPath = (token: string) =>
  `${BOARD_SCENE_READ_ROUTE_PREFIX}${token}`;
