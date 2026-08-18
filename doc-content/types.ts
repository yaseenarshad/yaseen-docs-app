export const DOC_CONTENT_KEY_PREFIX = "doc-content/";
export const DOC_CONTENT_ENCODING = "deflate-v1";
export const DOC_CONTENT_CONTENT_TYPE = "application/octet-stream";
export const DOC_CONTENT_ENCODING_HEADER = "X-Doc-Content-Encoding";
export const DOC_CONTENT_SAVE_PROTOCOL_VERSION = 1;

export const MAX_DOC_CONTENT_RAW_BYTES = 5_000_000;
export const MAX_DOC_CONTENT_COMPRESSED_BYTES = MAX_DOC_CONTENT_RAW_BYTES;
export const MAX_DOC_CONTENT_ASSET_REFS = 1000;
export const MAX_DOC_CONTENT_DELETE_KEYS = 1000;

export const DOC_CONTENT_ROUTE = "/api/doc-content";
export const DOC_CONTENT_READ_ROUTE_PREFIX = "/api/doc-content/";
export const DOC_CONTENT_UPLOAD_GRANT_PATH = "/doc-content-upload-grant";
export const DOC_CONTENT_READ_GRANT_PATH = "/doc-content-read-grant";
export const DOC_CONTENT_DELETE_GRANT_PATH = "/doc-content-delete-grant";
export const DOC_CONTENT_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export type DocContentUploadGrant = {
  objectKey: string;
  docId: string;
  version: number;
  encoding: typeof DOC_CONTENT_ENCODING;
  contentType: typeof DOC_CONTENT_CONTENT_TYPE;
  compressedSize: number;
  compressedSha256: string;
  rawSize: number;
  rawSha256: string;
};

export type DocContentReadGrant = DocContentUploadGrant & {
  etag: string;
  expiresAt: number;
};

export type DocContentDeleteGrant = {
  objectKeys: string[];
  objectKeyPrefix?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSafeInteger = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;

const isSha256 = (value: unknown) =>
  typeof value === "string" && SHA256_PATTERN.test(value);

const isPlainKey = (objectKey: string) =>
  objectKey === objectKey.trim() &&
  !objectKey.includes("..") &&
  !objectKey.includes("//") &&
  OBJECT_KEY_PATTERN.test(objectKey);

export const isDocContentObjectKey = (objectKey: string) =>
  objectKey.startsWith(DOC_CONTENT_KEY_PREFIX) &&
  objectKey.length > DOC_CONTENT_KEY_PREFIX.length &&
  isPlainKey(objectKey);

export const isDocContentKeyPrefix = (objectKeyPrefix: string) =>
  objectKeyPrefix.startsWith(DOC_CONTENT_KEY_PREFIX) &&
  objectKeyPrefix.endsWith("/") &&
  isPlainKey(objectKeyPrefix.slice(0, -1));

export const referencesDocContentNamespace = (objectKey: string) =>
  objectKey.startsWith(DOC_CONTENT_KEY_PREFIX) ||
  objectKey.includes(`/${DOC_CONTENT_KEY_PREFIX}`);

const hasIntegrityFields = (
  grant: Record<string, unknown>,
): grant is DocContentUploadGrant =>
  typeof grant.objectKey === "string" &&
  isDocContentObjectKey(grant.objectKey) &&
  typeof grant.docId === "string" &&
  grant.docId.length > 0 &&
  isSafeInteger(grant.version, 1, Number.MAX_SAFE_INTEGER) &&
  grant.encoding === DOC_CONTENT_ENCODING &&
  grant.contentType === DOC_CONTENT_CONTENT_TYPE &&
  isSafeInteger(grant.compressedSize, 1, MAX_DOC_CONTENT_COMPRESSED_BYTES) &&
  isSha256(grant.compressedSha256) &&
  isSafeInteger(grant.rawSize, 0, MAX_DOC_CONTENT_RAW_BYTES) &&
  isSha256(grant.rawSha256);

export const parseDocContentUploadGrant = (
  value: unknown,
): DocContentUploadGrant | null => {
  const grant = isRecord(value) ? value : null;
  return grant && hasIntegrityFields(grant) ? grant : null;
};

export const parseDocContentReadGrant = (
  value: unknown,
): DocContentReadGrant | null => {
  const grant = isRecord(value) ? value : null;
  const etag = grant?.etag;
  const expiresAt = grant?.expiresAt;
  if (
    !grant ||
    typeof etag !== "string" ||
    etag.length === 0 ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    !hasIntegrityFields(grant)
  ) {
    return null;
  }
  return { ...grant, etag, expiresAt };
};

export const parseDocContentDeleteGrant = (
  value: unknown,
): DocContentDeleteGrant | null => {
  const grant = isRecord(value) ? value : null;
  if (
    !grant ||
    !Array.isArray(grant.objectKeys) ||
    grant.objectKeys.length > MAX_DOC_CONTENT_DELETE_KEYS ||
    !grant.objectKeys.every(
      (key) => typeof key === "string" && isDocContentObjectKey(key),
    )
  ) {
    return null;
  }
  if (
    grant.objectKeyPrefix !== undefined &&
    (typeof grant.objectKeyPrefix !== "string" ||
      !isDocContentKeyPrefix(grant.objectKeyPrefix))
  ) {
    return null;
  }
  return {
    objectKeys: grant.objectKeys,
    ...(typeof grant.objectKeyPrefix === "string"
      ? { objectKeyPrefix: grant.objectKeyPrefix }
      : {}),
  };
};
