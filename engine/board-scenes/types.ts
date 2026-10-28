/**
 * Shared contract between the Convex backend (which issues Board scene grants)
 * and the private Cloudflare Worker data plane (which stores and serves the
 * compressed scene objects). Both sides import this file so the grant shapes
 * can never drift.
 *
 * See docs/superpowers/specs/2026-08-11-private-r2-board-scenes-design.md.
 */

/** Every Board scene object lives under this key namespace. */
export const BOARD_SCENE_KEY_PREFIX = "board-scenes/";
export const BOARD_SCENE_STAGING_KEY_PREFIX = "board-scene-uploads/";

/** zlib/deflate framing, matching the `pako` deflate the client already uses. */
export const BOARD_SCENE_ENCODING = "deflate-v1";

/**
 * Compressed scene bytes are uploaded and served as opaque bytes. `Content-
 * Encoding` is deliberately *not* used so no hop transparently recompresses or
 * decompresses the payload; the encoding travels in a dedicated header instead.
 */
export const BOARD_SCENE_CONTENT_TYPE = "application/octet-stream";
export const BOARD_SCENE_ENCODING_HEADER = "X-Board-Scene-Encoding";

/** Legacy inline Convex documents keep their existing sub-1 MB scene budget. */
export const LEGACY_BOARD_SCENE_RAW_BYTES = 900_000;

/** Warn while the scene is still saveable, leaving 2 MB to recover gracefully. */
export const BOARD_SCENE_WARNING_RAW_BYTES = 8_000_000;

/** Raw (decompressed) ceiling for full scenes stored outside Convex in R2. */
export const MAX_BOARD_SCENE_RAW_BYTES = 10_000_000;

/**
 * Deflate can add framing/block overhead for incompressible input. This small
 * allowance lets a raw scene at the ceiling remain valid while still bounding
 * every buffer before integrity validation.
 */
export const MAX_BOARD_SCENE_COMPRESSED_BYTES = 10_100_000;

/** Maximum number of object keys a single delete capability may carry. */
export const MAX_BOARD_SCENE_DELETE_KEYS = 1000;

/** Worker routes. */
export const BOARD_SCENE_ROUTE = "/api/board-scenes";
export const BOARD_SCENE_READ_ROUTE_PREFIX = "/api/board-scenes/";

/** Convex HTTP routes resolving each capability (implemented by GRO-1422). */
export const BOARD_SCENE_UPLOAD_GRANT_PATH = "/board-scene-upload-grant";
export const BOARD_SCENE_READ_GRANT_PATH = "/board-scene-read-grant";
export const BOARD_SCENE_DELETE_GRANT_PATH = "/board-scene-delete-grant";

/** Grant tokens are 128 bits x2 of hex, like the other bearer capabilities. */
export const BOARD_SCENE_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BOARD_SCENE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Request body every Board scene grant-resolution route accepts. */
export type BoardSceneGrantRequest = {
  token: string;
};

/**
 * Resolution of an upload capability. The object key is chosen by trusted
 * backend code; the Worker never accepts a key from the caller.
 */
export type BoardSceneUploadGrant = {
  objectKey: string;
  diagramId: string;
  version: number;
  encoding: typeof BOARD_SCENE_ENCODING;
  contentType: typeof BOARD_SCENE_CONTENT_TYPE;
  compressedSize: number;
  compressedSha256: string;
  rawSize: number;
  rawSha256: string;
};

/** Resolution of a short-lived read capability for one registered object. */
export type BoardSceneReadGrant = BoardSceneUploadGrant & {
  etag: string;
  expiresAt: number;
};

/**
 * Resolution of a bounded cleanup capability: exact scene keys, an authorized
 * Board-scene prefix, or both.
 */
export type BoardSceneDeleteGrant = {
  objectKeys: string[];
  objectKeyPrefix?: string;
};

/** Successful upload response. Never contains the object key. */
export type BoardSceneUploadResult = {
  etag: string;
  encoding: typeof BOARD_SCENE_ENCODING;
  version: number;
  compressedSize: number;
  compressedSha256: string;
  rawSize: number;
  rawSha256: string;
};

/** Successful delete response. */
export type BoardSceneDeleteResult = {
  deleted: number;
};

