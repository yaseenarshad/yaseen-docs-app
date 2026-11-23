import { FONT_FAMILY } from "@excalidraw/common";
import {
  getTextElementStyledLines,
  newTextElement,
  setCustomTextMetricsProvider,
} from "@excalidraw/element";

import type { Scene } from "@excalidraw/element";

import { Fonts } from "./Fonts";

describe("adding the registered faces to document.fonts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (document.fonts as any)[Symbol.iterator];
  });

  it("skips a face fonts.css already declares, so its file is fetched once (YAZ-2073 5B)", async () => {
    const faceOf = (family: number) =>
      Fonts.registered.get(family)!.fontFaces.map(({ fontFace }) => fontFace);
    // how the stylesheet's `@font-face` rules show up in `document.fonts`
    const declared = faceOf(FONT_FAMILY.Assistant).map(
      ({ family, weight, style, stretch, unicodeRange }) => ({
        family: `"${family}"`,
        weight,
        style,
        stretch,
        unicodeRange,
      }),
    );
    (document.fonts as any)[Symbol.iterator] = () =>
      declared[Symbol.iterator]();
    vi.spyOn(document.fonts, "has").mockReturnValue(false);
    const add = vi.spyOn(document.fonts, "add");

    await Fonts.loadElementsFonts([]);

    const added = add.mock.calls.map(([face]) => face);
    for (const face of faceOf(FONT_FAMILY.Assistant)) {
      expect(added).not.toContain(face);
    }
    for (const face of faceOf(FONT_FAMILY.Excalifont)) {
      expect(added).toContain(face);
    }
  });
});

describe("YAZ-4438: a font that loads", () => {
  const perLetter = (px: number) => ({
    getLineWidth: (text: string) => Array.from(text).length * px,
  });
  afterEach(() => {
    setCustomTextMetricsProvider({
      getLineWidth: (text) => text.length * 10,
    });
  });

  it("makes the next layout of a box measure with the real font", () => {
    const text = "• one two three four five six seven eight nine ten\n• b";
    const make = () =>
      newTextElement({ x: 0, y: 0, text, fontFamily: FONT_FAMILY.Nunito });
    const element = make();
    const scene = {
      getNonDeletedElements: () => [element],
      getNonDeletedElementsMap: () => new Map([[element.id, element]]),
      triggerUpdate: vi.fn(),
    } as unknown as Scene;
    const lines = () =>
      getTextElementStyledLines(element, 200, text).map((line) => line.text);

    setCustomTextMetricsProvider(perLetter(8)); // the fallback font
    const before = lines();
    setCustomTextMetricsProvider(perLetter(12));
    new Fonts(scene).onLoaded([
      {
        family: "YAZ-4438 real font",
        style: "normal",
        weight: "400",
        unicodeRange: "U+0-FF",
      } as FontFace,
    ]);
    const fresh = getTextElementStyledLines(make(), 200, text).map(
      (line) => line.text,
    );

    expect(scene.triggerUpdate).toHaveBeenCalled();
    expect(fresh).not.toEqual(before);
    expect(lines()).toEqual(fresh);
  });
});
