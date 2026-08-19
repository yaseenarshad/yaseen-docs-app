import { vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  applyFramesVisibility,
  FRAMES_VISIBLE_STORAGE_KEY,
  readFramesVisiblePreference,
  writeFramesVisiblePreference,
} from "./framesVisibility";

describe("frames visibility preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows frames unless they were explicitly turned off", () => {
    expect(readFramesVisiblePreference()).toBe(true);

    window.localStorage.setItem(FRAMES_VISIBLE_STORAGE_KEY, "not-a-boolean");
    expect(readFramesVisiblePreference()).toBe(true);

    writeFramesVisiblePreference(false);
    expect(window.localStorage.getItem(FRAMES_VISIBLE_STORAGE_KEY)).toBe(
      "false",
    );
    expect(readFramesVisiblePreference()).toBe(false);

    writeFramesVisiblePreference(true);
    expect(readFramesVisiblePreference()).toBe(true);
  });

  it("survives storage being unavailable", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });

    expect(readFramesVisiblePreference()).toBe(true);
    expect(() => writeFramesVisiblePreference(false)).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("toggles only the outline and the name label", () => {
    const updateFrameRendering = vi.fn();
    const excalidrawAPI = {
      updateFrameRendering,
    } as unknown as ExcalidrawImperativeAPI;

    applyFramesVisibility(excalidrawAPI, false);
    expect(updateFrameRendering).toHaveBeenCalledWith({
      outline: false,
      name: false,
    });

    applyFramesVisibility(excalidrawAPI, true);
    expect(updateFrameRendering).toHaveBeenLastCalledWith({
      outline: true,
      name: true,
    });
  });
});
