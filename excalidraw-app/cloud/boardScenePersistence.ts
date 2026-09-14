import { deflate } from "pako";

import { assertBoardSceneRawSize } from "../../board-scenes/sizePolicy";
import { inflateBoardScene } from "../../board-scenes/compression";

import {
  BOARD_SCENE_CONTENT_TYPE,
  BOARD_SCENE_ENCODING,
  BOARD_SCENE_ENCODING_HEADER,
  BOARD_SCENE_ROUTE,
  MAX_BOARD_SCENE_RAW_BYTES,
  MAX_BOARD_SCENE_COMPRESSED_BYTES,
} from "../../board-scenes/types";
import {
  DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
  describeDocPlacementRefs,
} from "../../doc-placement/types";

import { DOCS_ENABLED } from "../docs/docsMode";

import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
import { getCloudSceneSemanticRevision } from "./cloudSceneSync";

import type { DocPlacementRef } from "../../doc-placement/types";

/**
 * The integrity contract the client declares before it is allowed to upload a
 * scene. Exactly the fields `boardScenes.createUploadGrant` validates.
 */
export type BoardSceneIntegrity = {
  encoding: typeof BOARD_SCENE_ENCODING;
  rawSize: number;
  compressedSize: number;
  rawSha256: string;
  compressedSha256: string;
  semanticSha256: string;
};

export type CompressedBoardScene = BoardSceneIntegrity & { bytes: Uint8Array };

export type BoardSceneUploadGrant =
  | { status: "upgrade-required" }
  | { status: "conflict"; version: number }
  | { status: "unchanged"; version: number; updatedAt: number }
  | {
      status: "upload";
      token: string;
      version: number;
      expiresAt: number;
    };

export type BoardSceneCommit =
  | { status: "upgrade-required" }
  | { status: "conflict"; version: number; cleanupToken: string | null }
  | {
      status: "committed";
      version: number;
      updatedAt: number;
      snapshotCreated: boolean;
      cleanupToken: string | null;
    };

export type BoardSceneReadGrant = BoardSceneIntegrity & {
  token: string;
  path: string;
  version: number;
  expiresAt: number;
  etag: string;
};

export type BoardSceneSaveDependencies = {
  createUploadGrant: (
    args: BoardSceneIntegrity & {
      boardId: string;
      clientSaveProtocol: number;
      purpose: "migration" | "save";
      expectedVersion: number;
      docRefsProtocolVersion?: number;
      docRefsHash?: string;
      docRefs?: DocPlacementRef[];
    },
  ) => Promise<BoardSceneUploadGrant>;
  upload: (
    token: string,
    scene: CompressedBoardScene,
  ) => Promise<{ etag: string }>;
  commitUpload: (args: {
    clientSaveProtocol: number;
    token: string;
    etag: string;
  }) => Promise<BoardSceneCommit>;
  abandonUpload: (args: {
    token: string;
  }) => Promise<{ cleanupToken: string | null }>;
  cleanup: (cleanupToken: string) => Promise<void>;
};

export type BoardSceneReadDependencies = {
  createReadGrant: (
    args: { boardId: string } | { shareToken: string },
  ) => Promise<BoardSceneReadGrant>;
  fetchObject: (path: string) => Promise<Uint8Array>;
};

/** What a single save attempt settled on. `conflict` never advances a version. */
export type BoardSceneSaveResult =
  | { status: "upgrade-required" }
  | { status: "conflict"; version: number }
  | { status: "unchanged"; version: number; updatedAt: number }
  | {
      status: "committed";
      version: number;
      updatedAt: number;
      snapshotCreated: boolean;
    };

export const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.slice().buffer as ArrayBuffer,
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * The binding-insensitive projection the semantic digest is taken over. A scene
 * that is not parseable JSON still gets a stable digest rather than throwing:
 * the Worker is what rejects a malformed scene, not the hashing step.
 */
const getBoardSceneSemanticSource = (sceneJson: string) => {
  try {
    return getCloudSceneSemanticRevision(sceneJson);
  } catch {
    return sceneJson;
  }
};

/**
 * Compresses and hashes a scene exactly once per save attempt: the same bytes
 * are declared to Convex, sent to the Worker, and re-declared on commit.
 */
export const compressBoardScene = async (
  sceneJson: string,
): Promise<CompressedBoardScene> => {
  const raw = new TextEncoder().encode(sceneJson);
  assertBoardSceneRawSize(raw.byteLength);
  const bytes = deflate(raw);
  if (bytes.byteLength > MAX_BOARD_SCENE_COMPRESSED_BYTES) {
    throw new Error("Board scene compressed representation is too large");
  }
  const [rawSha256, compressedSha256, semanticSha256] = await Promise.all([
    sha256Hex(raw),
    sha256Hex(bytes),
    sha256Hex(new TextEncoder().encode(getBoardSceneSemanticSource(sceneJson))),
  ]);
  return {
    bytes,
    encoding: BOARD_SCENE_ENCODING,
    rawSize: raw.byteLength,
    compressedSize: bytes.byteLength,
    rawSha256,
    compressedSha256,
    semanticSha256,
  };
};

export const uploadBoardSceneObject = async (
  token: string,
  scene: CompressedBoardScene,
) => {
  const response = await fetch(BOARD_SCENE_ROUTE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": BOARD_SCENE_CONTENT_TYPE,
      [BOARD_SCENE_ENCODING_HEADER]: scene.encoding,
    },
    body: scene.bytes.slice().buffer as ArrayBuffer,
  });
  const body = (await response.json()) as { etag?: string; error?: string };
  if (!response.ok || !body.etag) {
    throw new Error(body.error || "Board scene upload failed");
  }
  return { etag: body.etag };
};

