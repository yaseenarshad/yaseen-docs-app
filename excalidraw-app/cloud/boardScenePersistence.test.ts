import { deflate, inflate } from "pako";
import { describe, expect, it, vi } from "vitest";

import { BOARD_SCENE_ENCODING } from "../../board-scenes/types";
import {
  DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
  describeDocPlacementRefs,
} from "../../doc-placement/types";

import {
  compressBoardScene,
  migrateBoardScene,
  readBoardScene,
  saveBoardScene,
  sha256Hex,
} from "./boardScenePersistence";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";

import type {
  BoardSceneReadDependencies,
  BoardSceneSaveDependencies,
} from "./boardScenePersistence";

const scene = JSON.stringify({
  type: "excalidraw",
  elements: [{ id: "a", boundElements: [{ id: "b", type: "arrow" }] }],
  appState: {},
});

const saveDependencies = () => {
  const createUploadGrant =
    vi.fn<BoardSceneSaveDependencies["createUploadGrant"]>();
  createUploadGrant.mockResolvedValue({
    status: "upload",
    token: "upload-token",
    version: 3,
    expiresAt: 1_000,
  });
  const upload = vi.fn<BoardSceneSaveDependencies["upload"]>();
  upload.mockResolvedValue({ etag: "etag-v3" });
  const commitUpload = vi.fn<BoardSceneSaveDependencies["commitUpload"]>();
  commitUpload.mockResolvedValue({
    status: "committed",
    version: 3,
    updatedAt: 42,
    snapshotCreated: false,
    cleanupToken: null,
  });
  const abandonUpload = vi.fn<BoardSceneSaveDependencies["abandonUpload"]>();
  abandonUpload.mockResolvedValue({ cleanupToken: "abandon-cleanup" });
  const cleanup = vi.fn<BoardSceneSaveDependencies["cleanup"]>();
  cleanup.mockResolvedValue(undefined);
  return { createUploadGrant, upload, commitUpload, abandonUpload, cleanup };
};

const readDependencies = async (
  sceneJson = scene,
  overrides: Partial<{ compressedSize: number; rawSha256: string }> = {},
) => {
  const compressed = await compressBoardScene(sceneJson);
  const createReadGrant =
    vi.fn<BoardSceneReadDependencies["createReadGrant"]>();
  createReadGrant.mockResolvedValue({
    token: "read-token",
    path: "/api/board-scenes/read-token",
    version: 7,
    expiresAt: 5_000,
    encoding: BOARD_SCENE_ENCODING,
    rawSize: compressed.rawSize,
    compressedSize: compressed.compressedSize,
    rawSha256: compressed.rawSha256,
    compressedSha256: compressed.compressedSha256,
    semanticSha256: compressed.semanticSha256,
    etag: "etag-v7",
    ...overrides,
  });
  const fetchObject = vi.fn<BoardSceneReadDependencies["fetchObject"]>();
  fetchObject.mockResolvedValue(compressed.bytes);
  return { compressed, createReadGrant, fetchObject };
};

describe("board scene compression", () => {
  it("rejects an oversized UTF-8 scene before requesting an upload", async () => {
    const dependencies = saveDependencies();
    await expect(
      saveBoardScene(
        {
          boardId: "board-id",
          expectedVersion: 1,
          sceneJson: "é".repeat(5_000_001),
        },
        dependencies,
      ),
    ).rejects.toMatchObject({
      data: {
        code: "BOARD_SCENE_TOO_LARGE",
        rawSize: 10_000_002,
        maxRawSize: 10_000_000,
      },
    });
    expect(dependencies.createUploadGrant).not.toHaveBeenCalled();
    expect(dependencies.upload).not.toHaveBeenCalled();
  });

  it("refuses a compressed download expanding beyond its declared raw size", async () => {
    const dependencies = await readDependencies();
    const bytes = deflate(new TextEncoder().encode("x".repeat(10_000_001)));
    dependencies.fetchObject.mockResolvedValue(bytes);
    const original = await dependencies.createReadGrant({
      boardId: "board-id",
    });
    dependencies.createReadGrant.mockResolvedValue({
      ...original,
      rawSize: 10_000_000,
      compressedSize: bytes.byteLength,
      compressedSha256: await sha256Hex(bytes),
    });
    await expect(
      readBoardScene({ boardId: "board-id" }, dependencies),
    ).rejects.toThrow("too large");
  });
  it("compresses once into zlib bytes with matching exact hashes", async () => {
    const compressed = await compressBoardScene(scene);
    const raw = new TextEncoder().encode(scene);

    expect(compressed.encoding).toBe(BOARD_SCENE_ENCODING);
    expect(compressed.rawSize).toBe(raw.byteLength);
    expect(compressed.compressedSize).toBe(compressed.bytes.byteLength);
    expect(compressed.rawSha256).toBe(await sha256Hex(raw));
    expect(compressed.compressedSha256).toBe(await sha256Hex(compressed.bytes));
    expect(new TextDecoder().decode(inflate(compressed.bytes))).toBe(scene);
    expect(compressed.bytes).toEqual(deflate(raw));
  });

  it("hashes bindings out of the semantic digest so an echo is recognisable", async () => {
    const withBindings = await compressBoardScene(scene);
    const withoutBindings = await compressBoardScene(
      JSON.stringify({
        type: "excalidraw",
        elements: [{ id: "a" }],
        appState: {},
      }),
    );
    const changed = await compressBoardScene(
      JSON.stringify({
        type: "excalidraw",
        elements: [{ id: "a", x: 1 }],
        appState: {},
      }),
    );

    expect(withBindings.semanticSha256).toBe(withoutBindings.semanticSha256);
    expect(withBindings.rawSha256).not.toBe(withoutBindings.rawSha256);
    expect(withBindings.semanticSha256).not.toBe(changed.semanticSha256);
  });

  it("still hashes a scene that is not valid JSON", async () => {
    await expect(compressBoardScene("not json")).resolves.toEqual(
      expect.objectContaining({ semanticSha256: expect.any(String) }),
    );
  });
});

