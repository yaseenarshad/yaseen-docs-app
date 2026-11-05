// -----------------------------------------------------------------------------
// Yaseen Docs (YAZ-4354 1D): the parts of a many-color icon, for "Edit colors"
//
// A part is a shape of the original in document order (1A); each paints a fill
// and maybe a stroke, a "paint target" (`"3"`, `"3:stroke"`). The numbers on the
// board are the colors the targets show NOW, grouped.
//
// A click finds its part through a hidden "pick map" (round 2, decision 2): the
// engine paints each target a unique color in a hidden 512 × 512 picture, and the
// pixel under the pointer names the target. No SVG goes into the page. The pure
// steps live here (the pick SVG, the id colors, reading a pixel buffer, the
// coordinates); `loadIconPickMap` is the thin canvas step.
// -----------------------------------------------------------------------------

import { colorToHsl, hslToHex, SVG_NS } from "@excalidraw/common";

import {
  appendIconStyle,
  iconGeometryOf,
  iconSource,
  makeIconReader,
  readIconPartList,
  setIconGeometry,
  walkIcon,
} from "./iconColors";

import type { IconInfo, IconPaint, IconPart, IconRecipe } from "./iconColors";
import type { ExcalidrawImageElement } from "./types";

export type IconPaintTarget = {
  /** `"3"` (part 3's fill) or `"3:stroke"` */
  key: string;
  part: number;
  prop: "fill" | "stroke";
  /** the original colors: one, or a gradient's stops */
  colors: string[];
  gradient: boolean;
};

const targetOf = (
  part: number,
  prop: "fill" | "stroke",
  paint: IconPaint | null,
): IconPaintTarget | null =>
  paint
    ? {
        key: prop === "fill" ? `${part}` : `${part}:stroke`,
        part,
        prop,
        colors:
          "color" in paint ? [paint.color] : paint.stops.map((s) => s.color),
        gradient: !("color" in paint),
      }
    : null;

/** The paint targets of some parts, in document order (fill, then stroke). */
const targetsOfParts = (parts: readonly IconPart[]): IconPaintTarget[] =>
  parts.flatMap((part) =>
    [
      targetOf(part.index, "fill", part.fill),
      targetOf(part.index, "stroke", part.stroke),
    ].filter((target): target is IconPaintTarget => !!target),
  );

/** The paint targets of an SVG's original, in document order (fill, then stroke). */
export const buildIconParts = (svgText: string): IconPaintTarget[] => {
  const reader = makeIconReader(iconSource(svgText));
  return reader ? targetsOfParts(readIconPartList(reader)) : [];
};

/** The colors a target shows with this recipe (a part color wins). */
export const currentTargetColors = (
  target: IconPaintTarget,
  recipe: Pick<IconRecipe, "colors" | "parts">,
) => {
  const part = recipe.parts?.[target.key];
  return part
    ? [part]
    : target.colors.map((color) => recipe.colors[color] ?? color);
};

export type IconColorGroup = {
  /** the color the parts show now */
  color: string;
  /** the targets that show it (a shaded part shows several colors) */
  keys: string[];
  /** the original colors behind it, through the `colors` map */
  originals: string[];
  /** the targets that show it through their own part color */
  partKeys: string[];
  /** pixels in the pick map (0 before it is read) */
  area: number;
};

/** The numbers on the board: one per color shown now, the biggest first. */
export const groupIconColors = (
  targets: readonly IconPaintTarget[],
  recipe: Pick<IconRecipe, "colors" | "parts">,
  areas: readonly number[] = [],
): IconColorGroup[] => {
  const groups = new Map<string, IconColorGroup>();
  const groupOf = (color: string) => {
    let group = groups.get(color);
    if (!group) {
      group = { color, keys: [], originals: [], partKeys: [], area: 0 };
      groups.set(color, group);
    }
    return group;
  };
  targets.forEach((target, index) => {
    const part = recipe.parts?.[target.key];
    if (part) {
      const group = groupOf(part);
      group.keys.push(target.key);
      group.partKeys.push(target.key);
      group.area += areas[index] ?? 0;
      return;
    }
    for (const original of target.colors) {
      const group = groupOf(recipe.colors[original] ?? original);
      if (!group.keys.includes(target.key)) {
        group.keys.push(target.key);
        group.area += areas[index] ?? 0;
      }
      if (!group.originals.includes(original)) {
        group.originals.push(original);
      }
    }
  });
  return [...groups.values()].sort((a, b) => b.area - a.area);
};

