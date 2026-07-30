import { MIME_TYPES, randomId, reseed } from "@excalidraw/common";

import type { FileId } from "@excalidraw/element/types";

import * as blobModule from "../data/blob";
import * as filesystemModule from "../data/filesystem";
import { IMAGE_STUDIO_INSERTION } from "../data/viewportInsertion";
import { Excalidraw } from "../index";
import { createPasteEvent } from "../clipboard";
import { getNormalizedZoom } from "../scene";

import { API } from "./helpers/api";
import { mockMultipleHTMLImageElements } from "./helpers/mocks";
import { UI } from "./helpers/ui";
import { act, GlobalTestState, render, waitFor } from "./test-utils";
import {
  DEER_IMAGE_DIMENSIONS,
  SMILEY_IMAGE_DIMENSIONS,
} from "./fixtures/constants";
import { INITIALIZED_IMAGE_PROPS } from "./helpers/constants";

import type { ExcalidrawProps } from "../types";

const { h } = window;

export const setupImageTest = async (
  sizes: { width: number; height: number }[],
  props?: ExcalidrawProps,
) => {
  await render(
    <Excalidraw autoFocus={true} handleKeyboardGlobally={true} {...props} />,
  );

  h.state.height = 1000;

  mockMultipleHTMLImageElements(sizes.map((size) => [size.width, size.height]));
};

describe("resizeImageFile", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the original file when it already fits the max dimensions", async () => {
    mockMultipleHTMLImageElements([[100, 100]]);

    const imageFile = new File([new Uint8Array([1, 2, 3])], "image.png", {
      type: MIME_TYPES.png,
    });

    await expect(
      blobModule.resizeImageFile(imageFile, { maxWidthOrHeight: 200 }),
    ).resolves.toBe(imageFile);
  });
});

describe("image insertion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    reseed(7);

    const generateIdSpy = vi.spyOn(blobModule, "generateIdFromFile");
    const resizeFileSpy = vi.spyOn(blobModule, "resizeImageFile");

    generateIdSpy.mockImplementation(() =>
      Promise.resolve(randomId() as FileId),
    );
    resizeFileSpy.mockImplementation((file: File) => Promise.resolve(file));

    Object.assign(document, {
      elementFromPoint: () => GlobalTestState.canvas,
    });
  });

  const setup = () =>
    setupImageTest([DEER_IMAGE_DIMENSIONS, SMILEY_IMAGE_DIMENSIONS]);

  const assert = async () => {
    await waitFor(() => {
      expect(h.elements).toEqual([
        expect.objectContaining({
          ...INITIALIZED_IMAGE_PROPS,
          ...DEER_IMAGE_DIMENSIONS,
        }),
        expect.objectContaining({
          ...INITIALIZED_IMAGE_PROPS,
          ...SMILEY_IMAGE_DIMENSIONS,
        }),
      ]);
    });
    // Not placed on top of each other
    const dimensionsSet = new Set(h.elements.map((el) => `${el.x}-${el.y}`));
    expect(dimensionsSet.size).toEqual(h.elements.length);
  };

  it("should eventually initialize all dropped images", async () => {
    await setup();

    const files = await Promise.all([
      API.loadFile("./fixtures/deer.png"),
      API.loadFile("./fixtures/smiley.png"),
    ]);
    await API.drop(files.map((file) => ({ kind: "file", file })));

    await assert();
  });

  it("should eventually initialize all pasted images", async () => {
    await setup();

    document.dispatchEvent(
      createPasteEvent({
        files: await Promise.all([
          API.loadFile("./fixtures/deer.png"),
          API.loadFile("./fixtures/smiley.png"),
        ]),
      }),
    );

    await assert();
  });

  it("should eventually initialize all images added through image tool", async () => {
    await setup();

    const fileOpenSpy = vi.spyOn(filesystemModule, "fileOpen");
    fileOpenSpy.mockImplementation(
      async () =>
        await Promise.all([
          API.loadFile("./fixtures/deer.png"),
          API.loadFile("./fixtures/smiley.png"),
        ]),
    );
    UI.clickTool("image");

    await assert();
  });

  it("inserts and selects images through the imperative API without moving the viewport", async () => {
    await setupImageTest([DEER_IMAGE_DIMENSIONS]);
    const before = {
      scrollX: h.state.scrollX,
      scrollY: h.state.scrollY,
      zoom: h.state.zoom,
    };

    let inserted: Awaited<ReturnType<typeof h.app.insertImages>> = [];
    await act(async () => {
      inserted = await h.app.insertImages([
        await API.loadFile("./fixtures/deer.png"),
      ]);
    });

    expect(inserted).toHaveLength(1);
    await waitFor(() => {
      expect(h.state.selectedElementIds[inserted[0].id]).toBe(true);
    });
    expect({
      scrollX: h.state.scrollX,
      scrollY: h.state.scrollY,
      zoom: h.state.zoom,
    }).toEqual(before);
  });

  it("sizes opted-in images consistently in screen space", async () => {
    await setupImageTest([DEER_IMAGE_DIMENSIONS]);
    h.state.width = 1600;
    h.state.zoom = { value: getNormalizedZoom(0.25) };

    let inserted: Awaited<ReturnType<typeof h.app.insertImages>> = [];
    await act(async () => {
      inserted = await h.app.insertImages(
        [await API.loadFile("./fixtures/deer.png")],
        undefined,
        undefined,
        { viewportSizing: IMAGE_STUDIO_INSERTION },
      );
    });

    expect(
      Math.max(inserted[0].width, inserted[0].height) * h.state.zoom.value,
    ).toBeCloseTo(320);
  });

  it("keeps legacy intrinsic sizing when viewport sizing is omitted", async () => {
    await setupImageTest([DEER_IMAGE_DIMENSIONS]);

    let inserted: Awaited<ReturnType<typeof h.app.insertImages>> = [];
    await act(async () => {
      inserted = await h.app.insertImages([
        await API.loadFile("./fixtures/deer.png"),
      ]);
    });

    expect(inserted[0]).toMatchObject(DEER_IMAGE_DIMENSIONS);
  });

  it("passes host-configured max image dimensions to the resize helper", async () => {
    await setupImageTest([DEER_IMAGE_DIMENSIONS], {
      imageOptions: { maxWidthOrHeight: 2048 },
    });

    await API.drop([
      { kind: "file", file: await API.loadFile("./fixtures/deer.png") },
    ]);

    await waitFor(() => {
      expect(blobModule.resizeImageFile).toHaveBeenCalledWith(
        expect.any(File),
        { maxWidthOrHeight: 2048 },
      );
    });
  });

  it("enforces host-configured max image file size", async () => {
    await setupImageTest([DEER_IMAGE_DIMENSIONS], {
      imageOptions: { maxFileSizeBytes: 1024 * 1024 },
    });

    await API.drop([
      {
        kind: "file",
        file: new File([new Uint8Array(2 * 1024 * 1024)], "image.png", {
          type: MIME_TYPES.png,
        }),
      },
    ]);

    await waitFor(() => {
      expect(h.state.errorMessage).toBe(
        "File is too big. Maximum allowed size is 1MB.",
      );
    });
  });
});