describe("board scene save", () => {
  it("uploads the compressed scene once and commits it", async () => {
    const dependencies = saveDependencies();

    const result = await saveBoardScene(
      { boardId: "board-id", expectedVersion: 2, sceneJson: scene },
      dependencies,
    );

    const compressed = await compressBoardScene(scene);
    const docRefs = await describeDocPlacementRefs(scene);
    expect(dependencies.createUploadGrant).toHaveBeenCalledWith({
      boardId: "board-id",
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      purpose: "save",
      expectedVersion: 2,
      encoding: BOARD_SCENE_ENCODING,
      rawSize: compressed.rawSize,
      compressedSize: compressed.compressedSize,
      rawSha256: compressed.rawSha256,
      compressedSha256: compressed.compressedSha256,
      semanticSha256: compressed.semanticSha256,
      docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
      docRefsHash: docRefs.hash,
      docRefs: [],
    });
    expect(dependencies.upload).toHaveBeenCalledWith(
      "upload-token",
      expect.objectContaining({
        compressedSha256: compressed.compressedSha256,
      }),
    );
    expect(dependencies.commitUpload).toHaveBeenCalledWith({
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      token: "upload-token",
      etag: "etag-v3",
    });
    expect(result).toEqual({
      status: "committed",
      version: 3,
      updatedAt: 42,
      snapshotCreated: false,
    });
  });

  it("omits the full Doc refs when their accepted manifest hash is unchanged", async () => {
    const dependencies = saveDependencies();
    const docRefs = await describeDocPlacementRefs(scene);

    await saveBoardScene(
      {
        boardId: "board-id",
        expectedVersion: 2,
        sceneJson: scene,
        acceptedDocRefsHash: docRefs.hash,
      },
      dependencies,
    );

    expect(dependencies.createUploadGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
        docRefsHash: docRefs.hash,
      }),
    );
    expect(dependencies.createUploadGrant.mock.calls[0][0]).not.toHaveProperty(
      "docRefs",
    );
  });

  it("treats a binding echo as saved without uploading anything", async () => {
    const dependencies = saveDependencies();
    dependencies.createUploadGrant.mockResolvedValue({
      status: "unchanged",
      version: 2,
      updatedAt: 11,
    });

    const result = await saveBoardScene(
      { boardId: "board-id", expectedVersion: 2, sceneJson: scene },
      dependencies,
    );

    expect(dependencies.upload).not.toHaveBeenCalled();
    expect(dependencies.commitUpload).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "unchanged", version: 2, updatedAt: 11 });
  });

  it("stops before uploading when the grant already conflicts", async () => {
    const dependencies = saveDependencies();
    dependencies.createUploadGrant.mockResolvedValue({
      status: "conflict",
      version: 5,
    });

    const result = await saveBoardScene(
      { boardId: "board-id", expectedVersion: 2, sceneJson: scene },
      dependencies,
    );

    expect(dependencies.upload).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "conflict", version: 5 });
  });

  it("drains the cleanup capability a losing commit hands back", async () => {
    const dependencies = saveDependencies();
    dependencies.commitUpload.mockResolvedValue({
      status: "conflict",
      version: 6,
      cleanupToken: "orphan-cleanup",
    });

    const result = await saveBoardScene(
      { boardId: "board-id", expectedVersion: 2, sceneJson: scene },
      dependencies,
    );

    expect(result).toEqual({ status: "conflict", version: 6 });
    expect(dependencies.cleanup).toHaveBeenCalledWith("orphan-cleanup");
  });

  it("drains the superseded object a commit hands back", async () => {
    const dependencies = saveDependencies();
    dependencies.commitUpload.mockResolvedValue({
      status: "committed",
      version: 3,
      updatedAt: 42,
      snapshotCreated: false,
      cleanupToken: "superseded-object",
    });

    await saveBoardScene(
      { boardId: "board-id", expectedVersion: 2, sceneJson: scene },
      dependencies,
    );

    expect(dependencies.cleanup).toHaveBeenCalledWith("superseded-object");
  });

  it("never fails a durable save because cleanup failed", async () => {
    const dependencies = saveDependencies();
    dependencies.commitUpload.mockResolvedValue({
      status: "committed",
      version: 3,
      updatedAt: 42,
      snapshotCreated: false,
      cleanupToken: "superseded-object",
    });
    dependencies.cleanup.mockRejectedValue(new Error("R2 unavailable"));

    await expect(
      saveBoardScene(
        { boardId: "board-id", expectedVersion: 2, sceneJson: scene },
        dependencies,
      ),
    ).resolves.toEqual(expect.objectContaining({ status: "committed" }));
  });

  it("reports an outdated client without uploading", async () => {
    const dependencies = saveDependencies();
    dependencies.createUploadGrant.mockResolvedValue({
      status: "upgrade-required",
    });

    const result = await saveBoardScene(
      { boardId: "board-id", expectedVersion: 2, sceneJson: scene },
      dependencies,
    );

    expect(dependencies.upload).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "upgrade-required" });
  });

  it("abandons the grant and cleans up when the upload fails", async () => {
    const dependencies = saveDependencies();
    dependencies.upload.mockRejectedValue(new Error("offline"));

    await expect(
      saveBoardScene(
        { boardId: "board-id", expectedVersion: 2, sceneJson: scene },
        dependencies,
      ),
    ).rejects.toThrow("offline");

    expect(dependencies.abandonUpload).toHaveBeenCalledWith({
      token: "upload-token",
    });
    expect(dependencies.cleanup).toHaveBeenCalledWith("abandon-cleanup");
    expect(dependencies.commitUpload).not.toHaveBeenCalled();
  });

  it("keeps the upload failure visible when abandoning also fails", async () => {
    const dependencies = saveDependencies();
    dependencies.upload.mockRejectedValue(new Error("offline"));
    dependencies.abandonUpload.mockRejectedValue(new Error("also offline"));

    await expect(
      saveBoardScene(
        { boardId: "board-id", expectedVersion: 2, sceneJson: scene },
        dependencies,
      ),
    ).rejects.toThrow("offline");
  });

  it("migrates a legacy Board at its current version", async () => {
    const dependencies = saveDependencies();
    dependencies.createUploadGrant.mockResolvedValue({
      status: "upload",
      token: "migration-token",
      version: 2,
      expiresAt: 1_000,
    });
    dependencies.commitUpload.mockResolvedValue({
      status: "committed",
      version: 2,
      updatedAt: 7,
      snapshotCreated: false,
      cleanupToken: null,
    });

    const result = await migrateBoardScene(
      { boardId: "board-id", expectedVersion: 2, sceneJson: scene },
      dependencies,
    );

    expect(dependencies.createUploadGrant).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "migration", expectedVersion: 2 }),
    );
    expect(result).toEqual(
      expect.objectContaining({ status: "committed", version: 2 }),
    );
  });
});

