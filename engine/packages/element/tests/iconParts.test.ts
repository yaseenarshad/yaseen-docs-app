// Yaseen Docs (YAZ-4354 1D): parts, groups, the tint and the pick map of "Edit colors".
import { MIME_TYPES } from "@excalidraw/common";

import type { Radians } from "@excalidraw/math";

import { readIconInfo } from "../src/iconColors";
import {
  PICK_MAP_SIZE,
  buildIconParts,
  groupColorChange,
  groupIconColors,
  iconNaturalSize,
  iconPickMapSvg,
  iconPickPointOfScene,
  iconScenePointOfPick,
  pickColors,
  pickIconTarget,
  readIconPickMap,
  greyIconColors,
  hueIconColors,
  matchBoardIconColors,
  tintIconColors,
} from "../src/iconParts";

const rects = (fills: string[], extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${extra}${fills
    .map(
      (fill, i) =>
        `<rect x="${(i % 4) * 4}" y="${
          Math.floor(i / 4) * 8
        }" width="4" height="8" ${fill}/>`,
    )
    .join("")}</svg>`;

const TWO = rects(['fill="#e03131"', 'fill="#1971c2"']);
const EIGHT = rects(
  [
    "#e03131",
    "#1971c2",
    "#2f9e44",
    "#f08c00",
    "#7048e8",
    "#0c8599",
    "#e8590c",
    "#868e96",
  ].map((c) => `fill="${c}"`),
);
const STYLED = rects(
  ['class="a"', 'class="b"', 'class="a"'],
  "<style>.a{fill:#ffd43b}.b{fill:#1e1e1e}</style>",
);

/**
 * A stand-in for the canvas step: draws the pick SVG's rects (the test icons are
 * only rects, 16 × 16) into a 512 × 512 RGBA buffer, in their pick colors.
 */
const rasterize = (pickSvg: string) => {
  const data = new Uint8ClampedArray(PICK_MAP_SIZE * PICK_MAP_SIZE * 4);
  const doc = new DOMParser().parseFromString(pickSvg, MIME_TYPES.svg);
  const scale = PICK_MAP_SIZE / 16;
  for (const rect of Array.from(doc.querySelectorAll("rect"))) {
    const fill = [
      ...(rect.getAttribute("style") ?? "").matchAll(/fill:(#[0-9a-f]{6})/g),
    ].pop()?.[1];
    if (!fill) {
      continue;
    }
    const n = parseInt(fill.slice(1), 16);
    const [x, y, w, h] = ["x", "y", "width", "height"].map(
      (a) => Number(rect.getAttribute(a)) * scale,
    );
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const o = (py * PICK_MAP_SIZE + px) * 4;
        data.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], o);
      }
    }
  }
  return data;
};

const pickMapOf = (svg: string) => {
  const pick = iconPickMapSvg(svg, 0)!;
  const map = readIconPickMap(
    rasterize(pick.svg),
    PICK_MAP_SIZE,
    PICK_MAP_SIZE,
    pick.colors,
  );
  return { pick, map };
};

/** the pick-map point in the middle of rect `i` of the test grid */
const middleOf = (i: number) => ({
  x: ((i % 4) * 4 + 2) * 32,
  y: (Math.floor(i / 4) * 8 + 4) * 32,
});

describe("the pick map", () => {
  it.each([
    ["a 2-color icon", TWO, 2],
    ["an 8-color icon", EIGHT, 8],
    ["an icon with a <style> block", STYLED, 3],
  ])("names the right part for %s", (_, svg, count) => {
    const { pick, map } = pickMapOf(svg);
    expect(pick.targets).toHaveLength(count);
    for (let i = 0; i < count; i++) {
      const { x, y } = middleOf(i);
      expect(pick.targets[pickIconTarget(map, x, y)].key).toBe(`${i}`);
      // each part's number points inside it
      const anchor = map.anchors[i]!;
      expect(pickIconTarget(map, anchor.x, anchor.y)).toBe(i);
    }
    expect(map.areas[0]).toBe(128 * 256);
    // outside every part (the 8-color grid fills the whole picture)
    expect(pickIconTarget(map, 511, 511)).toBe(count > 4 ? 7 : -1);
  });

  it("gives each part a different color, and puts no SVG text or colors of the icon in it", () => {
    expect(new Set(pickColors(500)).size).toBe(500);
    const { pick } = pickMapOf(STYLED);
    expect(pick.svg).not.toContain("#ffd43b !important");
    expect(pick.svg).toContain('width="512"');
  });
});

describe("groups and scopes", () => {
  it("groups the parts by the color they show now", () => {
    const targets = buildIconParts(STYLED);
    const groups = groupIconColors(targets, { colors: {} }, [10, 5, 10]);
    expect(groups.map((g) => [g.color, g.keys])).toEqual([
      ["#ffd43b", ["0", "2"]],
      ["#1e1e1e", ["1"]],
    ]);
  });

  it('"every part" changes the color map; "just this part" leaves its group', () => {
    const targets = buildIconParts(STYLED);
    const [yellow] = groupIconColors(targets, { colors: {} });
    expect(groupColorChange(yellow, "#e03131")).toEqual({
      colors: { "#ffd43b": "#e03131" },
      parts: {},
    });
    const recipe = { colors: {}, parts: { "2": "#2f9e44" } };
    const groups = groupIconColors(targets, recipe);
    expect(groups.find((g) => g.color === "#ffd43b")!.keys).toEqual(["0"]);
    const green = groups.find((g) => g.color === "#2f9e44")!;
    expect(groupColorChange(green, "#7048e8")).toEqual({
      colors: {},
      parts: { "2": "#7048e8" },
    });
  });
});

describe("the tint", () => {
  it("turns the hue of colored parts and keeps black, white, greys and lightness", () => {
    const colors = tintIconColors(
      ["#000000", "#ffffff", "#868e96", "#ff0000", "currentColor"],
      120,
    );
    expect(colors).toEqual({ "#ff0000": "#00ff00" });
    expect(tintIconColors(["#ff0000"], 0)).toEqual({});
  });
});

// YAZ-4348 demo: the prebuilt variations of Edit colors
describe("the variations", () => {
  const hsl = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(
      (v) => v / 255,
    );
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const h = !d
      ? 0
      : max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
      ? ((b - r) / d + 2) * 60
      : ((r - g) / d + 4) * 60;
    return { h, l: (max + min) / 2 };
  };
  const GREYS = ["#000000", "#ffffff", "#868e96", "currentColor"];

  it("Blue puts the most used color on blue, keeps each lightness and keeps black, white and greys", () => {
    const colors = hueIconColors(["#e03131", "#ffd43b", ...GREYS], 215);
    expect(Object.keys(colors)).toEqual(["#e03131", "#ffd43b"]);
    expect(hsl(colors["#e03131"]).h).toBeCloseTo(215, -1);
    // yellow sits 50° from red: it keeps a quarter of that
    expect(hsl(colors["#ffd43b"]).h).toBeCloseTo(215 + 12, -1);
    for (const original of ["#e03131", "#ffd43b"]) {
      expect(hsl(colors[original]).l).toBeCloseTo(hsl(original).l, 2);
    }
    expect(hueIconColors(GREYS, 215)).toEqual({});
  });

  it("Grey takes the color out and keeps the lightness", () => {
    const colors = greyIconColors(["#e03131", ...GREYS]);
    expect(Object.keys(colors)).toEqual(["#e03131"]);
    const grey = colors["#e03131"];
    expect(grey.slice(1, 3)).toBe(grey.slice(3, 5));
    expect(grey.slice(3, 5)).toBe(grey.slice(5, 7));
    expect(hsl(grey).l).toBeCloseTo(hsl("#e03131").l, 2);
  });

  it("Match my board takes the nearest board color by hue; none with a board of greys", () => {
    expect(matchBoardIconColors(["#e03131"], ["#1e1e1e", "#ffffff"])).toBe(
      null,
    );
    expect(
      matchBoardIconColors(
        ["#e03131", "#1971c2", ...GREYS],
        ["#1e1e1e", "#E8590C", "#1c7ed6"],
      ),
    ).toEqual({ "#e03131": "#e8590c", "#1971c2": "#1c7ed6" });
  });

  it("Match my board keeps the light-to-dark order when two colors go to one board color", () => {
    const colors = matchBoardIconColors(["#1864ab", "#a5d8ff"], ["#1c7ed6"])!;
    // the closer in lightness gets the board color exactly
    expect(colors["#1864ab"]).toBe("#1c7ed6");
    expect(hsl(colors["#a5d8ff"]).l).toBeGreaterThan(hsl("#1c7ed6").l);
    expect(hsl(colors["#a5d8ff"]).h).toBeCloseTo(hsl("#1c7ed6").h, -1);
  });
});

describe("board ↔ pick map", () => {
  const info = readIconInfo(TWO);
  const natural = iconNaturalSize(info);

  it.each([
    ["plain", { angle: 0, scale: [1, 1], crop: null }],
    ["rotated", { angle: 0.7, scale: [1, 1], crop: null }],
    ["flipped", { angle: 0, scale: [-1, 1], crop: null }],
    [
      "cropped",
      {
        angle: 0.3,
        scale: [1, -1],
        crop: {
          x: 2,
          y: 2,
          width: 12,
          height: 12,
          naturalWidth: 16,
          naturalHeight: 16,
        },
      },
    ],
  ])("a %s icon maps both ways", (_, box) => {
    const element = {
      x: 100,
      y: 50,
      width: 64,
      height: 64,
      ...box,
      angle: box.angle as Radians,
      scale: box.scale as [number, number],
    };
    const pick = { x: 200, y: 300 };
    const scene = iconScenePointOfPick(element, natural, pick)!;
    const back = iconPickPointOfScene(element, natural, scene)!;
    expect(back.x).toBeCloseTo(pick.x);
    expect(back.y).toBeCloseTo(pick.y);
  });

  it("a flip mirrors the picture", () => {
    const element = {
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      angle: 0 as Radians,
      scale: [-1, 1] as [number, number],
      crop: null,
    };
    // the board's left edge shows the picture's right edge
    expect(iconPickPointOfScene(element, natural, { x: 1, y: 32 })!.x).toBe(
      504,
    );
  });
});
