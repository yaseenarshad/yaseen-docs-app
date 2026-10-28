import {
  DOC_CONTENT_CONTENT_TYPE,
  DOC_CONTENT_ENCODING,
  DOC_CONTENT_ENCODING_HEADER,
  DOC_CONTENT_ROUTE,
  DOC_CONTENT_SAVE_PROTOCOL_VERSION,
} from "../../doc-content/types";
import { extractManagedDocAssetIds } from "../../doc-assets/types";

const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const hashDocMarkdown = async (markdown: string) =>
  await sha256Hex(new TextEncoder().encode(markdown));

export const compressDocMarkdown = async (markdown: string) => {
  const raw = new TextEncoder().encode(markdown);
  const stream = new Blob([raw])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return {
    bytes: compressed,
    encoding: DOC_CONTENT_ENCODING as typeof DOC_CONTENT_ENCODING,
    rawSize: raw.byteLength,
    compressedSize: compressed.byteLength,
    rawSha256: await sha256Hex(raw),
    compressedSha256: await sha256Hex(compressed),
  };
};

type UploadGrantResult =
  | { status: "upgrade-required" }
  | { status: "conflict"; version: number }
  | { status: "unchanged"; version: number; updatedAt: number }
  | { status: "upload"; token: string; version: number; expiresAt: number };

type CommitResult =
  | { status: "upgrade-required" }
  | { status: "conflict"; version: number; cleanupToken: string | null }
  | {
      status: "committed";
      version: number;
      updatedAt: number;
      snapshotCreated: boolean;
      cleanupToken: string | null;
    };

export type DocContentSaveResult =
  | { status: "saved"; version: number; hash: string }
  | { status: "conflict"; version: number }
  | { status: "upgrade-required" };

export const saveDocContent = async (args: {
  docId: string;
  markdown: string;
  expectedVersion: number;
  createUploadGrant: (args: {
    docId: string;
    clientSaveProtocol: number;
    expectedVersion: number;
    encoding: typeof DOC_CONTENT_ENCODING;
    rawSize: number;
    compressedSize: number;
    rawSha256: string;
    compressedSha256: string;
    assetIds: string[];
    assetRefsHash: string;
    assetCount: number;
  }) => Promise<UploadGrantResult>;
  commitUpload: (args: {
    clientSaveProtocol: number;
    token: string;
    etag: string;
  }) => Promise<CommitResult>;
  abandonUpload: (args: { token: string }) => Promise<unknown>;
}): Promise<DocContentSaveResult> => {
  const compressed = await compressDocMarkdown(args.markdown);
  const { bytes, ...integrity } = compressed;
  const assetIds = extractManagedDocAssetIds(args.markdown);
  const assetRefsHash = await sha256Hex(
    new TextEncoder().encode(assetIds.join("\n")),
  );
  const grant = await args.createUploadGrant({
    docId: args.docId,
    clientSaveProtocol: DOC_CONTENT_SAVE_PROTOCOL_VERSION,
    expectedVersion: args.expectedVersion,
    ...integrity,
    assetIds,
    assetRefsHash,
    assetCount: assetIds.length,
  });
  if (grant.status === "unchanged") {
    return {
      status: "saved",
      version: grant.version,
      hash: compressed.rawSha256,
    };
  }
  if (grant.status !== "upload") {
    return grant;
  }
  try {
    const response = await fetch(DOC_CONTENT_ROUTE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${grant.token}`,
        "Content-Type": DOC_CONTENT_CONTENT_TYPE,
        [DOC_CONTENT_ENCODING_HEADER]: DOC_CONTENT_ENCODING,
      },
      body: bytes,
    });
    if (!response.ok) {
      throw new Error(`Doc content upload failed (${response.status})`);
    }
    const { etag } = (await response.json()) as { etag: string };
    const committed = await args.commitUpload({
      clientSaveProtocol: DOC_CONTENT_SAVE_PROTOCOL_VERSION,
      token: grant.token,
      etag,
    });
    if (committed.status === "committed") {
      return {
        status: "saved",
        version: committed.version,
        hash: compressed.rawSha256,
      };
    }
    return committed;
  } catch (cause) {
    await args.abandonUpload({ token: grant.token }).catch(() => undefined);
    throw cause;
  }
};
