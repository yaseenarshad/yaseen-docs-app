import React from "react";

import { MIME_TYPES } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  elementWithCanvasCache,
} from "@excalidraw/element";

import type {
  FileId,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { actionToggleGifPlayback } from "../actions";
import { Excalidraw } from "../index";
import { exportToSvg } from "../scene/export";

import { API } from "./helpers/api";
import { FakeImageDecoder, stubGifDecoding } from "./helpers/gif";
import { mockMultipleHTMLImageElements } from "./helpers/mocks";
import { Keyboard } from "./helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

import type { DataURL } from "../types";

/** YAZ-3944 D2: a GIF moves on the board; only its own canvas redraws. D4: pause and stop. */

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
      [4, 3],
    ]);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    // the test window has no size: give the board one, so both GIFs are in view
    act(() => h.app.setState({ width: 1000, height: 1000 }));
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
    expect(rectCache).toBeDefined();

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

const openContextMenuOn = (element: NonDeletedExcalidrawElement) => {
  API.setSelectedElements([element]);
  fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
    button: 2,
    clientX: 10,
    clientY: 10,
  });
  return GlobalTestState.renderResult.container.querySelector(
    '.context-menu li[data-testid="toggleGifPlayback"]',
  );
};

describe("YAZ-3944 D4: Pause GIF and auto-pause", () => {
  beforeEach(async () => {
    stubGifDecoding();
    mockMultipleHTMLImageElements([
      [4, 3],
      [4, 3],
      [4, 3],
    ]);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    // the test window has no size: give the board one, so both GIFs are in view
    act(() => h.app.setState({ width: 1000, height: 1000 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Pause GIF sets the flag, the GIF shows its first frame, and undo clears it", async () => {
    const gif = addGif("gif", 4);
    // added as a user adds it, so undo has only the pause to take back
    API.updateScene({
      elements: [gif],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    await waitFor(() =>
      expect(h.app.gifPlayer.isAnimated(gif.fileId!)).toBe(true),
    );

    expect(openContextMenuOn(gif)?.textContent).toBe("Pause GIF");
    act(() => {
      h.app.actionManager.executeAction(actionToggleGifPlayback);
    });

    const paused = h.elements[0] as typeof gif;
    expect(paused.customData).toEqual({ gifPaused: true });
    expect(h.app.gifPlayer.frameFor(paused)).toBe(null);
    expect(openContextMenuOn(paused)?.textContent).toBe("Play GIF");

    Keyboard.undo();
    expect(h.elements[0].customData?.gifPaused).toBe(undefined);
    Keyboard.redo();
    expect(h.elements[0].customData?.gifPaused).toBe(true);
  });

  it("shows the row only for one selected GIF with more than one frame", async () => {
    const still = addGif("still", 1);
    API.setElements([still]);
    await waitFor(() => expect(FakeImageDecoder.made[0]?.closed).toBe(true));
    expect(openContextMenuOn(still)).toBe(null);

    const rect = API.createElement({ type: "rectangle", x: 0, y: 0 });
    API.setElements([rect]);
    expect(openContextMenuOn(rect)).toBe(null);
  });

  it("stops while the window is hidden, and plays again when it shows", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(h.app.gifPlayer.hidden).toBe(true);

    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(h.app.gifPlayer.hidden).toBe(false);
  });

  it("YAZ-4074 6A item 6: GIFs wait while a text box is in edit mode", () => {
    const text = API.createElement({ type: "text", text: "Hello" });
    API.setElements([text]);
    expect(h.app.gifPlayer.typing).toBe(false);
    act(() => h.app.setState({ editingTextElement: text }));
    expect(h.app.gifPlayer.typing).toBe(true);
    act(() => h.app.setState({ editingTextElement: null }));
    expect(h.app.gifPlayer.typing).toBe(false);
  });

  it("a mouse move on the board ends the 5 min idle stop", () => {
    h.app.gifPlayer.idle = true;
    fireEvent.pointerMove(GlobalTestState.interactiveCanvas);
    expect(h.app.gifPlayer.idle).toBe(false);
  });

  it("closes the decoder of a deleted GIF, and all of them on unmount", async () => {
    const a = addGif("a", 3);
    const b = addGif("b", 3, 100);
    API.setElements([a, b]);
    await waitFor(() => expect(FakeImageDecoder.made).toHaveLength(2));

    API.setElements([b]);
    await waitFor(() => expect(FakeImageDecoder.made[0].closed).toBe(true), {
      timeout: 2000,
    });
    expect(FakeImageDecoder.made[1].closed).toBe(false);

    unmountComponent();
    expect(FakeImageDecoder.made[1].closed).toBe(true);
  });

  it("an SVG shows a paused GIF still, and a playing GIF as it is", async () => {
    const playing = addGif("a", 3);
    const paused = {
      ...addGif("b", 3, 100),
      customData: { gifPaused: true },
    };
    const svg = await exportToSvg(
      [playing, paused],
      { exportBackground: false, viewBackgroundColor: "#fff" },
      h.app.files,
    );

    const hrefs = [...svg.querySelectorAll("image")].map((image) =>
      image.getAttribute("href"),
    );
    expect(hrefs).toHaveLength(2);
    expect(hrefs).toContain(`data:${MIME_TYPES.gif},3`);
    expect(
      hrefs.find((href) => href!.startsWith("data:image/png")),
    ).toBeTruthy();
  });
});
