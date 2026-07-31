import { describe, expect, it, vi } from "vitest";

import { publishBoardPreview } from "./boardPreviewPublishing";

import type {
  BoardPreviewImage,
  BoardPreviewScene,
} from "./boardPreviewGeneration";

const scene = {} as BoardPreviewScene;

const makeDependencies = () => ({
  createImage: vi.fn(
    async (): Promise<BoardPreviewImage | null> => ({
      blob: new Blob(["preview"], { type: "image/webp" }),
      mimeType: "image/webp",
      width: 800,
      height: 600,
    }),
  ),
  createUploadGrant: vi.fn(async () => ({ token: "upload-token" })),
  upload: vi.fn(async () => ({ etag: "etag" })),
  registerUpload: vi.fn(async () => ({
    status: "registered" as const,
    assetDeleteToken: "delete-token",
  })),
  recordEmpty: vi.fn(async () => ({ assetDeleteToken: null })),
  cleanup: vi.fn(async () => undefined),
  onCleanupError: vi.fn(),
});

describe("Board preview publishing", () => {
  it("uploads and registers the exact saved source version", async () => {
    const dependencies = makeDependencies();

    await publishBoardPreview(
      { boardId: "board-id", sourceVersion: 7, scene },
      dependencies,
    );

    expect(dependencies.createUploadGrant).toHaveBeenCalledWith({
      boardId: "board-id",
      sourceVersion: 7,
      mimeType: "image/webp",
      size: 7,
      width: 800,
      height: 600,
    });
    expect(dependencies.upload).toHaveBeenCalledWith(
      "upload-token",
      expect.objectContaining({ mimeType: "image/webp" }),
    );
    expect(dependencies.registerUpload).toHaveBeenCalledWith({
      token: "upload-token",
      etag: "etag",
    });
    expect(dependencies.cleanup).toHaveBeenCalledWith("delete-token");
  });

  it("records an empty saved version without creating an upload grant", async () => {
    const dependencies = makeDependencies();
    dependencies.createImage.mockResolvedValueOnce(null);

    await publishBoardPreview(
      { boardId: "empty-board", sourceVersion: 3, scene },
      dependencies,
    );

    expect(dependencies.recordEmpty).toHaveBeenCalledWith({
      boardId: "empty-board",
      sourceVersion: 3,
    });
    expect(dependencies.createUploadGrant).not.toHaveBeenCalled();
    expect(dependencies.upload).not.toHaveBeenCalled();
  });

  it("reports cleanup failure without failing completed registration", async () => {
    const dependencies = makeDependencies();
    const cleanupError = new Error("R2 cleanup unavailable");
    dependencies.cleanup.mockRejectedValueOnce(cleanupError);

    await expect(
      publishBoardPreview(
        { boardId: "board-id", sourceVersion: 9, scene },
        dependencies,
      ),
    ).resolves.toBeUndefined();
    expect(dependencies.onCleanupError).toHaveBeenCalledWith(cleanupError);
  });

  it("cancels before grant creation when the route changes during export", async () => {
    const dependencies = makeDependencies();
    let isCurrent = true;
    dependencies.createImage.mockImplementationOnce(async () => {
      isCurrent = false;
      return {
        blob: new Blob(["preview"], { type: "image/webp" }),
        mimeType: "image/webp",
        width: 800,
        height: 600,
      };
    });

    await publishBoardPreview(
      {
        boardId: "old-board",
        sourceVersion: 4,
        scene,
        isCurrent: () => isCurrent,
      },
      dependencies,
    );

    expect(dependencies.createUploadGrant).not.toHaveBeenCalled();
    expect(dependencies.recordEmpty).not.toHaveBeenCalled();
  });

  it("finishes registration once a grant exists so cancellation cannot strand it", async () => {
    const dependencies = makeDependencies();
    let isCurrent = true;
    dependencies.createUploadGrant.mockImplementationOnce(async () => {
      isCurrent = false;
      return { token: "issued-token" };
    });

    await publishBoardPreview(
      {
        boardId: "old-board",
        sourceVersion: 4,
        scene,
        isCurrent: () => isCurrent,
      },
      dependencies,
    );

    expect(dependencies.upload).toHaveBeenCalledWith(
      "issued-token",
      expect.any(Object),
    );
    expect(dependencies.registerUpload).toHaveBeenCalled();
  });
});
