import { ROUNDNESS } from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { getTextBackgroundGeometry } from "../src/textElement";

describe("native text background geometry", () => {
  it("adds scale-aware symmetric padding and uses it for the radius", () => {
    const text = {
      ...API.createElement({
        type: "text",
        width: 100,
        height: 40,
        fontSize: 20,
        backgroundColor: "#ff0000",
        roundness: null,
      }),
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 64 },
    };

    const background = getTextBackgroundGeometry(text)!;

    expect(background).toMatchObject({
      x: -5.2,
      width: 110.4,
      height: 49.2,
      radius: 24.6,
    });
    expect(background.y).toBeCloseTo(-4.6);
    expect(text.roundness.value).toBe(64);
  });

  it("keeps the text centered by applying equal padding on every side", () => {
    const text = API.createElement({
      type: "text",
      width: 80,
      height: 30,
      fontSize: 50,
      backgroundColor: "#00ff00",
    });

    const background = getTextBackgroundGeometry(text)!;

    expect(background.x).toBe(-13);
    expect(background.y).toBe(-11.5);
    expect(background.width - text.width).toBe(26);
    expect(background.height - text.height).toBe(23);
  });

  it("pads measured glyph bounds so the visible text is optically centered", () => {
    const text = API.createElement({
      type: "text",
      width: 80,
      height: 30,
      fontSize: 50,
      backgroundColor: "#00ff00",
    });

    expect(
      getTextBackgroundGeometry(text, {
        x: 5,
        y: 8,
        width: 70,
        height: 18,
      }),
    ).toMatchObject({
      x: -8,
      y: -3.5,
      width: 96,
      height: 41,
    });
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
