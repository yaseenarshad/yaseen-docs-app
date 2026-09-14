import { inflate } from "pako";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

import {
  CLONE_COMMIT_FAILED_MESSAGE,
  REVOKED_SHARED_BOARD_MESSAGE,
  cloneBoardIntoOwnAccount,
  getBoardCopyTitle,
  requireSharedBoardTitle,
  shouldOfferBoardCopy,
  stripPresentationAnimationReferences,
  uploadClonedBoardAsset,
} from "./boardCloning";

import type {
  BoardAssetUploadDependencies,
  BoardCloneDependencies,
} from "./boardCloning";
import type { BoardSceneSaveDependencies } from "./boardScenePersistence";

const makeElement = (element: Record<string, unknown>) =>
  ({
    type: "rectangle",
    isDeleted: false,
    ...element,
  } as unknown as ExcalidrawElement);

const makeFile = (id: string): BinaryFileData =>
  ({
    id,
    mimeType: "image/png",
    dataURL: `data:image/png;base64,${id}`,
    created: 1,
  } as unknown as BinaryFileData);

const makeSceneSaveDependencies = () => {
  const createUploadGrant =
    vi.fn<BoardSceneSaveDependencies["createUploadGrant"]>();
  createUploadGrant.mockResolvedValue({
    status: "upload",
    token: "scene-token",
    version: 1,
    expiresAt: 1_000,
  });
  const upload = vi.fn<BoardSceneSaveDependencies["upload"]>();
  upload.mockResolvedValue(undefined);
  const finalizeUpload = vi.fn<BoardSceneSaveDependencies["finalizeUpload"]>();
  finalizeUpload.mockResolvedValue({
    status: "committed",
    version: 1,
    updatedAt: 42,
    snapshotCreated: false,
    cleanupToken: null,
  });
  const abandonUpload = vi.fn<BoardSceneSaveDependencies["abandonUpload"]>();
  abandonUpload.mockResolvedValue({ cleanupToken: null });
  const cleanup = vi.fn<BoardSceneSaveDependencies["cleanup"]>();
  cleanup.mockResolvedValue(undefined);
  return { createUploadGrant, upload, finalizeUpload, abandonUpload, cleanup };
};

const makeCloneDependencies = () => {
  const sceneSave = makeSceneSaveDependencies();
  const createBoard = vi.fn<BoardCloneDependencies<string>["createBoard"]>();
  createBoard.mockResolvedValue({
    boardId: "clone-id",
    slug: "copy-of-roadmap",
  });
  const removeBoard = vi.fn<BoardCloneDependencies<string>["removeBoard"]>();
  removeBoard.mockResolvedValue(undefined);
  const uploadAsset = vi.fn<BoardCloneDependencies<string>["uploadAsset"]>();
  uploadAsset.mockResolvedValue(undefined);
  const navigate = vi.fn<BoardCloneDependencies<string>["navigate"]>();
  return { sceneSave, createBoard, removeBoard, uploadAsset, navigate };
};

/** The scene the clone actually sent to object storage, decompressed. */
const readUploadedScene = (
  sceneSave: ReturnType<typeof makeSceneSaveDependencies>,
) =>
  JSON.parse(
    new TextDecoder().decode(inflate(sceneSave.upload.mock.calls[0][1].bytes)),
  ) as { elements: Record<string, any>[] };

const clone = async (
  overrides: {
    elements?: ExcalidrawElement[];
    files?: BinaryFiles;
    title?: string;
  },
  dependencies: ReturnType<typeof makeCloneDependencies>,
) =>
  await cloneBoardIntoOwnAccount(
    {
      title: overrides.title ?? "Roadmap",
      elements: overrides.elements ?? [makeElement({ id: "a" })],
      appState: {},
      files: overrides.files ?? {},
    },
    dependencies,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shared board copy availability", () => {
  it("offers the copy only to a signed-in viewer of a shared board", () => {
    expect(
      shouldOfferBoardCopy({
        routeKind: "shared",
        isViewer: true,
        account: { isAnonymous: false },
      }),
    ).toBe(true);
  });

  it("stays hidden for anonymous viewers and while the account is loading", () => {
    const shared = { routeKind: "shared", isViewer: true } as const;

    expect(
      shouldOfferBoardCopy({ ...shared, account: { isAnonymous: true } }),
    ).toBe(false);
    expect(shouldOfferBoardCopy({ ...shared, account: undefined })).toBe(false);
    expect(shouldOfferBoardCopy({ ...shared, account: null })).toBe(false);
  });

  it("stays hidden for owners, on home, and before the share resolves", () => {
    const account = { isAnonymous: false };

    expect(
      shouldOfferBoardCopy({ routeKind: "owner", isViewer: false, account }),
    ).toBe(false);
    expect(
      shouldOfferBoardCopy({ routeKind: "home", isViewer: false, account }),
    ).toBe(false);
    expect(
      shouldOfferBoardCopy({ routeKind: "shared", isViewer: false, account }),
    ).toBe(false);
  });
});