/** The change for "every part with this color" (the default scope). */
export const groupColorChange = (
  group: IconColorGroup,
  color: string | null,
) => ({
  colors: Object.fromEntries(group.originals.map((o) => [o, color])),
  parts: Object.fromEntries(group.partKeys.map((k) => [k, color])),
});

// -----------------------------------------------------------------------------
// the tint (round 3, decision 7)
// -----------------------------------------------------------------------------

/** Below this saturation a color is a grey: the tint keeps it. */
const TINT_MIN_SATURATION = 0.12;

/** YAZ-4366: through tinycolor2 (`@excalidraw/common`); the keys are always `#rrggbb` here. */
const toHsl = (hex: string) => colorToHsl(hex) ?? { h: 0, s: 0, l: 0 };
const fromHsl = hslToHex;

/**
 * The tint: each colored original turned by `degrees` of hue. Black, white and
 * greys (saturation under 12%) and each color's lightness stay. A normal
 * `colors` map.
 */
export const tintIconColors = (
  originals: readonly string[],
  degrees: number,
): Record<string, string> => {
  const turn = ((degrees % 360) + 360) % 360;
  const colors: Record<string, string> = {};
  if (!turn) {
    return colors;
  }
  for (const original of originals) {
    if (!original.startsWith("#")) {
      continue;
    }
    const { h, s, l } = toHsl(original);
    if (s >= TINT_MIN_SATURATION) {
      colors[original] = fromHsl((h + turn) % 360, s, l);
    }
  }
  return colors;
};

// -----------------------------------------------------------------------------
// the variations (YAZ-4348 demo: "prebuilt color variations to edit colors
// including match my board"). Each is a normal `colors` map, as the tint.
// -----------------------------------------------------------------------------

/** The hue of each prebuilt variation, in degrees. */
export const ICON_VARIATION_HUES = {
  blue: 215,
  green: 140,
  purple: 270,
  pink: 330,
} as const;

/** How much of the colors' own hue spread a variation keeps (0: one hue). */
const VARIATION_SPREAD = 0.25;
/** A variation's colors are at least this saturated, so a dull icon turns too. */
const VARIATION_MIN_SATURATION = 0.4;

/** The signed hue step from `b` to `a`, in (-180, 180]. */
const hueGap = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

type HslColor = { color: string; h: number; s: number; l: number };