/** Immutable metadata written alongside every stored scene object. */
export type BoardSceneObjectMetadata = {
  encoding: typeof BOARD_SCENE_ENCODING;
  compressedSha256: string;
  rawSha256: string;
  rawSize: string;
  diagramId: string;
  version: string;
};

const isPlainKey = (objectKey: string) =>
  objectKey === objectKey.trim() &&
  !objectKey.includes("..") &&
  !objectKey.includes("//") &&
  BOARD_SCENE_KEY_PATTERN.test(objectKey);

/** True when a key is a well-formed object key inside the scene namespace. */
export const isBoardSceneObjectKey = (objectKey: string) =>
  objectKey.startsWith(BOARD_SCENE_KEY_PREFIX) &&
  objectKey.length > BOARD_SCENE_KEY_PREFIX.length &&
  isPlainKey(objectKey);

/** True when a key prefix is a well-formed folder inside the scene namespace. */
export const isBoardSceneKeyPrefix = (objectKeyPrefix: string) =>
  objectKeyPrefix.startsWith(BOARD_SCENE_KEY_PREFIX) &&
  objectKeyPrefix.endsWith("/") &&
  isPlainKey(objectKeyPrefix.slice(0, -1));

/**
 * Conservative check used by the generic public asset route: any key that even
 * mentions the scene namespace is refused there, so a scene object can only
 * ever be reached through the capability-checked private route.
 */
export const referencesBoardSceneNamespace = (objectKey: string) =>
  [BOARD_SCENE_KEY_PREFIX, BOARD_SCENE_STAGING_KEY_PREFIX].some(
    (prefix) =>
      objectKey.startsWith(prefix) || objectKey.includes(`/${prefix}`),
  );

const isSafeInteger = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;

const isSha256 = (value: unknown) =>
  typeof value === "string" && SHA256_PATTERN.test(value);

const hasSceneIntegrityFields = (
  grant: Record<string, unknown>,
): grant is BoardSceneUploadGrant =>
  typeof grant.objectKey === "string" &&
  isBoardSceneObjectKey(grant.objectKey) &&
  typeof grant.diagramId === "string" &&
  grant.diagramId.length > 0 &&
  isSafeInteger(grant.version, 0, Number.MAX_SAFE_INTEGER) &&
  grant.encoding === BOARD_SCENE_ENCODING &&
  grant.contentType === BOARD_SCENE_CONTENT_TYPE &&
  isSafeInteger(grant.compressedSize, 1, MAX_BOARD_SCENE_COMPRESSED_BYTES) &&
  isSha256(grant.compressedSha256) &&
  isSafeInteger(grant.rawSize, 1, MAX_BOARD_SCENE_RAW_BYTES) &&
  isSha256(grant.rawSha256);

const asRecord = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Fails closed on any grant payload the Worker does not fully understand. */
export const parseBoardSceneUploadGrant = (
  value: unknown,
): BoardSceneUploadGrant | null => {
  const grant = asRecord(value);
  return grant && hasSceneIntegrityFields(grant) ? grant : null;
};

export const parseBoardSceneReadGrant = (
  value: unknown,
): BoardSceneReadGrant | null => {
  const grant = asRecord(value);
  if (!grant) {
    return null;
  }
  const { etag, expiresAt } = grant;
  if (
    typeof etag !== "string" ||
    etag.length === 0 ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    !hasSceneIntegrityFields(grant)
  ) {
    return null;
  }
  return { ...grant, etag, expiresAt };
};

export const parseBoardSceneDeleteGrant = (
  value: unknown,
): BoardSceneDeleteGrant | null => {
  const grant = asRecord(value);
  if (!grant || !Array.isArray(grant.objectKeys)) {
    return null;
  }
  const objectKeys = grant.objectKeys;
  if (
    objectKeys.length > MAX_BOARD_SCENE_DELETE_KEYS ||
    !objectKeys.every(
      (objectKey) =>
        typeof objectKey === "string" && isBoardSceneObjectKey(objectKey),
    )
  ) {
    return null;
  }
  const objectKeyPrefix = grant.objectKeyPrefix;
  if (objectKeyPrefix !== undefined) {
    if (
      typeof objectKeyPrefix !== "string" ||
      !isBoardSceneKeyPrefix(objectKeyPrefix)
    ) {
      return null;
    }
    return { objectKeys: objectKeys as string[], objectKeyPrefix };
  }
  return { objectKeys: objectKeys as string[] };
};
