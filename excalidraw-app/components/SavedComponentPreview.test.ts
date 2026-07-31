import {
  createSavedComponentPreview,
  getSavedComponentPreviewDimensions,
} from "./SavedComponentPreview";

describe("Saved Component preview generation", () => {
  it.each([
    [1600, 900, { width: 800, height: 450, scale: 0.5 }],
    [600, 1200, { width: 300, height: 600, scale: 0.5 }],
    [320, 180, { width: 320, height: 180, scale: 1 }],
  ])("fits %s×%s inside 800×600", (width, height, expected) => {
    expect(getSavedComponentPreviewDimensions(width, height)).toEqual(expected);
  });

  it("exports selected elements and their files as a bounded WebP", async () => {
    const blob = new Blob(["preview"], { type: "image/webp" });
    const canvas = {
      width: 320,
      height: 180,
      toBlob: vi.fn((callback: BlobCallback) => callback(blob)),
    } as unknown as HTMLCanvasElement;
    const exportCanvas = vi.fn(async () => canvas);
    const scene = {
      elements: [{ id: "image", type: "image", isDeleted: false }],
      appState: { theme: "light", viewBackgroundColor: "#fff" },
      files: { "file-a": { id: "file-a" } },
    } as never;

    const preview = await createSavedComponentPreview(scene, exportCanvas);

    expect(exportCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: expect.any(Array),
        files: expect.objectContaining({ "file-a": expect.any(Object) }),
        exportPadding: 12,
        getDimensions: getSavedComponentPreviewDimensions,
      }),
    );
    expect(preview).toEqual({
      blob,
      mimeType: "image/webp",
      width: 320,
      height: 180,
    });
  });
});
