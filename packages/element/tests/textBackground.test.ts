import { ROUNDNESS } from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { getTextBackgroundGeometry } from "../src/textElement";

describe("native text background geometry", () => {
  it("uses the existing free-text bounds and shared effective radius", () => {
    const text = {
      ...API.createElement({
        type: "text",
        width: 100,
        height: 40,
        backgroundColor: "#ff0000",
        roundness: null,
      }),
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 64 },
    };

    expect(getTextBackgroundGeometry(text)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      radius: 20,
    });
    expect(text.roundness.value).toBe(64);
  });

  it("does not render transparent or bound-text backgrounds", () => {
    const transparent = API.createElement({
      type: "text",
      backgroundColor: "transparent",
    });
    const bound = API.createElement({
      type: "text",
      backgroundColor: "#ff0000",
      containerId: "container",
    });

    expect(getTextBackgroundGeometry(transparent)).toBeNull();
    expect(getTextBackgroundGeometry(bound)).toBeNull();
  });

  it("uses square corners when the free text has no roundness", () => {
    const text = API.createElement({
      type: "text",
      width: 80,
      height: 30,
      backgroundColor: "#00ff00",
      roundness: null,
    });

    expect(getTextBackgroundGeometry(text)?.radius).toBe(0);
  });
});