/** The colored ones (not black, white or grey) of some hex colors, with their HSL. */
const coloredOf = (colors: readonly string[]): HslColor[] =>
  colors
    .filter((color) => /^#[0-9a-f]{6}$/i.test(color))
    .map((color) => ({ color, ...toHsl(color) }))
    .filter(({ s }) => s >= TINT_MIN_SATURATION);

/**
 * One hue for the whole icon (Blue, Green, Purple, Pink): the most used color
 * lands on `hue`, the others keep a quarter of their distance from it. Each
 * color's lightness stays; black, white and greys stay.
 */
export const hueIconColors = (
  originals: readonly string[],
  hue: number,
): Record<string, string> => {
  const colored = coloredOf(originals);
  const colors: Record<string, string> = {};
  if (!colored.length) {
    return colors;
  }
  // `originals` is most used first (`getIconInfo`)
  const main = colored[0].h;
  for (const { color, h, s, l } of colored) {
    const turned = (hue + hueGap(h, main) * VARIATION_SPREAD + 360) % 360;
    const next = fromHsl(turned, Math.max(s, VARIATION_MIN_SATURATION), l);
    if (next !== color) {
      colors[color] = next;
    }
  }
  return colors;
};

/** Grey: every colored color loses its color and keeps its lightness. */
export const greyIconColors = (
  originals: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    coloredOf(originals).map(({ color, l }) => [color, fromHsl(0, 0, l)]),
  );

/**
 * "Match my board": each colored original goes to the nearest of the board's
 * colored colors (by hue first, then lightness). When several go to one board
 * color, the closest in lightness gets it exactly and the others keep their
 * lightness step from it, so their light-to-dark order stays. Black, white and
 * greys stay. Null when the board has no colored color.
 */
export const matchBoardIconColors = (
  originals: readonly string[],
  boardColors: readonly string[],
): Record<string, string> | null => {
  const board = coloredOf([
    ...new Set(boardColors.map((color) => color.toLowerCase())),
  ]);
  if (!board.length) {
    return null;
  }
  const groups = new Map<HslColor, HslColor[]>();
  for (const original of coloredOf(originals)) {
    let best = board[0];
    let bestScore = Infinity;
    for (const candidate of board) {
      const score =
        Math.abs(hueGap(original.h, candidate.h)) / 180 +
        0.5 * Math.abs(original.l - candidate.l);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    groups.set(best, [...(groups.get(best) ?? []), original]);
  }
  const colors: Record<string, string> = {};
  for (const [target, members] of groups) {
    const anchor = members.reduce((a, b) =>
      Math.abs(b.l - target.l) < Math.abs(a.l - target.l) ? b : a,
    );
    for (const member of members) {
      const next =
        member === anchor
          ? target.color
          : fromHsl(
              target.h,
              target.s,
              Math.min(0.96, Math.max(0.04, target.l + member.l - anchor.l)),
            );
      if (next !== member.color) {
        colors[member.color] = next;
      }
    }
  }
  return colors;
};

// -----------------------------------------------------------------------------
// the pick map
// -----------------------------------------------------------------------------

export const PICK_MAP_SIZE = 512;

/** A unique, spread-out color for target `index` (a blend of two never lands on a third). */
const pickColorOf = (index: number) => {
  // a multiply by an odd constant is one-to-one on 32 bits; the top 24 bits spread the ids
  const value = (Math.imul(index + 1, 0x9e3779b1) >>> 8) & 0xffffff;
  return `#${value.toString(16).padStart(6, "0")}`;
};

/** The pick colors of `count` targets, every one different. */
export const pickColors = (count: number) => {
  const used = new Set<string>();
  const colors: string[] = [];
  for (let n = 0; colors.length < count; n++) {
    const color = pickColorOf(n);
    if (!used.has(color) && color !== "#000000" && color !== "#ffffff") {
      used.add(color);
      colors.push(color);
    }
  }
  return colors;
};

const HIDDEN_TAGS = new Set(["text", "image", "foreignObject"]);
/** These draw their parts: flat, so a pixel keeps its exact pick color. */
const FLAT_TAGS = new Set(["g", "svg", "use", "symbol"]);

/**
 * The pick map's SVG: every paint target in its pick color, flat, with no
 * opacity, filter or anti-aliasing; text hidden. A `<use>` stays: its target
 * carries the pick color (YAZ-4373). The picture fills
 * 512 × 512 exactly as the element's file fills its box (same geometry, same
 * outline padding), so a pixel maps straight to the element.
 */
export const iconPickMapSvg = (svgText: string, outlineUnits: number) => {
  const reader = makeIconReader(iconSource(svgText));
  if (!reader) {
    return null;
  }
  const { svg } = reader;
  const geometry = iconGeometryOf(svg);
  const parts = readIconPartList(reader);
  // YAZ-4366: the targets from the same parse
  const targets = targetsOfParts(parts);
  const colors = pickColors(targets.length);
  const colorOf = new Map(targets.map((t, i) => [t.key, colors[i]]));

  walkIcon(svg, (element) => {
    if (HIDDEN_TAGS.has(element.localName)) {
      appendIconStyle(element, "display", "none");
    } else if (FLAT_TAGS.has(element.localName)) {
      appendIconStyle(element, "opacity", "1");
      appendIconStyle(element, "filter", "none");
    }
  });
  for (const part of parts) {
    const style: [string, string][] = [
      ["fill", colorOf.get(`${part.index}`) ?? "none"],
      ["stroke", colorOf.get(`${part.index}:stroke`) ?? "none"],
      ["opacity", "1"],
      ["fill-opacity", "1"],
      ["stroke-opacity", "1"],
      ["filter", "none"],
      ["shape-rendering", "crispEdges"],
    ];
    for (const [prop, value] of style) {
      appendIconStyle(part.element, prop, value);
    }
  }
  setIconGeometry(svg, geometry, outlineUnits);
  svg.setAttribute("x", "0");
  svg.setAttribute("y", "0");
  const width = svg.getAttribute("width");
  const height = svg.getAttribute("height");
  const outer = `<svg xmlns="${SVG_NS}" width="${PICK_MAP_SIZE}" height="${PICK_MAP_SIZE}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges">${svg.outerHTML}</svg>`;
  return { svg: outer, colors, targets };
};

export type IconPickMap = {
  width: number;
  height: number;
  /** the target index of each pixel, -1 for none */
  index: Int32Array;
  /** pixels per target */
  areas: number[];
  /** a pixel inside each target, nearest its middle (pick-map pixels), or null */
  anchors: ({ x: number; y: number } | null)[];
};

/** Reads a pick map's pixels (RGBA): which target each pixel shows, and each target's area and anchor. */
export const readIconPickMap = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  colors: readonly string[],
): IconPickMap => {
  const lookup = new Map(colors.map((c, i) => [parseInt(c.slice(1), 16), i]));
  const index = new Int32Array(width * height).fill(-1);
  const areas = new Array(colors.length).fill(0);
  const sumX = new Array(colors.length).fill(0);
  const sumY = new Array(colors.length).fill(0);
  for (let p = 0; p < width * height; p++) {
    const o = p * 4;
    if (data[o + 3] < 250) {
      continue;
    }
    const i = lookup.get((data[o] << 16) | (data[o + 1] << 8) | data[o + 2]);
    if (i !== undefined) {
      index[p] = i;
      areas[i]++;
      sumX[i] += p % width;
      sumY[i] += Math.floor(p / width);
    }
  }
  const best = new Array(colors.length).fill(Infinity);
  const anchors: ({ x: number; y: number } | null)[] = colors.map(() => null);
  for (let p = 0; p < width * height; p++) {
    const i = index[p];
    if (i < 0) {
      continue;
    }
    const x = p % width;
    const y = Math.floor(p / width);
    const d = (x - sumX[i] / areas[i]) ** 2 + (y - sumY[i] / areas[i]) ** 2;
    if (d < best[i]) {
      best[i] = d;
      anchors[i] = { x: x + 0.5, y: y + 0.5 };
    }
  }
  return { width, height, index, areas, anchors };
};

/** The target under a pick-map point; near an edge, the nearest target within 3 pixels. */
export const pickIconTarget = (map: IconPickMap, x: number, y: number) => {
  const px = Math.floor(x);
  const py = Math.floor(y);
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
          continue;
        }
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= map.width || qy >= map.height) {
          continue;
        }
        const i = map.index[qy * map.width + qx];
        if (i >= 0) {
          return i;
        }
      }
    }
  }
  return -1;
};

