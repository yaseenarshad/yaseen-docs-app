import { deflate } from "pako";
import { ConvexError } from "convex/values";

import { inflateBoardScene } from "../board-scenes/compression";
import {
  assertBoardSceneRawSize,
  getBoardSceneSizeError,
} from "../board-scenes/sizePolicy";

import {
  BOARD_SCENE_CONTENT_TYPE,
  BOARD_SCENE_ENCODING,
  BOARD_SCENE_ENCODING_HEADER,
  BOARD_SCENE_ROUTE,
  MAX_BOARD_SCENE_COMPRESSED_BYTES,
  MAX_BOARD_SCENE_RAW_BYTES,
} from "../board-scenes/types";

import { getSceneSemanticRevision } from "./sceneConflict";

/**
 * Convex actions reach the private Worker data plane over HTTP, exactly as a
 * browser does, using capabilities minted by trusted backend code. The Worker
 * origin is deployment configuration rather than something a caller may supply.
 */
export const BOARD_SCENE_WORKER_ORIGIN_VARIABLE = "BOARD_SCENE_WORKER_ORIGIN";

const BOARD_SCENE_UNCONFIGURED_MESSAGE =
  "Board scene storage is not configured";
const BOARD_SCENE_INTEGRITY_MESSAGE = "Board scene failed its integrity check";

export type BoardSceneIntegrity = {
  encoding: typeof BOARD_SCENE_ENCODING;
  rawSize: number;
  compressedSize: number;
  rawSha256: string;
  compressedSha256: string;
  semanticSha256: string;
};

export type CompressedBoardScene = BoardSceneIntegrity & { bytes: Uint8Array };

/** Only the integrity fields a download has to be checked against. */
type BoardSceneObjectIntegrity = Omit<BoardSceneIntegrity, "semanticSha256">;

const boardSceneWorkerUrl = (path: string) => {
  const origin = process.env[BOARD_SCENE_WORKER_ORIGIN_VARIABLE]?.replace(
    /\/+$/,
    "",
  );
  if (!origin) {
    throw new Error(BOARD_SCENE_UNCONFIGURED_MESSAGE);
  }
  return `${origin}${path}`;
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
 * Compresses and hashes a scene once, producing the same integrity contract a
 * browser declares for the same bytes.
 */
export const compressBoardScene = async (
  sceneJson: string,
): Promise<CompressedBoardScene> => {
  const raw = new TextEncoder().encode(sceneJson);
  try {
    assertBoardSceneRawSize(raw.byteLength);
  } catch (error) {
    const sizeError = getBoardSceneSizeError(error);
    if (sizeError) {
      throw new ConvexError(sizeError);
    }
    throw error;
  }
  const bytes = deflate(raw);
  if (bytes.byteLength > MAX_BOARD_SCENE_COMPRESSED_BYTES) {
    throw new Error("Board scene compressed representation is too large");
  }
  const [rawSha256, compressedSha256, semanticSha256] = await Promise.all([
    sha256Hex(raw),
    sha256Hex(bytes),
    sha256Hex(new TextEncoder().encode(getSceneSemanticRevision(sceneJson))),
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

/**
 * Verifies stored bytes against the metadata Convex recorded for them before
 * they are decompressed and before anything is done with the scene.
 */
export const decompressBoardScene = async (
  bytes: Uint8Array,
  integrity: BoardSceneObjectIntegrity,
) => {
  if (
    integrity.encoding !== BOARD_SCENE_ENCODING ||
    bytes.byteLength !== integrity.compressedSize ||
    (await sha256Hex(bytes)) !== integrity.compressedSha256
  ) {
    throw new Error(BOARD_SCENE_INTEGRITY_MESSAGE);
  }
  const raw = inflateBoardScene(bytes, MAX_BOARD_SCENE_RAW_BYTES);
  if (
    raw.byteLength !== integrity.rawSize ||
    (await sha256Hex(raw)) !== integrity.rawSha256
  ) {
    throw new Error(BOARD_SCENE_INTEGRITY_MESSAGE);
  }
  return new TextDecoder().decode(raw);
};

/**
 * Reads one granted scene object. The capability path is opaque: no object key
 * is known here, and no failure message discloses one.
 */
export const downloadBoardSceneObject = async (
  path: string,
  integrity: BoardSceneObjectIntegrity,
) => {
  const url = boardSceneWorkerUrl(path);
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error("Board scene could not be downloaded");
  }
  return await decompressBoardScene(
    new Uint8Array(await response.arrayBuffer()),
    integrity,
  );
};

export const uploadBoardSceneObject = async (
  token: string,
  scene: CompressedBoardScene,
) => {
  const url = boardSceneWorkerUrl(BOARD_SCENE_ROUTE);
  const response = await fetch(url, {
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
  return body.etag;
};

/**
 * Cleanup is best-effort: a retired object that could not be swept is retried
 * by the bounded grant machinery and never fails an already durable commit.
 */
export const deleteBoardSceneObjects = async (cleanupToken: string | null) => {
  if (!cleanupToken) {
    return false;
  }
  try {
    const response = await fetch(boardSceneWorkerUrl(BOARD_SCENE_ROUTE), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${cleanupToken}` },
    });
    return response.ok;
  } catch (error) {
    console.warn("Could not clean up a retired Board scene object", error);
    return false;
  }
};
