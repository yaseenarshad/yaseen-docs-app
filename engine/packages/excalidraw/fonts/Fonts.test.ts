import { FONT_FAMILY } from "@excalidraw/common";

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
