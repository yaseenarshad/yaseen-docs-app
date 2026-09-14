// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { deflate } from "pako";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BOARD_SCENE_CONTENT_TYPE,
  BOARD_SCENE_ENCODING,
  BOARD_SCENE_ENCODING_HEADER,
  BOARD_SCENE_ROUTE,
  MAX_BOARD_SCENE_RAW_BYTES,
} from "../board-scenes/types";
import { getBoardSceneSizeError } from "../board-scenes/sizePolicy";

import {
  BOARD_SCENE_WORKER_ORIGIN_VARIABLE,
  compressBoardScene,
  decompressBoardScene,
  deleteBoardSceneObjects,
  downloadBoardSceneObject,
  sha256Hex,
  uploadBoardSceneObject,
} from "./boardSceneTransport";
import { getSceneSemanticRevision } from "./sceneConflict";

const WORKER_ORIGIN = "https://scenes.example.test";

const sceneJson = JSON.stringify({
  elements: [{ id: "rect-1", type: "rectangle", version: 2 }],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

const sceneAtRawSize = (rawSize: number) => {
  const prefix = '{"elements":[],"appState":{"padding":"';
  const suffix = '"},"files":{}}';
  return `${prefix}${"x".repeat(
    rawSize - prefix.length - suffix.length,
  )}${suffix}`;
};

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

beforeEach(() => {
  vi.stubEnv(BOARD_SCENE_WORKER_ORIGIN_VARIABLE, WORKER_ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Board scene compression", () => {
  it("accepts a scene exactly at the raw byte ceiling", async () => {
    const scene = sceneAtRawSize(MAX_BOARD_SCENE_RAW_BYTES);

    const compressed = await compressBoardScene(scene);

    expect(compressed.rawSize).toBe(MAX_BOARD_SCENE_RAW_BYTES);
    await expect(
      decompressBoardScene(compressed.bytes, compressed),
    ).resolves.toBe(scene);
  });

  it("rejects a scene one raw byte over the ceiling", async () => {
    const rawSize = MAX_BOARD_SCENE_RAW_BYTES + 1;

    const error = await compressBoardScene(sceneAtRawSize(rawSize)).catch(
      (caught: unknown) => caught,
    );

    expect(getBoardSceneSizeError(error)).toEqual({
      code: "BOARD_SCENE_TOO_LARGE",
      rawSize,
      maxRawSize: MAX_BOARD_SCENE_RAW_BYTES,
    });
  });

  it("declares the same integrity contract the client declares", async () => {
    const compressed = await compressBoardScene(sceneJson);

    expect(compressed.encoding).toBe(BOARD_SCENE_ENCODING);
    expect(compressed.rawSize).toBe(
      new TextEncoder().encode(sceneJson).byteLength,
    );
    expect(compressed.compressedSize).toBe(compressed.bytes.byteLength);
    expect(compressed.rawSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(compressed.compressedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(compressed.semanticSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      decompressBoardScene(compressed.bytes, compressed),
    ).resolves.toBe(sceneJson);
  });

  it("takes the semantic digest over the binding-insensitive projection", async () => {
    const withBindings = JSON.stringify({
      elements: [
        { id: "rect-1", type: "rectangle", version: 2, boundElements: [] },
      ],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });
    const withoutBindings = JSON.stringify({
      elements: [{ id: "rect-1", type: "rectangle", version: 2 }],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });

    const [bound, unbound] = await Promise.all([
      compressBoardScene(withBindings),
      compressBoardScene(withoutBindings),
    ]);

    expect(getSceneSemanticRevision(withBindings)).toBe(
      getSceneSemanticRevision(withoutBindings),
    );
    expect(bound.semanticSha256).toBe(unbound.semanticSha256);
    expect(bound.rawSha256).not.toBe(unbound.rawSha256);
  });

  it("refuses bytes that do not match the declared integrity contract", async () => {
    const compressed = await compressBoardScene(sceneJson);

    await expect(
      decompressBoardScene(compressed.bytes, {
        ...compressed,
        compressedSize: compressed.compressedSize + 1,
      }),
    ).rejects.toThrow("Board scene failed its integrity check");
    await expect(
      decompressBoardScene(compressed.bytes, {
        ...compressed,
        compressedSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("Board scene failed its integrity check");
    await expect(
      decompressBoardScene(compressed.bytes, {
        ...compressed,
        rawSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("Board scene failed its integrity check");
    await expect(
      decompressBoardScene(deflate(new TextEncoder().encode("{}")), {
        ...compressed,
        compressedSize: 10,
        compressedSha256: compressed.compressedSha256,
      }),
    ).rejects.toThrow("Board scene failed its integrity check");
  });

  it("stops inflating a payload that expands beyond the raw ceiling", async () => {
    const raw = new TextEncoder().encode(
      sceneAtRawSize(MAX_BOARD_SCENE_RAW_BYTES + 1),
    );
    const bytes = deflate(raw);

    await expect(
      decompressBoardScene(bytes, {
        encoding: BOARD_SCENE_ENCODING,
        compressedSize: bytes.byteLength,
        compressedSha256: await sha256Hex(bytes),
        rawSize: MAX_BOARD_SCENE_RAW_BYTES,
        rawSha256: await sha256Hex(raw),
      }),
    ).rejects.toThrow("Board scene is too large");
  });
});

describe("Board scene Worker transport", () => {
  it("downloads, verifies and decompresses a granted object", async () => {
    const compressed = await compressBoardScene(sceneJson);
    const fetchMock = vi.fn(
      async () =>
        new Response(compressed.bytes.slice().buffer as ArrayBuffer, {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadBoardSceneObject("/api/board-scenes/token", compressed),
    ).resolves.toBe(sceneJson);

    expect(fetchMock).toHaveBeenCalledWith(
      `${WORKER_ORIGIN}/api/board-scenes/token`,
      { method: "GET" },
    );
  });

  it("reports a failed download without naming the object", async () => {
    const compressed = await compressBoardScene(sceneJson);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Scene not found", { status: 404 })),
    );

    await expect(
      downloadBoardSceneObject("/api/board-scenes/token", compressed),
    ).rejects.toThrow("Board scene could not be downloaded");
  });

  it("uploads the compressed bytes as the granted capability", async () => {
    const compressed = await compressBoardScene(sceneJson);
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ etag: "etag-new" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadBoardSceneObject("upload-token", compressed),
    ).resolves.toBe("etag-new");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${WORKER_ORIGIN}${BOARD_SCENE_ROUTE}`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer upload-token",
      "Content-Type": BOARD_SCENE_CONTENT_TYPE,
      [BOARD_SCENE_ENCODING_HEADER]: BOARD_SCENE_ENCODING,
    });
  });

  it("surfaces an upload rejection as a scene error", async () => {
    const compressed = await compressBoardScene(sceneJson);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "Board scene JSON is invalid" }, { status: 400 }),
      ),
    );

    await expect(
      uploadBoardSceneObject("upload-token", compressed),
    ).rejects.toThrow("Board scene JSON is invalid");
  });

  it("treats cleanup as best-effort work that never throws", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ deleted: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteBoardSceneObjects("delete-token")).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(deleteBoardSceneObjects("delete-token")).resolves.toBe(false);
  });

  it("refuses to reach object storage when no Worker origin is configured", async () => {
    vi.stubEnv(BOARD_SCENE_WORKER_ORIGIN_VARIABLE, "");
    const compressed = await compressBoardScene(sceneJson);

    await expect(
      downloadBoardSceneObject("/api/board-scenes/token", compressed),
    ).rejects.toThrow("Board scene storage is not configured");
    await expect(
      uploadBoardSceneObject("upload-token", compressed),
    ).rejects.toThrow("Board scene storage is not configured");
    await expect(deleteBoardSceneObjects("delete-token")).resolves.toBe(false);
  });
});