export const fetchBoardSceneObject = async (path: string) => {
  const response = await fetch(path, { method: "GET" });
  if (!response.ok) {
    throw new Error("Board scene could not be downloaded");
  }
  return new Uint8Array(await response.arrayBuffer());
};

/** Cleanup is best-effort work: it never blocks or fails a durable commit. */
export const cleanupBoardSceneObjects = async (cleanupToken: string) => {
  const response = await fetch(BOARD_SCENE_ROUTE, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${cleanupToken}` },
  });
  if (!response.ok) {
    throw new Error("Board scene cleanup failed");
  }
};

const drainCleanup = async (
  cleanupToken: string | null,
  dependencies: BoardSceneSaveDependencies,
) => {
  if (!cleanupToken) {
    return;
  }
  try {
    await dependencies.cleanup(cleanupToken);
  } catch (error) {
    console.warn("Could not clean up a retired Board scene object", error);
  }
};

const runBoardSceneUpload = async (
  input: {
    boardId: string;
    purpose: "migration" | "save";
    expectedVersion: number;
    sceneJson: string;
    acceptedDocRefsHash?: string;
  },
  dependencies: BoardSceneSaveDependencies,
): Promise<BoardSceneSaveResult> => {
  const [compressed, docRefs] = await Promise.all([
    compressBoardScene(input.sceneJson),
    DOCS_ENABLED
      ? describeDocPlacementRefs(input.sceneJson)
      : Promise.resolve(null),
  ]);
  const grant = await dependencies.createUploadGrant({
    boardId: input.boardId,
    clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
    purpose: input.purpose,
    expectedVersion: input.expectedVersion,
    encoding: compressed.encoding,
    rawSize: compressed.rawSize,
    compressedSize: compressed.compressedSize,
    rawSha256: compressed.rawSha256,
    compressedSha256: compressed.compressedSha256,
    semanticSha256: compressed.semanticSha256,
    ...(docRefs
      ? {
          docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
          docRefsHash: docRefs.hash,
          ...(input.acceptedDocRefsHash === docRefs.hash
            ? null
            : { docRefs: docRefs.refs }),
        }
      : null),
  });
  if (grant.status !== "upload") {
    return grant;
  }

  let etag: string;
  try {
    ({ etag } = await dependencies.upload(grant.token, compressed));
  } catch (error) {
    // A grant is single-use, so a failed upload has to be handed back before a
    // retry can mint a fresh one — and its orphan object has to be swept.
    try {
      const { cleanupToken } = await dependencies.abandonUpload({
        token: grant.token,
      });
      await drainCleanup(cleanupToken, dependencies);
    } catch (abandonError) {
      console.warn(
        "Could not abandon a failed Board scene upload",
        abandonError,
      );
    }
    throw error;
  }

  const commit = await dependencies.commitUpload({
    clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
    token: grant.token,
    etag,
  });
  if (commit.status === "upgrade-required") {
    return commit;
  }
  await drainCleanup(commit.cleanupToken, dependencies);
  return commit.status === "conflict"
    ? { status: "conflict", version: commit.version }
    : {
        status: "committed",
        version: commit.version,
        updatedAt: commit.updatedAt,
        snapshotCreated: commit.snapshotCreated,
      };
};

export const saveBoardScene = async (
  input: {
    boardId: string;
    expectedVersion: number;
    sceneJson: string;
    acceptedDocRefsHash?: string;
  },
  dependencies: BoardSceneSaveDependencies,
) => await runBoardSceneUpload({ ...input, purpose: "save" }, dependencies);

/**
 * Migration registers the legacy scene the owner just opened as this Board's
 * first R2 object. It is not an edit: the version and modified time do not move.
 */
export const migrateBoardScene = async (
  input: {
    boardId: string;
    expectedVersion: number;
    sceneJson: string;
    acceptedDocRefsHash?: string;
  },
  dependencies: BoardSceneSaveDependencies,
) =>
  await runBoardSceneUpload({ ...input, purpose: "migration" }, dependencies);

export const readBoardScene = async (
  request: { boardId: string } | { shareToken: string },
  dependencies: BoardSceneReadDependencies,
) => {
  const grant = await dependencies.createReadGrant(request);
  if (
    !Number.isSafeInteger(grant.rawSize) ||
    grant.rawSize < 1 ||
    grant.rawSize > MAX_BOARD_SCENE_RAW_BYTES ||
    !Number.isSafeInteger(grant.compressedSize) ||
    grant.compressedSize < 1 ||
    grant.compressedSize > MAX_BOARD_SCENE_COMPRESSED_BYTES
  ) {
    throw new Error("Board scene has invalid size metadata");
  }
  const bytes = await dependencies.fetchObject(grant.path);
  if (bytes.byteLength !== grant.compressedSize) {
    throw new Error("Board scene download is incomplete");
  }
  if ((await sha256Hex(bytes)) !== grant.compressedSha256) {
    throw new Error("Board scene failed its integrity check");
  }
  const raw = inflateBoardScene(bytes, grant.rawSize);
  if (
    raw.byteLength !== grant.rawSize ||
    (await sha256Hex(raw)) !== grant.rawSha256
  ) {
    throw new Error("Board scene failed its integrity check");
  }
  return {
    sceneJson: new TextDecoder().decode(raw),
    version: grant.version,
  };
};
