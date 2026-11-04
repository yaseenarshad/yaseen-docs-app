// Yaseen Docs (YAZ-4351 1A): reading and painting icon colors.
import { MIME_TYPES } from "@excalidraw/common";

import {
  getIconInfo,
  iconOutlineWidth,
  iconSource,
  normalizeIconColor,
  paintIcon,
  paintIconElement,
  readIconColors,
  readIconInfo,
  readIconParts,
  svgOfDataURL,
  svgToDataURL,
} from "../src/iconColors";

import type { FileId } from "../src/types";

/** an Iconify one-color icon, as the Add panel gets it */
const ONE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M4 11h12l-5-5 1.4-1.4L20 12l-7.6 7.4L11 18l5-5H4z"/></svg>';

const MANY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<defs><linearGradient id="fed"><stop offset="0" stop-color="#FC0"/><stop offset="1" stop-color="#f80"/></linearGradient>' +
  '<clipPath id="c"><rect width="32" height="32"/></clipPath></defs>' +
  '<circle cx="16" cy="16" r="14" fill="#F00"/>' +
  '<path d="M8 8h4v4H8z" fill="rgb(0, 0, 255)" stroke="#000" stroke-width="2"/>' +
  '<rect x="20" y="20" width="4" height="4" fill="url(#fed)"/>' +
  '<path d="M1 1h2v2H1z"/>' +
  "</svg>";

const STYLED =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
  "<style>.cls-1{fill:#e03131;}/* a note */ .cls-2 { fill: #1971c2 }</style>" +
  '<path class="cls-1" d="M0 0h12v12H0z"/><path class="cls-2" fill="#000" d="M12 12h12v12H12z"/></svg>';

/** the fill attribute of the n-th element with this tag in a (painted) SVG */
const attr = (svg: string, tag: string, index: number, name: string) =>
  new DOMParser()
    .parseFromString(svg, MIME_TYPES.svg)
    .querySelectorAll(tag)
    [index].getAttribute(name);

