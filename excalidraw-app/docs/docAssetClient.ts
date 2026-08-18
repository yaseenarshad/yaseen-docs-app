import {
  DOC_ASSET_ROUTE,
  MAX_DOC_ASSET_BYTES,
  getManagedDocAssetPath,
  parseManagedDocAssetPath,
} from "../../doc-assets/types";

const sha256Hex = async (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const sanitizeDocAssetFilename = (filename: string) => {
  const safe = filename
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 200);
  return safe && /^[A-Za-z0-9]/.test(safe) ? safe : `file-${Date.now()}`;
};

export const uploadDocAsset = async (args: {
  docId: string;
  file: File;
  signal?: AbortSignal;
  createGrant: (args: {
    docId: string;
    filename: string;
    mimeType: string;
    size: number;
    sha256: string;
  }) => Promise<{ token: string; assetId: string; path: string }>;
  register: (args: { token: string; etag: string }) => Promise<{
    assetId: string;
    path: string;
  }>;
}) => {
  if (args.file.size <= 0 || args.file.size > MAX_DOC_ASSET_BYTES) {
    throw new Error("Attachments must be between 1 byte and 50 MB");
  }
  const mimeType = args.file.type || "application/octet-stream";
  if (mimeType === "image/svg+xml") {
    throw new Error("SVG attachments are not supported");
  }
  const filename = sanitizeDocAssetFilename(args.file.name);
  const bytes = await args.file.arrayBuffer();
  if (args.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const grant = await args.createGrant({
    docId: args.docId,
    filename,
    mimeType,
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  });
  const response = await fetch(DOC_ASSET_ROUTE, {
    method: "POST",
    signal: args.signal,
    headers: {
      Authorization: `Bearer ${grant.token}`,
      "Content-Type": mimeType,
    },
    body: bytes,
  });
  const result = (await response.json()) as { etag?: string; error?: string };
  if (!response.ok || !result.etag) {
    throw new Error(result.error || "Attachment upload failed");
  }
  const registered = await args.register({
    token: grant.token,
    etag: result.etag,
  });
  const path = getManagedDocAssetPath(registered.assetId, filename);
  if (!parseManagedDocAssetPath(path)) {
    throw new Error("Attachment path is invalid");
  }
  return {
    path,
    markdown: mimeType.startsWith("image/")
      ? `![${filename}](${path})`
      : `[${filename}](${path})`,
  };
};

type ReadGrant = { path: string; expiresAt: number };

export class DocAssetResolver {
  private readonly cache = new Map<string, ReadGrant>();

  constructor(
    private readonly createReadGrant: (assetId: string) => Promise<ReadGrant>,
  ) {}

  public async resolve(path: string) {
    const parsed = parseManagedDocAssetPath(path);
    if (!parsed) {
      return path;
    }
    const cached = this.cache.get(parsed.assetId);
    if (cached && cached.expiresAt > Date.now() + 30_000) {
      return cached.path;
    }
    const grant = await this.createReadGrant(parsed.assetId);
    this.cache.set(parsed.assetId, grant);
    return grant.path;
  }

  public clear() {
    this.cache.clear();
  }
}

export const cleanupDocAsset = async (token: string) => {
  const response = await fetch(DOC_ASSET_ROUTE, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error("Attachment cleanup failed");
  }
};
