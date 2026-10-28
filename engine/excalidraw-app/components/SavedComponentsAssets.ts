import { getDataURL } from "@excalidraw/excalidraw/data/blob";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import {
  insertSavedComponent,
  serializeSavedComponent,
} from "./SavedComponentsData";

type ComponentPreview = {
  blob: Blob;
  mimeType: "image/webp";
  width: number;
  height: number;
};

type ComponentMutationResult = {
  componentId: string;
  assetDeleteToken?: string | null;
};

type SaveDependencies = {
  createLegacy: (args: {
    name: string;
    elementsJson: string;
    elementCount: number;
    schemaVersion: number;
  }) => Promise<ComponentMutationResult>;
  createDraft: SaveDependencies["createLegacy"];
  createAssetUploadGrant: (args: {
    componentId: string;
    fileId: string;
    mimeType: string;
    size: number;
  }) => Promise<{ token: string }>;
  createPreviewUploadGrant: (args: {
    componentId: string;
    mimeType: "image/webp";
    size: number;
    width: number;
    height: number;
  }) => Promise<{ token: string }>;
  registerAssetUpload: (args: {
    token: string;
    etag: string;
  }) => Promise<unknown>;
  registerPreviewUpload: SaveDependencies["registerAssetUpload"];
  finalizeDraft: (args: { componentId: string }) => Promise<unknown>;
  removeDraft: (args: {
    componentId: string;
  }) => Promise<ComponentMutationResult>;
  cleanupAssets: (token: string) => Promise<void>;
  loadDataURL: (dataURL: string) => Promise<Blob>;
  createPreview: (
    elements: readonly ExcalidrawElement[],
    files: BinaryFiles,
  ) => Promise<ComponentPreview>;
  upload: (
    token: string,
    blob: Blob,
    mimeType: string,
  ) => Promise<{ etag: string }>;
};

const defaultLoadDataURL = async (dataURL: string) => {
  const response = await fetch(dataURL);
  if (!response.ok) {
    throw new Error("Component image data could not be read");
  }
  return await response.blob();
};

export const uploadComponentBlob = async (
  token: string,
  blob: Blob,
  mimeType: string,
) => {
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType,
    },
    body: blob,
  });
  const body = (await response.json()) as { etag?: string; error?: string };
  if (!response.ok || !body.etag) {
    throw new Error(body.error || "Component image upload failed");
  }
  return { etag: body.etag };
};

export const cleanupComponentAssets = async (token: string) => {
  const response = await fetch("/api/assets", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error("Component image cleanup failed");
  }
};

export const saveSavedComponent = async (
  {
    name,
    elements,
    files,
  }: {
    name: string;
    elements: readonly ExcalidrawElement[];
    files: BinaryFiles;
  },
  dependencies: Partial<SaveDependencies> &
    Pick<SaveDependencies, "createLegacy" | "createDraft">,
) => {
  const serialized = serializeSavedComponent(elements);
  const referencedFileIds = [
    ...new Set(
      elements.flatMap((element) =>
        element.type === "image" && element.fileId ? [element.fileId] : [],
      ),
    ),
  ];
  if (referencedFileIds.length === 0) {
    return await dependencies.createLegacy({ name, ...serialized });
  }

  const deps = {
    loadDataURL: defaultLoadDataURL,
    upload: uploadComponentBlob,
    cleanupAssets: cleanupComponentAssets,
    ...dependencies,
  } as SaveDependencies;
  let componentId: string | null = null;
  try {
    const draft = await deps.createDraft({ name, ...serialized });
    componentId = draft.componentId;
    for (const fileId of referencedFileIds) {
      const file = files[fileId];
      if (!file) {
        throw new Error(`Image data is missing for file ${fileId}`);
      }
      const blob = await deps.loadDataURL(file.dataURL);
      const { token } = await deps.createAssetUploadGrant({
        componentId,
        fileId,
        mimeType: file.mimeType,
        size: blob.size,
      });
      const { etag } = await deps.upload(token, blob, file.mimeType);
      await deps.registerAssetUpload({ token, etag });
    }

    const preview = await deps.createPreview(elements, files);
    const { token: previewToken } = await deps.createPreviewUploadGrant({
      componentId,
      mimeType: preview.mimeType,
      size: preview.blob.size,
      width: preview.width,
      height: preview.height,
    });
    const { etag: previewEtag } = await deps.upload(
      previewToken,
      preview.blob,
      preview.mimeType,
    );
    await deps.registerPreviewUpload({
      token: previewToken,
      etag: previewEtag,
    });
    await deps.finalizeDraft({ componentId });
    return { componentId };
  } catch (error) {
    if (componentId) {
      try {
        const removed = await deps.removeDraft({ componentId });
        if (removed.assetDeleteToken) {
          await deps.cleanupAssets(removed.assetDeleteToken);
        }
      } catch {
        // The original save failure is more actionable. Abandoned-draft
        // cleanup will recover any remaining component-owned objects later.
      }
    }
    throw error;
  }
};

type AssetManifest = {
  elementsJson: string;
  assets: Array<{
    fileId: string;
    mimeType: string;
    size: number;
    url: string;
  }>;
};

type InsertDependencies = {
  getManifest: (args: { componentId: string }) => Promise<AssetManifest>;
  download: (asset: AssetManifest["assets"][number]) => Promise<Blob>;
  toDataURL: (blob: Blob) => Promise<string>;
};

const downloadComponentAsset = async (
  asset: AssetManifest["assets"][number],
) => {
  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error(`Component image ${asset.fileId} is unavailable`);
  }
  const blob = await response.blob();
  if (blob.size !== asset.size) {
    throw new Error(`Component image ${asset.fileId} failed validation`);
  }
  return blob.type === asset.mimeType
    ? blob
    : new Blob([blob], { type: asset.mimeType });
};

export const insertRemoteSavedComponent = async (
  componentId: string,
  excalidrawAPI: ExcalidrawImperativeAPI,
  dependencies: Partial<InsertDependencies> &
    Pick<InsertDependencies, "getManifest">,
) => {
  const deps = {
    download: downloadComponentAsset,
    toDataURL: getDataURL,
    ...dependencies,
  } as InsertDependencies;
  const manifest = await deps.getManifest({ componentId });
  const files = await Promise.all(
    manifest.assets.map(async (asset): Promise<BinaryFileData> => {
      const blob = await deps.download(asset);
      return {
        id: asset.fileId as BinaryFileData["id"],
        mimeType: asset.mimeType as BinaryFileData["mimeType"],
        dataURL: (await deps.toDataURL(blob)) as BinaryFileData["dataURL"],
        created: Date.now(),
      };
    }),
  );
  return insertSavedComponent(excalidrawAPI, manifest.elementsJson, files);
};