describe("board scene read", () => {
  it("verifies and decompresses the private object", async () => {
    const { createReadGrant, fetchObject } = await readDependencies();

    const result = await readBoardScene(
      { boardId: "board-id" },
      { createReadGrant, fetchObject },
    );

    expect(createReadGrant).toHaveBeenCalledWith({ boardId: "board-id" });
    expect(fetchObject).toHaveBeenCalledWith("/api/board-scenes/read-token");
    expect(result).toEqual({ sceneJson: scene, version: 7 });
  });

  it("authorizes a shared viewer with the share token", async () => {
    const { createReadGrant, fetchObject } = await readDependencies();

    await readBoardScene(
      { shareToken: "share-token" },
      { createReadGrant, fetchObject },
    );

    expect(createReadGrant).toHaveBeenCalledWith({ shareToken: "share-token" });
  });

  it("refuses an object whose compressed size does not match the grant", async () => {
    const { createReadGrant, fetchObject } = await readDependencies(scene, {
      compressedSize: 3,
    });

    await expect(
      readBoardScene({ boardId: "board-id" }, { createReadGrant, fetchObject }),
    ).rejects.toThrow("Board scene download is incomplete");
  });

  it("refuses an object whose decompressed checksum does not match", async () => {
    const { createReadGrant, fetchObject } = await readDependencies(scene, {
      rawSha256: "b".repeat(64),
    });

    await expect(
      readBoardScene({ boardId: "board-id" }, { createReadGrant, fetchObject }),
    ).rejects.toThrow("Board scene failed its integrity check");
  });

  it("refuses bytes that cannot be decompressed", async () => {
    const { createReadGrant } = await readDependencies();
    const fetchObject = vi.fn<BoardSceneReadDependencies["fetchObject"]>();
    const corrupted = (await compressBoardScene(scene)).bytes.slice();
    corrupted[corrupted.length - 1] ^= 0xff;
    corrupted[corrupted.length - 2] ^= 0xff;
    fetchObject.mockResolvedValue(corrupted);

    await expect(
      readBoardScene({ boardId: "board-id" }, { createReadGrant, fetchObject }),
    ).rejects.toThrow("Board scene");
  });
});
