import React from "react";

import { MIME_TYPES } from "@excalidraw/common";
import { elementWithCanvasCache } from "@excalidraw/element";

import type { FileId } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { FakeImageDecoder, stubGifDecoding } from "./helpers/gif";
import { mockMultipleHTMLImageElements } from "./helpers/mocks";
import { act, render, unmountComponent, waitFor } from "./test-utils";

import type { DataURL } from "../types";

/** YAZ-3944 D2: a GIF moves on the board; only its own canvas redraws. */

unmountComponent();

const { h } = window;

export const addGif = (fileId: string, frames: number, x = 0) => {
  act(() =>
    h.app.addFiles([
      {
        id: fileId as FileId,
        mimeType: MIME_TYPES.gif,
        dataURL: `data:${MIME_TYPES.gif},${frames}` as DataURL,
        created: 0,
      },
    ]),
  );
  return API.createElement({
    type: "image",
    fileId: fileId as FileId,
    status: "saved",
    x,
    y: 0,
    width: 40,
    height: 30,
  });
};

describe("YAZ-3944 D2: a GIF on the board", () => {
  beforeEach(async () => {
    stubGifDecoding();
    mockMultipleHTMLImageElements([
      [4, 3],
      [4, 3],
    ]);
    await render(<Excalidraw />);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("moves, and each frame redraws only the GIF's own canvas", async () => {
    const gif = addGif("gif", 4);
    const rect = API.createElement({ type: "rectangle", x: 100, y: 0 });
    API.setElements([gif, rect]);

    await waitFor(() =>
      expect(elementWithCanvasCache.get(gif)?.gifFrame).toBeGreaterThan(0),
    );
    const { canvas: gifCanvas, gifFrame } = elementWithCanvasCache.get(gif)!;
    const rectCache = elementWithCanvasCache.get(rect);

    await waitFor(() =>
      expect(elementWithCanvasCache.get(gif)?.gifFrame).toBeGreaterThan(
        gifFrame! + 1,
      ),
    );

    expect(elementWithCanvasCache.get(gif)!.canvas).toBe(gifCanvas);
    expect(elementWithCanvasCache.get(rect)).toBe(rectCache);
  });

  it("keeps a still picture still", async () => {
    const gif = addGif("still", 1);
    API.setElements([gif]);

    await waitFor(() => expect(FakeImageDecoder.made[0]?.closed).toBe(true));

    expect(h.app.gifPlayer.frameToken(gif)).toBe(undefined);
    expect(h.app.gifPlayer.frameFor(gif)).toBe(null);
  });
});