// -----------------------------------------------------------------------------
// coordinates: the board ↔ the pick map (rotated, flipped and cropped icons)
// -----------------------------------------------------------------------------

type IconBox = Pick<
  ExcalidrawImageElement,
  "x" | "y" | "width" | "height" | "angle" | "scale" | "crop"
>;

/** The painted file's natural size (its outline included). */
export const iconNaturalSize = (info: IconInfo) => {
  const g = info.geometry!;
  return {
    width: (g.width * (g.viewBox[2] + g.outline * 2)) / g.viewBox[2],
    height: (g.height * (g.viewBox[3] + g.outline * 2)) / g.viewBox[3],
  };
};

/** A board point in the pick map, or null outside the picture. */
export const iconPickPointOfScene = (
  element: IconBox,
  natural: { width: number; height: number },
  point: { x: number; y: number },
) => {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const cos = Math.cos(-element.angle);
  const sin = Math.sin(-element.angle);
  const dx = point.x - cx;
  const dy = point.y - cy;
  let lx = dx * cos - dy * sin + element.width / 2;
  let ly = dx * sin + dy * cos + element.height / 2;
  if (lx < 0 || ly < 0 || lx > element.width || ly > element.height) {
    return null;
  }
  if (element.scale[0] < 0) {
    lx = element.width - lx;
  }
  if (element.scale[1] < 0) {
    ly = element.height - ly;
  }
  const crop = element.crop;
  const nx = crop
    ? crop.x + (lx / element.width) * crop.width
    : (lx / element.width) * natural.width;
  const ny = crop
    ? crop.y + (ly / element.height) * crop.height
    : (ly / element.height) * natural.height;
  const nw = crop ? crop.naturalWidth : natural.width;
  const nh = crop ? crop.naturalHeight : natural.height;
  return { x: (nx / nw) * PICK_MAP_SIZE, y: (ny / nh) * PICK_MAP_SIZE };
};

