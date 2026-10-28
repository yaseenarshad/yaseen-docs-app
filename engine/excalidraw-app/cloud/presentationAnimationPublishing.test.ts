import { describe, expect, it, vi } from "vitest";

import {
  publishPresentationAnimation,
  publishAndCommitPresentationAnimation,
  withRegisteredPresentationAnimation,
  type PublishPresentationAnimationDependencies,
} from "./presentationAnimationPublishing";

const reference = {
  assetId: "lesson-animation",
  version: 2,
  mimeType: "text/html" as const,
  size: 42,
  sha256: "a".repeat(64),
  etag: "etag-v2",
  sourceElementId: "animation-element",
  slideId: "slide-2",
};

const input = {
  diagramId: "board-1",
  assetId: "lesson-animation",
  version: 2,
  replacementForVersion: 1,
  sourceElementId: "animation-element",
  slideId: "slide-2",
  html: "<!doctype html><title>Animation</title>",
};

const dependencies = () => {
  const createUploadGrant =
    vi.fn<PublishPresentationAnimationDependencies["createUploadGrant"]>();
  createUploadGrant.mockResolvedValue({
    kind: "upload",
    token: "upload-token",
    assetId: input.assetId,
    version: input.version,
  });
  const upload = vi.fn<PublishPresentationAnimationDependencies["upload"]>();
  upload.mockResolvedValue({ etag: "etag-v2", sha256: "" });
  const registerUpload =
    vi.fn<PublishPresentationAnimationDependencies["registerUpload"]>();
  registerUpload.mockResolvedValue(reference);
  const abandonUpload =
    vi.fn<PublishPresentationAnimationDependencies["abandonUpload"]>();
  abandonUpload.mockResolvedValue({ deleteToken: "delete-token" });
  const cleanup = vi.fn<PublishPresentationAnimationDependencies["cleanup"]>();
  cleanup.mockResolvedValue(undefined);
  return {
    createUploadGrant,
    upload,
    registerUpload,
    abandonUpload,
    cleanup,
  };
};

describe("presentation animation publishing", () => {
  it("uploads and registers an immutable replacement before returning its reference", async () => {
    const deps = dependencies();
    deps.upload.mockImplementationOnce(async (_token, bundle) => {
      const manifest = deps.createUploadGrant.mock.calls[0][0];
      return { etag: "etag-v2", sha256: manifest!.sha256 };
    });

    await expect(publishPresentationAnimation(input, deps)).resolves.toEqual(
      reference,
    );
    expect(deps.createUploadGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        replacementForVersion: 1,
        mimeType: "text/html",
        size: new Blob([input.html]).size,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(deps.upload).toHaveBeenCalledWith("upload-token", expect.any(Blob));
    expect(deps.registerUpload).toHaveBeenCalledWith({
      token: "upload-token",
      etag: "etag-v2",
    });
    expect(deps.abandonUpload).not.toHaveBeenCalled();
  });

  it("returns an idempotently registered version without uploading again", async () => {
    const deps = dependencies();
    deps.createUploadGrant.mockResolvedValueOnce({
      kind: "registered",
      asset: reference,
    });

    await expect(publishPresentationAnimation(input, deps)).resolves.toEqual(
      reference,
    );
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.registerUpload).not.toHaveBeenCalled();
  });

  it("abandons and deletes a partial upload when registration fails", async () => {
    const deps = dependencies();
    deps.upload.mockImplementationOnce(async () => {
      const manifest = deps.createUploadGrant.mock.calls[0][0];
      return { etag: "etag-v2", sha256: manifest!.sha256 };
    });
    deps.registerUpload.mockRejectedValueOnce(new Error("registration failed"));

    await expect(publishPresentationAnimation(input, deps)).rejects.toThrow(
      "registration failed",
    );
    expect(deps.abandonUpload).toHaveBeenCalledWith({ token: "upload-token" });
    expect(deps.cleanup).toHaveBeenCalledWith("delete-token");
  });

  it("commits a replacement reference only after the immutable version registers", async () => {
    const deps = dependencies();
    const commit = vi.fn();
    deps.upload.mockImplementationOnce(async () => {
      const manifest = deps.createUploadGrant.mock.calls[0][0];
      return { etag: "etag-v2", sha256: manifest!.sha256 };
    });

    await publishAndCommitPresentationAnimation(input, deps, commit);

    expect(commit).toHaveBeenCalledWith(reference);
    expect(deps.registerUpload.mock.invocationCallOrder[0]).toBeLessThan(
      commit.mock.invocationCallOrder[0],
    );

    const element = withRegisteredPresentationAnimation(
      {
        id: reference.sourceElementId,
        customData: {
          animationAssetId: "legacy",
          animationUrl: "/expired-capability",
          generationData: { status: "done", html: "large old bundle" },
          preserved: true,
        },
      },
      reference,
    );
    expect(element.customData).toEqual({
      preserved: true,
      animationAsset: { assetId: "lesson-animation", version: 2 },
    });
  });

  it("does not change an element reference when replacement registration fails", async () => {
    const deps = dependencies();
    const commit = vi.fn();
    deps.upload.mockImplementationOnce(async () => {
      const manifest = deps.createUploadGrant.mock.calls[0][0];
      return { etag: "etag-v2", sha256: manifest!.sha256 };
    });
    deps.registerUpload.mockRejectedValueOnce(new Error("registration failed"));

    await expect(
      publishAndCommitPresentationAnimation(input, deps, commit),
    ).rejects.toThrow("registration failed");
    expect(commit).not.toHaveBeenCalled();
  });
});
