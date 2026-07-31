import { ROUNDNESS } from "@excalidraw/common";
import { pointFrom, type GlobalPoint } from "@excalidraw/math";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  getFreeTextInteractionCoords,
  getFreeTextInteractionGeometry,
  getTextBackgroundGeometry,
  isPointInFreeTextInteractionBounds,
} from "../src/textElement";

describe("native text background geometry", () => {
  it("adds 0.04em padding around measured glyph interaction bounds", () => {
    const text = API.createElement({
      type: "text",
      width: 120,
      height: 75,
      fontSize: 60,
      backgroundColor: "#111111",
    });
    const measuredGlyphs = { x: 8, y: 14, width: 96, height: 42 };
    const interactionGeometry = getFreeTextInteractionGeometry(
      text,
      measuredGlyphs,
    )!;

    expect(interactionGeometry.x).toBeCloseTo(5.6);
    expect(interactionGeometry.y).toBeCloseTo(11.6);
    expect(interactionGeometry.width).toBeCloseTo(100.8);
    expect(interactionGeometry.height).toBeCloseTo(46.8);
    expect(interactionGeometry).not.toEqual({
      x: 0,
      y: 0,
      width: text.width,
      height: text.height,
    });
  });

  it("uses glyph-hugging interaction bounds for transparent free text", () => {
    const text = API.createElement({
      type: "text",
      width: 120,
      height: 75,
      fontSize: 60,
      backgroundColor: "transparent",
    });
    const measuredGlyphs = { x: 8, y: 14, width: 96, height: 42 };

    expect(getFreeTextInteractionGeometry(text, measuredGlyphs)).toEqual({
      x: 5.6,
      y: 11.6,
      width: 100.8,
      height: 46.8,
    });
  });

  it("positions the glyph-hugging interaction box in scene coordinates", () => {
    const text = API.createElement({
      type: "text",
      x: 100,
      y: 200,
      width: 120,
      height: 75,
      fontSize: 60,
      backgroundColor: "#111111",
    });
    const measuredGlyphs = { x: 8, y: 14, width: 96, height: 42 };
    const coords = getFreeTextInteractionCoords(text, measuredGlyphs)!;
    expect(coords[0]).toBeCloseTo(text.x + 5.6);
    expect(coords[1]).toBeCloseTo(text.y + 11.6);
    expect(coords[2]).toBeCloseTo(text.x + 106.4);
    expect(coords[3]).toBeCloseTo(text.y + 58.4);
    expect(coords[4]).toBeCloseTo(text.x + 56);
    expect(coords[5]).toBeCloseTo(text.y + 35);
  });

  it("hit-tests only the glyph-hugging free-text interaction box", () => {
    const text = API.createElement({
      type: "text",
      x: 100,
      y: 200,
      width: 120,
      height: 75,
      fontSize: 60,
      backgroundColor: "transparent",
    });
    const measuredGlyphs = { x: 8, y: 14, width: 96, height: 42 };
    expect(
      isPointInFreeTextInteractionBounds(
        text,
        pointFrom<GlobalPoint>(156, 235),
        0,
        measuredGlyphs,
      ),
    ).toBe(true);
    expect(
      isPointInFreeTextInteractionBounds(
        text,
        pointFrom<GlobalPoint>(156, 270),
        0,
        measuredGlyphs,
      ),
    ).toBe(false);
  });

  it("preserves existing interaction geometry for shape-bound text", () => {
    const text = API.createElement({
      type: "text",
      containerId: "container",
      backgroundColor: "transparent",
    });

    expect(getFreeTextInteractionGeometry(text)).toBeNull();
  });

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
