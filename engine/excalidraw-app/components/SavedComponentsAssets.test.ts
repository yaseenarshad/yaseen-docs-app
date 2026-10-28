import { newImageElement } from "@excalidraw/element";

import {
  insertRemoteSavedComponent,
  saveSavedComponent,
} from "./SavedComponentsAssets";

const image = (fileId = "file-a") =>
  newImageElement({
    type: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    status: "saved",
    fileId: fileId as never,
  });

describe("Saved Components image asset orchestration", () => {
  it("keeps the legacy one-mutation path for components without images", async () => {
    const createLegacy = vi.fn().mockResolvedValue({ componentId: "legacy" });
    const createDraft = vi.fn();

    await saveSavedComponent(
      {
        name: "Shape",
        elements: [{ ...image(), type: "rectangle" }] as never,
        files: {},
      },
      {
        createLegacy,
        createDraft,
      } as never,
    );

    expect(createLegacy).toHaveBeenCalledTimes(1);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("uploads exact full files and preview before finalizing an image draft", async () => {
    const calls: string[] = [];
    const createDraft = vi.fn(async () => {
      calls.push("draft");
      return { componentId: "component-1" };
    });
    const createAssetUploadGrant = vi.fn(async ({ fileId }) => {
      calls.push(`grant:${fileId}`);
      return { token: `asset:${fileId}` };
    });
    const createPreviewUploadGrant = vi.fn(async () => {
      calls.push("grant:preview");
      return { token: "preview" };
    });
    const upload = vi.fn(async (token: string) => {
      calls.push(`upload:${token}`);
      return { etag: `${token}:etag` };
    });
    const registerAssetUpload = vi.fn(async ({ token }) => {
      calls.push(`register:${token}`);
    });
    const registerPreviewUpload = vi.fn(async () => {
      calls.push("register:preview");
    });
    const finalizeDraft = vi.fn(async () => {
      calls.push("finalize");
    });

    await saveSavedComponent(
      {
        name: "Image card",
        elements: [image()],
        files: {
          "file-a": {
            id: "file-a",
            mimeType: "image/png",
            dataURL: "data:image/png;base64,YQ==",
            created: 1,
          },
        } as never,
      },
      {
        createLegacy: vi.fn(),
        createDraft,
        createAssetUploadGrant,
        createPreviewUploadGrant,
        registerAssetUpload,
        registerPreviewUpload,
        finalizeDraft,
        removeDraft: vi.fn(),
        cleanupAssets: vi.fn(),
        loadDataURL: vi.fn(
          async () => new Blob(["asset"], { type: "image/png" }),
        ),
        createPreview: vi.fn(async () => ({
          blob: new Blob(["preview"], { type: "image/webp" }),
          mimeType: "image/webp" as const,
          width: 320,
          height: 180,
        })),
        upload,
      },
    );

    expect(calls).toEqual([
      "draft",
      "grant:file-a",
      "upload:asset:file-a",
      "register:asset:file-a",
      "grant:preview",
      "upload:preview",
      "register:preview",
      "finalize",
    ]);
  });

  it("removes a failed draft and cleans any component-owned R2 objects", async () => {
    const removeDraft = vi.fn(async () => ({
      componentId: "component-1",
      assetDeleteToken: "delete-token",
    }));
    const cleanupAssets = vi.fn().mockResolvedValue(undefined);

    await expect(
      saveSavedComponent(
        {
          name: "Broken image",
          elements: [image()],
          files: {
            "file-a": {
              id: "file-a",
              mimeType: "image/png",
              dataURL: "data:image/png;base64,YQ==",
              created: 1,
            },
          } as never,
        },
        {
          createLegacy: vi.fn(),
          createDraft: vi.fn(async () => ({ componentId: "component-1" })),
          createAssetUploadGrant: vi.fn(async () => ({ token: "asset" })),
          createPreviewUploadGrant: vi.fn(),
          registerAssetUpload: vi.fn(),
          registerPreviewUpload: vi.fn(),
          finalizeDraft: vi.fn(),
          removeDraft,
          cleanupAssets,
          loadDataURL: vi.fn(
            async () => new Blob(["asset"], { type: "image/png" }),
          ),
          createPreview: vi.fn(),
          upload: vi.fn().mockRejectedValue(new Error("R2 unavailable")),
        },
      ),
    ).rejects.toThrow("R2 unavailable");
    expect(removeDraft).toHaveBeenCalledWith({ componentId: "component-1" });
    expect(cleanupAssets).toHaveBeenCalledWith("delete-token");
  });

  it("downloads and validates every file before mutating the canvas", async () => {
    const order: string[] = [];
    const excalidrawAPI = {
      addFiles: vi.fn(() => order.push("files")),
      insertElements: vi.fn(() => order.push("elements")),
    };
    const source = JSON.stringify({
      type: "growprofit/saved-component",
      schemaVersion: 1,
      elements: [image()],
    });

    await insertRemoteSavedComponent("component-1", excalidrawAPI as never, {
      getManifest: vi.fn(async () => ({
        elementsJson: source,
        assets: [
          {
            fileId: "file-a",
            mimeType: "image/png",
            size: 5,
            url: "/asset-a",
          },
        ],
      })),
      download: vi.fn(async () => {
        order.push("download");
        return new Blob(["asset"], { type: "image/png" });
      }),
      toDataURL: vi.fn(async () => "data:image/png;base64,YXNzZXQ="),
    });

    expect(order).toEqual(["download", "files", "elements"]);
  });

  it("leaves the canvas untouched when any remote asset fails", async () => {
    const excalidrawAPI = {
      addFiles: vi.fn(),
      insertElements: vi.fn(),
    };
    await expect(
      insertRemoteSavedComponent("component-1", excalidrawAPI as never, {
        getManifest: vi.fn(async () => ({
          elementsJson: JSON.stringify({
            type: "growprofit/saved-component",
            schemaVersion: 1,
            elements: [image()],
          }),
          assets: [
            {
              fileId: "file-a",
              mimeType: "image/png",
              size: 5,
              url: "/missing",
            },
          ],
        })),
        download: vi.fn().mockRejectedValue(new Error("Image unavailable")),
        toDataURL: vi.fn(),
      }),
    ).rejects.toThrow("Image unavailable");
    expect(excalidrawAPI.addFiles).not.toHaveBeenCalled();
    expect(excalidrawAPI.insertElements).not.toHaveBeenCalled();
  });
});
