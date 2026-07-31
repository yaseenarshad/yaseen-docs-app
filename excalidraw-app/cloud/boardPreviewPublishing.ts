import type {
  BoardPreviewImage,
  BoardPreviewScene,
} from "./boardPreviewGeneration";

type CleanupResult = { assetDeleteToken: string | null };

type BoardPreviewPublishingDependencies = {
  createImage: (scene: BoardPreviewScene) => Promise<BoardPreviewImage | null>;
  createUploadGrant: (args: {
    boardId: string;
    sourceVersion: number;
    mimeType: string;
    size: number;
    width: number;
    height: number;
  }) => Promise<{ token: string }>;
  upload: (
    token: string,
    preview: BoardPreviewImage,
  ) => Promise<{ etag: string }>;
  registerUpload: (args: {
    token: string;
    etag: string;
  }) => Promise<CleanupResult & { status: "registered" | "stale" }>;
  recordEmpty: (args: {
    boardId: string;
    sourceVersion: number;
  }) => Promise<CleanupResult>;
  cleanup: (token: string) => Promise<void>;
  onCleanupError: (error: unknown) => void;
};

const cleanupPreviousObject = async (
  result: CleanupResult,
  dependencies: BoardPreviewPublishingDependencies,
) => {
  if (!result.assetDeleteToken) {
    return;
  }
  try {
    await dependencies.cleanup(result.assetDeleteToken);
  } catch (error) {
    dependencies.onCleanupError(error);
  }
};

export const publishBoardPreview = async (
  request: {
    boardId: string;
    sourceVersion: number;
    scene: BoardPreviewScene;
    isCurrent?: () => boolean;
  },
  dependencies: BoardPreviewPublishingDependencies,
) => {
  const preview = await dependencies.createImage(request.scene);
  if (request.isCurrent && !request.isCurrent()) {
    return;
  }
  if (!preview) {
    const result = await dependencies.recordEmpty({
      boardId: request.boardId,
      sourceVersion: request.sourceVersion,
    });
    await cleanupPreviousObject(result, dependencies);
    return;
  }
  const { token } = await dependencies.createUploadGrant({
    boardId: request.boardId,
    sourceVersion: request.sourceVersion,
    mimeType: preview.mimeType,
    size: preview.blob.size,
    width: preview.width,
    height: preview.height,
  });
  const { etag } = await dependencies.upload(token, preview);
  const result = await dependencies.registerUpload({ token, etag });
  await cleanupPreviousObject(result, dependencies);
};
