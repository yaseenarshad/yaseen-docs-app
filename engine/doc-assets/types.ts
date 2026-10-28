export const DOC_ASSET_ROUTE = "/api/doc-assets";
export const DOC_ASSET_READ_ROUTE_PREFIX = "/api/doc-assets/";
export const DOC_ASSET_UPLOAD_GRANT_PATH = "/doc-asset-upload-grant";
export const DOC_ASSET_READ_GRANT_PATH = "/doc-asset-read-grant";
export const DOC_ASSET_DELETE_GRANT_PATH = "/doc-asset-delete-grant";
export const DOC_ASSET_KEY_PREFIX = "doc-assets/";
export const MAX_DOC_ASSET_BYTES = 50 * 1024 * 1024;
export const DOC_ASSET_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const DOC_ASSET_ID_PATTERN = /^[a-f0-9]{32}$/;

export type DocAssetUploadGrant = {
  objectKey: string;
  assetId: string;
  mimeType: string;
  size: number;
  sha256: string;
};

export type DocAssetReadGrant = DocAssetUploadGrant & {
  filename: string;
  etag: string;
  expiresAt: number;
};

export type DocAssetDeleteGrant = { objectKey: string; assetId: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSha256 = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const isObjectKey = (value: unknown) =>
  typeof value === "string" &&
  value.startsWith(DOC_ASSET_KEY_PREFIX) &&
  !value.includes("..") &&
  !value.includes("//");

const hasUploadFields = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & DocAssetUploadGrant =>
  isObjectKey(value.objectKey) &&
  typeof value.assetId === "string" &&
  DOC_ASSET_ID_PATTERN.test(value.assetId) &&
  typeof value.mimeType === "string" &&
  value.mimeType.length > 0 &&
  value.mimeType !== "image/svg+xml" &&
  typeof value.size === "number" &&
  Number.isSafeInteger(value.size) &&
  value.size > 0 &&
  value.size <= MAX_DOC_ASSET_BYTES &&
  isSha256(value.sha256);

export const parseDocAssetUploadGrant = (
  value: unknown,
): DocAssetUploadGrant | null => {
  const record = isRecord(value) ? value : null;
  return record && hasUploadFields(record) ? record : null;
};

export const parseDocAssetReadGrant = (
  value: unknown,
): DocAssetReadGrant | null => {
  const record = isRecord(value) ? value : null;
  return record &&
    hasUploadFields(record) &&
    typeof record.filename === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(record.filename) &&
    typeof record.etag === "string" &&
    record.etag.length > 0 &&
    typeof record.expiresAt === "number" &&
    record.expiresAt > Date.now()
    ? (record as DocAssetReadGrant)
    : null;
};

export const parseDocAssetDeleteGrant = (
  value: unknown,
): DocAssetDeleteGrant | null => {
  const record = isRecord(value) ? value : null;
  return record &&
    isObjectKey(record.objectKey) &&
    typeof record.assetId === "string" &&
    DOC_ASSET_ID_PATTERN.test(record.assetId)
    ? { objectKey: String(record.objectKey), assetId: record.assetId }
    : null;
};

export const isManagedDocAssetPath = (path: string) =>
  /^assets\/[a-f0-9]{32}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(path);

export const parseManagedDocAssetPath = (path: string) => {
  if (!isManagedDocAssetPath(path)) {
    return null;
  }
  const [, assetId, filename] = path.split("/");
  return { assetId, filename };
};

export const getManagedDocAssetPath = (assetId: string, filename: string) =>
  `assets/${assetId}/${filename}`;

export const extractManagedDocAssetPaths = (markdown: string) =>
  [
    ...markdown.matchAll(
      /(?:!\[[^\]]*\]|\[[^\]]+\])\((assets\/[a-f0-9]{32}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199})\)/g,
    ),
  ]
    .map((match) => match[1])
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();

export const extractManagedDocAssetIds = (markdown: string) =>
  extractManagedDocAssetPaths(markdown)
    .map((path) => parseManagedDocAssetPath(path)!.assetId)
    .filter((assetId, index, all) => all.indexOf(assetId) === index)
    .sort();
