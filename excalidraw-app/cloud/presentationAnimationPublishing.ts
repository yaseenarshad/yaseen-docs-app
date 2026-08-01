export type PresentationAnimationReference = {
  assetId: string;
  version: number;
  mimeType: "text/html";
  size: number;
  sha256: string;
  etag: string;
  sourceElementId: string;
  slideId: string;
  previewFileId?: string;
};

type UploadGrantResult =
  | {
      kind: "upload";
      token: string;
      assetId: string;
      version: number;
    }
  | { kind: "registered"; asset: PresentationAnimationReference };

export type PublishPresentationAnimationDependencies = {
  createUploadGrant: (manifest: {
    diagramId: string;
    assetId: string;
    version: number;
    sourceElementId: string;
    slideId: string;
    mimeType: "text/html";
    size: number;
    sha256: string;
    previewFileId?: string;
    replacementForVersion?: number;
  }) => Promise<UploadGrantResult>;
  upload: (
    token: string,
    bundle: Blob,
  ) => Promise<{ etag: string; sha256: string }>;
  registerUpload: (args: {
    token: string;
    etag: string;
  }) => Promise<PresentationAnimationReference>;
  abandonUpload: (args: {
    token: string;
  }) => Promise<{ deleteToken: string | null }>;
  cleanup: (deleteToken: string) => Promise<void>;
};

export const sha256Hex = async (value: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const uploadPresentationAnimationBlob = async (
  token: string,
  bundle: Blob,
) => {
  const response = await fetch("/api/presentation-animations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/html",
    },
    body: bundle,
  });
  const body = (await response.json()) as {
    etag?: string;
    sha256?: string;
    error?: string;
  };
  if (!response.ok || !body.etag || !body.sha256) {
    throw new Error(body.error || "Presentation animation upload failed");
  }
  return { etag: body.etag, sha256: body.sha256 };
};

export const cleanupPresentationAnimationObjects = async (
  deleteToken: string,
) => {
  const response = await fetch("/api/assets", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${deleteToken}` },
  });
  if (!response.ok) {
    throw new Error("Presentation animation cleanup failed");
  }
};

export const publishPresentationAnimation = async (
  input: {
    diagramId: string;
    assetId: string;
    version: number;
    sourceElementId: string;
    slideId: string;
    html: string;
    previewFileId?: string;
    replacementForVersion?: number;
  },
  dependencies: PublishPresentationAnimationDependencies,
): Promise<PresentationAnimationReference> => {
  const bytes = new TextEncoder().encode(input.html);
  const bundle = new Blob([bytes], { type: "text/html" });
  const sha256 = await sha256Hex(bytes.buffer);
  const grant = await dependencies.createUploadGrant({
    diagramId: input.diagramId,
    assetId: input.assetId,
    version: input.version,
    sourceElementId: input.sourceElementId,
    slideId: input.slideId,
    mimeType: "text/html",
    size: bundle.size,
    sha256,
    previewFileId: input.previewFileId,
    replacementForVersion: input.replacementForVersion,
  });
  if (grant.kind === "registered") {
    return grant.asset;
  }

  try {
    const uploaded = await dependencies.upload(grant.token, bundle);
    if (uploaded.sha256 !== sha256) {
      throw new Error("Stored presentation animation checksum changed");
    }
    return await dependencies.registerUpload({
      token: grant.token,
      etag: uploaded.etag,
    });
  } catch (error) {
    try {
      const abandoned = await dependencies.abandonUpload({
        token: grant.token,
      });
      if (abandoned.deleteToken) {
        await dependencies.cleanup(abandoned.deleteToken);
      }
    } catch (cleanupError) {
      console.warn(
        "Could not clean up an abandoned presentation animation upload",
        cleanupError,
      );
    }
    throw error;
  }
};