describe("shared board clone source", () => {
  it("fails closed when the shared board is no longer readable", () => {
    expect(() => requireSharedBoardTitle(null)).toThrow(
      REVOKED_SHARED_BOARD_MESSAGE,
    );
    expect(() => requireSharedBoardTitle(undefined)).toThrow(
      REVOKED_SHARED_BOARD_MESSAGE,
    );
    expect(() =>
      requireSharedBoardTitle({
        access: "owner",
        board: { title: "Roadmap" },
      }),
    ).toThrow(REVOKED_SHARED_BOARD_MESSAGE);
    expect(
      requireSharedBoardTitle({
        access: "viewer",
        board: { title: "Roadmap" },
      }),
    ).toBe("Roadmap");
  });

  it("titles the copy after the source board", async () => {
    const dependencies = makeCloneDependencies();

    await clone({ title: "Roadmap" }, dependencies);

    expect(getBoardCopyTitle("Roadmap")).toBe("Copy of Roadmap");
    expect(dependencies.createBoard).toHaveBeenCalledWith({
      title: "Copy of Roadmap",
    });
  });
});

describe("presentation animation references", () => {
  it("drops the hosted reference but keeps the rest of customData", () => {
    const [stripped] = stripPresentationAnimationReferences([
      makeElement({
        id: "a",
        customData: {
          animationAsset: { assetId: "asset-1", version: 2 },
          keep: "me",
        },
      }),
    ]);

    expect(stripped.customData).toEqual({ keep: "me" });
  });

  it("leaves untouched elements referentially identical", () => {
    const elements = [makeElement({ id: "a" })];

    expect(stripPresentationAnimationReferences(elements)[0]).toBe(elements[0]);
  });

  it("never writes a dangling animation reference into the copy", async () => {
    const dependencies = makeCloneDependencies();

    await clone(
      {
        elements: [
          makeElement({
            id: "a",
            customData: { animationAsset: { assetId: "asset-1", version: 2 } },
          }),
          makeElement({ id: "b" }),
        ],
      },
      dependencies,
    );

    const scene = readUploadedScene(dependencies.sceneSave);
    expect(scene.elements).toHaveLength(2);
    for (const element of scene.elements) {
      expect(element.customData?.animationAsset).toBeUndefined();
    }
  });
});