describe("normalizeIconColor", () => {
  it("gives one key for one color", () => {
    expect(normalizeIconColor("#F00")).toBe("#ff0000");
    expect(normalizeIconColor("#ff000080")).toBe("#ff0000");
    expect(normalizeIconColor("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(normalizeIconColor("red")).toBe("#ff0000");
    expect(normalizeIconColor("CurrentColor")).toBe("currentColor");
    expect(normalizeIconColor("none")).toBeNull();
    expect(normalizeIconColor("url(#fed)")).toBeNull();
    expect(normalizeIconColor("rgba(0,0,0,0)")).toBeNull();
  });
});

describe("readIconColors", () => {
  it("reads hex, 3-digit hex, rgb(), gradient stops and the default black", () => {
    expect(readIconColors(MANY).sort()).toEqual(
      ["#000000", "#0000ff", "#ff0000", "#ff8800", "#ffcc00"].sort(),
    );
  });

  it("reads currentColor as one color", () => {
    expect(readIconColors(ONE)).toEqual(["currentColor"]);
    expect(readIconInfo(ONE).kind).toBe("one");
    expect(readIconInfo(MANY).kind).toBe("many");
  });

  it("reads colors set in a <style> block (extra 22)", () => {
    expect(readIconColors(STYLED).sort()).toEqual(["#1971c2", "#e03131"]);
  });

  it("counts parts in document order, outside defs and clipPath", () => {
    const { parts } = readIconParts(MANY)!;
    expect(parts.map((p) => p.element.localName)).toEqual([
      "circle",
      "path",
      "rect",
      "path",
    ]);
  });

  it("calls a picture with an <image> inside a photo", () => {
    const photo = ONE.replace(
      "</svg>",
      '<image href="data:image/png;base64,AAAA"/></svg>',
    );
    expect(readIconInfo(photo).kind).toBe("photo");
  });
});

describe("paintIcon", () => {
  it("paints the colors and keeps ids untouched", () => {
    const painted = paintIcon(MANY, {
      colors: { "#ff0000": "#2f9e44", "#ffcc00": "#7048e8" },
      outline: null,
    });
    expect(attr(painted, "circle", 0, "fill")).toBe("#2f9e44");
    expect(attr(painted, "stop", 0, "stop-color")).toBe("#7048e8");
    expect(attr(painted, "stop", 1, "stop-color")).toBe("#f80");
    expect(painted).toContain('id="fed"');
    expect(painted).toContain('fill="url(#fed)"');
    expect(readIconColors(iconSource(painted))).toEqual(readIconColors(MANY));
    const stops = readIconParts(painted)!;
    // the painted copy reads back as its original
    expect(stops.parts.length).toBe(4);
  });

  it("paints the default black of a shape that declares no fill", () => {
    const painted = paintIcon(MANY, {
      colors: { "#000000": "#e03131" },
      outline: null,
    });
    const doc = new DOMParser().parseFromString(painted, MIME_TYPES.svg);
    const paths = doc.querySelectorAll("path");
    expect(paths[1].getAttribute("fill")).toBe("#e03131");
    expect(paths[0].getAttribute("stroke")).toBe("#e03131");
  });

  it("paints colors inside <style> rules, not the selectors", () => {
    const painted = paintIcon(STYLED, {
      colors: { "#e03131": "#ffffff" },
      outline: null,
    });
    expect(painted).toContain(".cls-1{fill:#ffffff");
    expect(painted).toContain(".cls-2");
    expect(painted).toContain("#1971c2");
  });

  it("paints currentColor", () => {
    const painted = paintIcon(ONE, {
      colors: { currentColor: "#e03131" },
      outline: null,
    });
    expect(painted).toContain('fill="#e03131"');
    expect(painted).not.toContain("currentColor");
    expect(painted).toContain('width="16"');
  });

  it("starts each paint from the original, not from a painted copy", () => {
    const first = paintIcon(ONE, {
      colors: { currentColor: "#e03131" },
      outline: null,
    });
    const second = paintIcon(first, {
      colors: { currentColor: "#1971c2" },
      outline: null,
    });
    expect(second).toContain('fill="#1971c2"');
    expect(second).not.toContain("#e03131");
    expect(iconSource(second)).toBe(ONE);
    expect(second.match(/yaseen-icon-source/g)).toHaveLength(1);
  });

  it("lets a part color win over the colors map, fill and stroke apart", () => {
    const painted = paintIcon(MANY, {
      colors: { "#0000ff": "#ff00ff" },
      parts: { "1": "#00ff00", "1:stroke": "#ffffff" },
      outline: null,
    });
    const doc = new DOMParser().parseFromString(painted, MIME_TYPES.svg);
    const style = doc.querySelectorAll("path")[0].getAttribute("style");
    expect(style).toContain("fill:#00ff00 !important");
    expect(style).toContain("stroke:#ffffff !important");
  });

  it("puts an outline behind the shape and grows the view box", () => {
    const painted = paintIcon(
      ONE,
      { colors: {}, outline: { color: "#ffffff", width: 4 } },
      2,
    );
    expect(painted).toContain("feMorphology");
    expect(painted).toContain('viewBox="-2 -2 28 28"');
    expect(painted).toContain('width="18.667"');
    expect(readIconInfo(painted).geometry!.outline).toBe(2);
  });
});

describe("paintIconElement", () => {
  const element = {
    x: 100,
    y: 100,
    width: 48,
    height: 48,
    crop: null,
    customData: { keep: 1 },
  };

  it("grows the box by the outline on each side, and shrinks it back", () => {
    const outlined = paintIconElement(element, ONE, {
      colors: { currentColor: "#e03131" },
      outline: { color: "#1e1e1e", width: 4 },
    });
    expect(outlined.updates).toMatchObject({
      x: 96,
      y: 96,
      width: 56,
      height: 56,
    });
    expect(outlined.updates.customData).toEqual({
      keep: 1,
      yaseenIcon: {
        colors: { currentColor: "#e03131" },
        outline: { color: "#1e1e1e", width: 4 },
      },
    });
    const info = readIconInfo(outlined.svg);
    expect(
      iconOutlineWidth({ ...element, ...outlined.updates }, info),
    ).toBeCloseTo(4);

    const back = paintIconElement(
      { ...element, ...outlined.updates },
      outlined.svg,
      { colors: {}, outline: null },
    );
    expect(back.updates).toMatchObject({
      x: 100,
      y: 100,
      width: 48,
      height: 48,
    });
    expect(back.updates.customData).toEqual({ keep: 1 });
    // an empty recipe gives back the original itself
    expect(back.svg).toBe(ONE);
  });

  it("keeps the outline's width across a resize", () => {
    const outlined = paintIconElement(element, ONE, {
      colors: {},
      outline: { color: "#1e1e1e", width: 4 },
    });
    // the user doubles the size: the outline doubles with it
    const resized = {
      ...outlined.updates,
      width: outlined.updates.width * 2,
      height: outlined.updates.height * 2,
    };
    const info = readIconInfo(outlined.svg);
    expect(iconOutlineWidth(resized, info)).toBeCloseTo(8);
  });

  it("moves the crop instead of the box for a cropped icon", () => {
    const crop = {
      x: 4,
      y: 4,
      width: 8,
      height: 8,
      naturalWidth: 16,
      naturalHeight: 16,
    };
    const result = paintIconElement({ ...element, crop }, ONE, {
      colors: {},
      outline: { color: "#000000", width: 6 },
    });
    expect(result.updates.width).toBe(48);
    // 6 board px = 1 natural px = 1.5 SVG units at this crop's scale
    expect(result.updates.crop!.x).toBeCloseTo(5);
    expect(result.updates.crop!.naturalWidth).toBeCloseTo(18);
  });
});

describe("the file", () => {
  it("keeps the source through a data URL round trip", () => {
    const painted = paintIcon(ONE.replace("M4", "M4 ✓"), {
      colors: { currentColor: "#e03131" },
      outline: null,
    });
    const back = svgOfDataURL(svgToDataURL(painted));
    expect(back).toBe(painted);
    expect(iconSource(back)).toContain("✓");
  });

  it("caches the info by file id", () => {
    const file = {
      id: "one-file" as FileId,
      mimeType: MIME_TYPES.svg,
      dataURL: svgToDataURL(ONE),
    };
    expect(getIconInfo(file).kind).toBe("one");
    expect(getIconInfo({ ...file, dataURL: svgToDataURL(MANY) }).kind).toBe(
      "one",
    );
    expect(
      getIconInfo({
        id: "png" as FileId,
        mimeType: MIME_TYPES.png,
        dataURL: file.dataURL,
      }).kind,
    ).toBe("photo");
  });
});