/** A pick-map point on the board, or null when the crop hides it. */
export const iconScenePointOfPick = (
  element: IconBox,
  natural: { width: number; height: number },
  pick: { x: number; y: number },
) => {
  const crop = element.crop;
  const nw = crop ? crop.naturalWidth : natural.width;
  const nh = crop ? crop.naturalHeight : natural.height;
  const nx = (pick.x / PICK_MAP_SIZE) * nw;
  const ny = (pick.y / PICK_MAP_SIZE) * nh;
  let lx = crop
    ? ((nx - crop.x) / crop.width) * element.width
    : (nx / natural.width) * element.width;
  let ly = crop
    ? ((ny - crop.y) / crop.height) * element.height
    : (ny / natural.height) * element.height;
  if (lx < 0 || ly < 0 || lx > element.width || ly > element.height) {
    return null;
  }
  if (element.scale[0] < 0) {
    lx = element.width - lx;
  }
  if (element.scale[1] < 0) {
    ly = element.height - ly;
  }
  const dx = lx - element.width / 2;
  const dy = ly - element.height / 2;
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  return {
    x: element.x + element.width / 2 + dx * cos - dy * sin,
    y: element.y + element.height / 2 + dx * sin + dy * cos,
  };
};

// -----------------------------------------------------------------------------
// the canvas step (not in jsdom)
// -----------------------------------------------------------------------------

/** Draws the pick SVG in a hidden 512 × 512 canvas and reads it. Built once when the mode opens. */
export const loadIconPickMap = async (
  svgText: string,
  outlineUnits: number,
): Promise<{ map: IconPickMap; targets: IconPaintTarget[] } | null> => {
  const pick = iconPickMapSvg(svgText, outlineUnits);
  if (!pick) {
    return null;
  }
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    pick.svg,
  )}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = PICK_MAP_SIZE;
  canvas.height = PICK_MAP_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, PICK_MAP_SIZE, PICK_MAP_SIZE);
  const { data } = context.getImageData(0, 0, PICK_MAP_SIZE, PICK_MAP_SIZE);
  return {
    map: readIconPickMap(data, PICK_MAP_SIZE, PICK_MAP_SIZE, pick.colors),
    targets: pick.targets,
  };
};
