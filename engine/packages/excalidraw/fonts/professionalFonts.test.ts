import { FONT_FAMILY, FONT_METADATA } from "@excalidraw/common";

import { API } from "../tests/helpers/api";

import { ExcalidrawFontFace } from "./ExcalidrawFontFace";
import { Fonts } from "./Fonts";

describe("professional font registration", () => {
  const expectedFamilies = [
    ["Liberation Sans", 9],
    ["Assistant", 10],
    ["Inter", 11],
    ["Roboto", 12],
    ["Liberation Serif", 13],
    ["IBM Plex Mono", 14],
  ] as const;

  it("keeps persisted IDs append-only and exposes real metrics", () => {
    for (const [family, id] of expectedFamilies) {
      expect(FONT_FAMILY[family]).toBe(id);
      expect(FONT_METADATA[id]?.metrics).toMatchObject({
        unitsPerEm: expect.any(Number),
        ascender: expect.any(Number),
        descender: expect.any(Number),
        lineHeight: expect.any(Number),
      });
    }

    expect(Object.values(FONT_FAMILY)).not.toContain(4);
    expect(FONT_METADATA[FONT_FAMILY["Liberation Sans"]]?.private).not.toBe(
      true,
    );
  });

  it.each(
    expectedFamilies.filter(
      ([family]) => family !== "Assistant",
    ) as unknown as [keyof typeof FONT_FAMILY, number][],
  )("registers local Regular and Bold faces for %s", (family, id) => {
    const registration = Fonts.registered.get(id);
    expect(registration).toBeDefined();
    expect(
      registration?.fontFaces.map((face) => face.descriptors.weight),
    ).toEqual(expect.arrayContaining(["400", "700"]));
    expect(
      registration?.fontFaces.every((face) =>
        face.urls.some((url) => url.toString().endsWith(".woff2")),
      ),
    ).toBe(true);
    expect(registration?.fontFaces[0].fontFace.family).toBe(family);
  });

  it("requests the authored weight when loading scene fonts", async () => {
    const check = vi.spyOn(document.fonts, "check").mockReturnValue(false);
    const load = vi.spyOn(document.fonts, "load").mockResolvedValue([]);

    await Fonts.loadElementsFonts([
      {
        ...API.createElement({
          type: "text",
          fontFamily: FONT_FAMILY.Inter,
          text: "Heavy",
        }),
        fontWeight: "bold",
      },
      {
        ...API.createElement({
          type: "text",
          fontFamily: FONT_FAMILY.Inter,
          text: "Regular",
        }),
        fontWeight: "normal",
      },
    ]);

    expect(check).toHaveBeenCalledWith(
      expect.stringContaining("bold "),
      "Heavy",
    );
    expect(check).toHaveBeenCalledWith(
      expect.not.stringContaining("bold "),
      "Regular",
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("requests Regular and Bold faces for mixed logical-line weights", async () => {
    vi.clearAllMocks();
    const check = vi.spyOn(document.fonts, "check").mockReturnValue(false);
    const load = vi.spyOn(document.fonts, "load").mockResolvedValue([]);

    await Fonts.loadElementsFonts([
      {
        ...API.createElement({
          type: "text",
          fontFamily: FONT_FAMILY.Inter,
          text: "Title\nBody",
        }),
        fontWeight: "normal",
        lineBolds: [true],
      },
    ]);

    expect(check).toHaveBeenCalledWith(
      expect.stringContaining("bold "),
      "Title\nBody",
    );
    expect(check).toHaveBeenCalledWith(
      expect.not.stringContaining("bold "),
      "Title\nBody",
    );
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("embedded font CSS", () => {
  it("preserves face weight, style, display, and unicode range", async () => {
    const face = new ExcalidrawFontFace(
      "IBM Plex Mono",
      "data:font/woff2;base64,AA==",
      {
        weight: "700",
        style: "normal",
        display: "swap",
        unicodeRange: "U+0000-024F",
      },
    );
    vi.spyOn(face, "getContent").mockResolvedValue(
      "data:font/woff2;base64,BBBB",
    );

    await expect(face.toCSS("Bold")).resolves.toContain("font-weight: 700");
    await expect(face.toCSS("Bold")).resolves.toContain("font-style: normal");
    await expect(face.toCSS("Bold")).resolves.toContain("font-display: swap");
    await expect(face.toCSS("Bold")).resolves.toContain(
      "unicode-range: U+0000-024F",
    );
  });
});
