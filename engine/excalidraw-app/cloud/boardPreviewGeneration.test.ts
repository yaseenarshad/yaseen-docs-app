import { describe, expect, it, vi } from "vitest";

import {
  createBoardPreviewImage,
  getBoardPreviewDelay,
  getBoardPreviewDimensions,
} from "./boardPreviewGeneration";

import type { BoardPreviewScene } from "./boardPreviewGeneration";

const makeScene = (): BoardPreviewScene =>
  ({
    elements: [
      { id: "visible", type: "rectangle", isDeleted: false },
      { id: "deleted", type: "ellipse", isDeleted: true },
      {
        id: "image",
        type: "image",
        isDeleted: false,
        fileId: "embedded-file",
      },
    ],
    appState: {
      theme: "dark",
      viewBackgroundColor: "#121212",
    },
    files: {
      "embedded-file": {
        id: "embedded-file",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,aW1hZ2U=",
        created: 1,
      },
    },
  } as unknown as BoardPreviewScene);

describe("Board preview generation", () => {
  it.each([
    [2400, 1200, { width: 1200, height: 600, scale: 0.5 }],
    [1000, 1000, { width: 800, height: 800, scale: 0.8 }],
    [400, 300, { width: 400, height: 300, scale: 1 }],
  ])(
    "fits %s×%s inside the 1200×800 pixel boundary",
    (width, height, expected) => {
      expect(getBoardPreviewDimensions(width, height)).toEqual(expected);
    },
  );

  it("exports visible elements, background/theme, and embedded files as WebP", async () => {
    const scene = makeScene();
    const blob = new Blob(["webp"], { type: "image/webp" });
    const canvas = {
      width: 1200,
      height: 675,
      toBlob: vi.fn(
        (callback: BlobCallback, mimeType?: string, quality?: number) => {
          expect(mimeType).toBe("image/webp");
          expect(quality).toBe(0.8);
          callback(blob);
        },
      ),
    } as unknown as HTMLCanvasElement;
    const exportCanvas = vi.fn(async () => canvas);

    const preview = await createBoardPreviewImage(scene, exportCanvas);

    expect(exportCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: [scene.elements[0], scene.elements[2]],
        files: scene.files,
        exportPadding: 16,
        appState: expect.objectContaining({
          exportBackground: true,
          exportWithDarkMode: true,
          viewBackgroundColor: "#121212",
        }),
        getDimensions: expect.any(Function),
      }),
    );
    expect(preview).toEqual({
      blob,
      mimeType: "image/webp",
      width: 1200,
      height: 675,
    });
  });

  it("records an empty state without rendering or uploading a blank image", async () => {
    const exportCanvas = vi.fn();
    const scene = makeScene();
    scene.elements = scene.elements.map((element) => ({
      ...element,
      isDeleted: true,
    }));

    await expect(
      createBoardPreviewImage(scene, exportCanvas),
    ).resolves.toBeNull();
    expect(exportCanvas).not.toHaveBeenCalled();
  });

  it("rejects browsers that do not produce a real WebP blob", async () => {
    const canvas = {
      width: 100,
      height: 100,
      toBlob: (callback: BlobCallback) =>
        callback(new Blob(["png"], { type: "image/png" })),
    } as unknown as HTMLCanvasElement;

    await expect(
      createBoardPreviewImage(makeScene(), async () => canvas),
    ).rejects.toThrow("WebP preview encoding is not supported");
  });

  it("waits for idle and enforces one generation start per 30 seconds", () => {
    expect(getBoardPreviewDelay(100_000, null)).toBe(1_500);
    expect(getBoardPreviewDelay(100_000, 90_000)).toBe(20_000);
    expect(getBoardPreviewDelay(100_000, 60_000)).toBe(1_500);
  });
});