describe("cloning a shared board", () => {
  it("writes the first scene as a migration against version 0", async () => {
    const dependencies = makeCloneDependencies();

    await clone({}, dependencies);

    expect(dependencies.sceneSave.createUploadGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: "clone-id",
        purpose: "migration",
        expectedVersion: 0,
      }),
    );
  });

  it("navigates to the copy once its scene is committed", async () => {
    const dependencies = makeCloneDependencies();

    const result = await clone({}, dependencies);

    expect(result).toEqual({
      boardId: "clone-id",
      slug: "copy-of-roadmap",
      failedAssetFileIds: [],
    });
    expect(dependencies.navigate).toHaveBeenCalledWith({
      slug: "copy-of-roadmap",
    });
  });

  it("copies the bytes of every referenced image exactly once", async () => {
    const dependencies = makeCloneDependencies();

    await clone(
      {
        elements: [
          makeElement({ id: "a", type: "image", fileId: "file-1" }),
          makeElement({ id: "b", type: "image", fileId: "file-1" }),
        ],
        files: { "file-1": makeFile("file-1") },
      },
      dependencies,
    );

    expect(dependencies.uploadAsset).toHaveBeenCalledTimes(1);
    expect(dependencies.uploadAsset).toHaveBeenCalledWith({
      boardId: "clone-id",
      file: makeFile("file-1"),
    });
  });

  it("retries a failed image once and still finishes the copy", async () => {
    const dependencies = makeCloneDependencies();
    dependencies.uploadAsset.mockImplementation(async ({ file }) => {
      if (file.id === "file-2") {
        throw new Error("Image upload failed");
      }
      if (dependencies.uploadAsset.mock.calls.length === 1) {
        throw new Error("Network hiccup");
      }
    });

    const result = await clone(
      {
        elements: [
          makeElement({ id: "a", type: "image", fileId: "file-1" }),
          makeElement({ id: "b", type: "image", fileId: "file-2" }),
        ],
        files: {
          "file-1": makeFile("file-1"),
          "file-2": makeFile("file-2"),
        },
      },
      dependencies,
    );

    // one retry each: file-1 succeeds on its second attempt, file-2 never does
    expect(dependencies.uploadAsset).toHaveBeenCalledTimes(4);
    expect(result.failedAssetFileIds).toEqual(["file-2"]);
    expect(dependencies.sceneSave.finalizeUpload).toHaveBeenCalled();
    expect(dependencies.navigate).toHaveBeenCalled();
  });

  it("reports an image whose bytes never reached this viewer", async () => {
    const dependencies = makeCloneDependencies();

    const result = await clone(
      {
        elements: [makeElement({ id: "a", type: "image", fileId: "file-9" })],
        files: {},
      },
      dependencies,
    );

    expect(dependencies.uploadAsset).not.toHaveBeenCalled();
    expect(result.failedAssetFileIds).toEqual(["file-9"]);
    expect(dependencies.navigate).toHaveBeenCalled();
  });

  it("removes the empty copy when the scene write throws", async () => {
    const dependencies = makeCloneDependencies();
    dependencies.sceneSave.createUploadGrant.mockRejectedValue(
      new Error("Board scene manifest is missing"),
    );

    await expect(clone({}, dependencies)).rejects.toThrow(
      "Board scene manifest is missing",
    );
    expect(dependencies.removeBoard).toHaveBeenCalledWith({
      boardId: "clone-id",
    });
    expect(dependencies.navigate).not.toHaveBeenCalled();
  });

  it("removes the empty copy when the scene write does not commit", async () => {
    const dependencies = makeCloneDependencies();
    dependencies.sceneSave.finalizeUpload.mockResolvedValue({
      status: "conflict",
      version: 4,
      cleanupToken: null,
    });

    await expect(clone({}, dependencies)).rejects.toThrow(
      CLONE_COMMIT_FAILED_MESSAGE,
    );
    expect(dependencies.removeBoard).toHaveBeenCalledWith({
      boardId: "clone-id",
    });
    expect(dependencies.navigate).not.toHaveBeenCalled();
  });

  it("surfaces both failures when the empty copy cannot be removed", async () => {
    const dependencies = makeCloneDependencies();
    dependencies.sceneSave.createUploadGrant.mockRejectedValue(
      new Error("Share link revoked"),
    );
    dependencies.removeBoard.mockRejectedValue(new Error("Board is missing"));

    await expect(clone({}, dependencies)).rejects.toThrow(
      /Share link revoked.*Board is missing/,
    );
  });
});

describe("cloned image upload", () => {
  const assetDependencies = () => {
    const createUploadGrant =
      vi.fn<BoardAssetUploadDependencies<string>["createUploadGrant"]>();
    createUploadGrant.mockResolvedValue({ token: "asset-token" });
    const registerUpload =
      vi.fn<BoardAssetUploadDependencies<string>["registerUpload"]>();
    registerUpload.mockResolvedValue(undefined);
    return { createUploadGrant, registerUpload };
  };

  it("re-uploads the in-memory bytes through a fresh grant", async () => {
    const fetchMock = vi.fn(async (input: unknown) =>
      typeof input === "string" && input.startsWith("data:")
        ? ({ blob: async () => new Blob(["1234"]) } as unknown as Response)
        : ({
            ok: true,
            json: async () => ({ etag: "asset-etag" }),
          } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dependencies = assetDependencies();

    await uploadClonedBoardAsset(
      { boardId: "clone-id", file: makeFile("file-1") },
      dependencies,
    );

    expect(dependencies.createUploadGrant).toHaveBeenCalledWith({
      boardId: "clone-id",
      fileId: "file-1",
      mimeType: "image/png",
      size: 4,
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/assets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer asset-token",
        }),
      }),
    );
    expect(dependencies.registerUpload).toHaveBeenCalledWith({
      token: "asset-token",
      etag: "asset-etag",
    });
  });

  it("surfaces the server's reason for a rejected image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) =>
        typeof input === "string" && input.startsWith("data:")
          ? ({ blob: async () => new Blob(["1234"]) } as unknown as Response)
          : ({
              ok: false,
              json: async () => ({ error: "Image is too large" }),
            } as unknown as Response),
      ),
    );
    const dependencies = assetDependencies();

    await expect(
      uploadClonedBoardAsset(
        { boardId: "clone-id", file: makeFile("file-1") },
        dependencies,
      ),
    ).rejects.toThrow("Image is too large");
    expect(dependencies.registerUpload).not.toHaveBeenCalled();
  });
});
