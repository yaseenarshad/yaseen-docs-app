// -----------------------------------------------------------------------------
// Yaseen Docs (YAZ-4351 1A): icon colors
//
// An SVG picture's colors are read from the file itself (D2), so an icon from the
// Add panel, one already on a board and a dragged-in SVG all qualify. A color
// change paints a NEW small SVG and swaps the element's `fileId` (D1): every
// export, share link and preview shows the new colors with no extra work. The
// original stays inside the new file (`<metadata id="yaseen-icon-source">`), and
// every paint starts from it, never from a painted copy.
//
// The recipe lives on the element: `customData.yaseenIcon = { colors, parts?,
// outline }` (see `IconRecipe`). Parts count in the document order of the
// original's shapes (round 2, decision 1), so the numbers cannot drift.
//
// Pure string-and-DOM work (DOMParser), no canvas: it runs in jsdom tests.
// -----------------------------------------------------------------------------

import { MIME_TYPES, SVG_NS } from "@excalidraw/common";

import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";

import type { ExcalidrawImageElement, ImageCrop } from "./types";

export type IconKind = "one" | "many" | "photo";

export type IconOutline = {
  color: string;
  /** board pixels at the element's size when it was painted */
  width: number;
};

export type IconRecipe = {
  /** original color → new color, keyed by `normalizeIconColor` */
  colors: Record<string, string>;
  /** part key → color: `"3"` is part 3's fill, `"3:stroke"` its stroke. Wins over `colors`. */
  parts?: Record<string, string>;
  outline: IconOutline | null;
};

/** The largest original that gets colors (D2). */
export const ICON_MAX_BYTES = 256 * 1024;
/** The info cache keeps this many files (by file id). */
const ICON_INFO_CACHE_SIZE = 200;

export const ICON_SOURCE_ID = "yaseen-icon-source";
const OUTLINE_FILTER_ID = "yaseen-icon-outline";
/** An `<img>` sizes `1em` at the default font size. */
const EM_PX = 16;

/** The shapes that are parts (round 2, decision 1). */
export const ICON_SHAPE_TAGS = new Set([
  "path",
  "circle",
  "ellipse",
  "rect",
  "polygon",
  "polyline",
  "line",
]);
/** A shape inside one of these is not drawn by itself, so it is not a part. */
const NOT_DRAWN_TAGS = new Set(["defs", "clipPath", "mask"]);
/** The properties that hold a color the painter changes. */
const PAINT_PROPS = new Set([
  "fill",
  "stroke",
  "stop-color",
  "flood-color",
  "lighting-color",
  "color",
]);

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  aqua: "#00ffff",
  cyan: "#00ffff",
  teal: "#008080",
  navy: "#000080",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  gold: "#ffd700",
};

const hex2 = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");

/**
 * One key for one color: lowercase 6-digit hex, or `currentColor`. Null for
 * no color (`none`, `transparent`, a zero alpha), a reference (`url(…)`) and
 * anything it does not know.
 */
export const normalizeIconColor = (
  value: string | null | undefined,
): string | null => {
  if (!value) {
    return null;
  }
  const v = value
    .replace(/!important/i, "")
    .trim()
    .toLowerCase();
  if (!v || v === "none" || v === "transparent" || v.startsWith("url(")) {
    return null;
  }
  if (v === "currentcolor") {
    return "currentColor";
  }
  const hex = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) {
      digits = [...digits].map((d) => d + d).join("");
    }
    if (digits.length === 8 && digits.slice(6) === "00") {
      return null;
    }
    return `#${digits.slice(0, 6)}`;
  }
  const rgb = v.match(/^rgba?\(([^)]*)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) {
      return null;
    }
    const channel = (part: string) =>
      part.endsWith("%") ? (parseFloat(part) / 100) * 255 : parseFloat(part);
    const [r, g, b] = parts.slice(0, 3).map(channel);
    if ([r, g, b].some((c) => !Number.isFinite(c))) {
      return null;
    }
    if (parts[3] !== undefined && parseFloat(parts[3]) === 0) {
      return null;
    }
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  return NAMED_COLORS[v] ?? null;
};

// -----------------------------------------------------------------------------
// text ↔ data URL ↔ base64 (UTF-8 safe)
// -----------------------------------------------------------------------------

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const base64ToText = (base64: string) => {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
};

/** The SVG text of an SVG data URL (base64 or URL-encoded). */
export const svgOfDataURL = (dataURL: string) => {
  const comma = dataURL.indexOf(",");
  const head = dataURL.slice(0, comma);
  const body = dataURL.slice(comma + 1);
  return head.includes(";base64")
    ? base64ToText(body)
    : decodeURIComponent(body);
};

export const svgToDataURL = (svg: string) =>
  `data:${MIME_TYPES.svg};base64,${bytesToBase64(
    new TextEncoder().encode(svg),
  )}` as DataURL;

// -----------------------------------------------------------------------------
// parse
// -----------------------------------------------------------------------------

const parseSvg = (svgText: string) => {
  const doc = new DOMParser().parseFromString(svgText, MIME_TYPES.svg);
  const svg = doc.documentElement;
  if (
    doc.querySelector("parsererror") ||
    !svg ||
    svg.localName.toLowerCase() !== "svg"
  ) {
    return null;
  }
  return svg as unknown as SVGSVGElement;
};

const findSourceMetadata = (svg: Element) => {
  for (const child of Array.from(svg.children)) {
    if (
      child.localName === "metadata" &&
      child.getAttribute("id") === ICON_SOURCE_ID
    ) {
      return child;
    }
  }
  return null;
};

/** The original SVG inside a painted copy; the text itself when it is not one. */
export const iconSource = (svgText: string) => {
  if (!svgText.includes(ICON_SOURCE_ID)) {
    return svgText;
  }
  const svg = parseSvg(svgText);
  const metadata = svg && findSourceMetadata(svg);
  if (!metadata?.textContent) {
    return svgText;
  }
  try {
    return base64ToText(metadata.textContent);
  } catch {
    return svgText;
  }
};

/** Every element under `root`, in document order. */
const walk = (root: Element, visit: (element: Element) => void) => {
  for (const child of Array.from(root.children)) {
    visit(child);
    walk(child, visit);
  }
};

const isDrawn = (element: Element, root: Element) => {
  for (let node = element.parentElement; node && node !== root; ) {
    if (NOT_DRAWN_TAGS.has(node.localName)) {
      return false;
    }
    node = node.parentElement;
  }
  return true;
};

/** The parts: the shapes, in document order, outside `defs`, `clipPath` and `mask`. */
export const iconShapes = (svg: Element) => {
  const shapes: Element[] = [];
  walk(svg, (element) => {
    if (ICON_SHAPE_TAGS.has(element.localName) && isDrawn(element, svg)) {
      shapes.push(element);
    }
  });
  return shapes;
};

// -----------------------------------------------------------------------------
// the cascade: inline style > `<style>` rules (by specificity) > attribute
// -----------------------------------------------------------------------------

type Declaration = { prop: string; value: string; important: boolean };
type StyleRule = {
  selectors: { text: string; specificity: number }[];
  declarations: Declaration[];
  order: number;
};

const parseDeclarations = (text: string): Declaration[] =>
  text
    .split(";")
    .map((chunk) => {
      const colon = chunk.indexOf(":");
      if (colon < 0) {
        return null;
      }
      const prop = chunk.slice(0, colon).trim().toLowerCase();
      let value = chunk.slice(colon + 1).trim();
      const important = /!important\s*$/i.test(value);
      value = value.replace(/!important\s*$/i, "").trim();
      return prop && value ? { prop, value, important } : null;
    })
    .filter((d): d is Declaration => !!d);

/** ids, then classes, attributes and pseudo-classes, then tags — as one number. */
const specificityOf = (selector: string) => {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  const tags = (
    selector
      .replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, " ")
      .match(/[a-zA-Z][\w-]*/g) ?? []
  ).length;
  return ids * 10000 + classes * 100 + tags;
};

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const readStyleRules = (svg: Element): StyleRule[] => {
  const rules: StyleRule[] = [];
  walk(svg, (element) => {
    if (element.localName !== "style") {
      return;
    }
    const css = stripComments(element.textContent ?? "");
    for (const match of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const selectors = match[1]
        .split(",")
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({ text, specificity: specificityOf(text) }));
      rules.push({
        selectors,
        declarations: parseDeclarations(match[2]),
        order: rules.length,
      });
    }
  });
  return rules;
};

const safeMatches = (element: Element, selector: string) => {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
};

class Cascade {
  constructor(private rules: StyleRule[]) {}

  /** The value an element declares itself for `prop`, if any. */
  declared(element: Element, prop: string): string | undefined {
    let best: { rank: number; value: string } | undefined;
    const offer = (rank: number, value: string) => {
      if (!best || rank >= best.rank) {
        best = { rank, value };
      }
    };
    const attribute = element.getAttribute(prop);
    if (attribute !== null && attribute.trim()) {
      offer(0, attribute.trim());
    }
    for (const rule of this.rules) {
      const declaration = rule.declarations.find((d) => d.prop === prop);
      if (!declaration) {
        continue;
      }
      const matching = rule.selectors.filter((s) =>
        safeMatches(element, s.text),
      );
      if (!matching.length) {
        continue;
      }
      const specificity = Math.max(...matching.map((s) => s.specificity));
      offer(
        (declaration.important ? 4e9 : 1e9) + specificity * 1000 + rule.order,
        declaration.value,
      );
    }
    const inline = parseDeclarations(element.getAttribute("style") ?? "")
      .filter((d) => d.prop === prop)
      .pop();
    if (inline) {
      offer(inline.important ? 5e9 : 3e9, inline.value);
    }
    return best?.value;
  }

  /** The value `prop` gets on `element`, inherited from its ancestors up to `root`. */
  inherited(element: Element, prop: string, root: Element): string | undefined {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const value = this.declared(node, prop);
      if (value !== undefined && value.toLowerCase() !== "inherit") {
        return value;
      }
      if (node === root) {
        break;
      }
    }
    return undefined;
  }
}

// -----------------------------------------------------------------------------
// read
// -----------------------------------------------------------------------------

export type IconPaint =
  | { color: string }
  /** a gradient: the colors of its stops */
  | { gradient: Element; stops: { stop: Element; color: string }[] };

export type IconPart = {
  index: number;
  element: Element;
  fill: IconPaint | null;
  stroke: IconPaint | null;
  /** the fill is the SVG default (black): nothing declares one */
  defaultFill: boolean;
};

const findById = (svg: Element, id: string) => {
  let found: Element | null = null;
  walk(svg, (element) => {
    if (!found && element.getAttribute("id") === id) {
      found = element;
    }
  });
  return found as Element | null;
};

const gradientStops = (
  svg: Element,
  gradient: Element,
  depth = 0,
): Element[] => {
  const stops = Array.from(gradient.children).filter(
    (child) => child.localName === "stop",
  );
  if (stops.length || depth > 3) {
    return stops;
  }
  const href = (
    gradient.getAttribute("href") ??
    gradient.getAttribute("xlink:href") ??
    ""
  ).trim();
  const next = href.startsWith("#") ? findById(svg, href.slice(1)) : null;
  return next ? gradientStops(svg, next, depth + 1) : [];
};

type Reader = { svg: SVGSVGElement; cascade: Cascade };

const resolveColor = (
  { svg, cascade }: Reader,
  element: Element,
  raw: string,
) => {
  if (raw.trim().toLowerCase() === "currentcolor") {
    const color = cascade.inherited(element, "color", svg);
    const concrete = normalizeIconColor(color);
    return concrete && concrete !== "currentColor" ? concrete : "currentColor";
  }
  return normalizeIconColor(raw);
};

const readPaint = (
  reader: Reader,
  element: Element,
  prop: "fill" | "stroke",
): IconPaint | null => {
  const { svg, cascade } = reader;
  const raw =
    cascade.inherited(element, prop, svg) ??
    (prop === "fill" ? "#000" : "none");
  if (prop === "stroke") {
    const width = cascade.inherited(element, "stroke-width", svg);
    if (width !== undefined && parseFloat(width) === 0) {
      return null;
    }
  }
  const ref = raw.match(/url\(\s*["']?#([^"')\s]+)/);
  if (ref) {
    const gradient = findById(svg, ref[1]);
    if (!gradient) {
      return null;
    }
    const stops = gradientStops(svg, gradient).flatMap((stop) => {
      const value = cascade.inherited(stop, "stop-color", stop) ?? "#000";
      const color = resolveColor(reader, stop, value);
      return color ? [{ stop, color }] : [];
    });
    return stops.length ? { gradient, stops } : null;
  }
  const color = resolveColor(reader, element, raw);
  return color ? { color } : null;
};

const readParts = (reader: Reader): IconPart[] =>
  iconShapes(reader.svg).map((element, index) => ({
    index,
    element,
    fill: readPaint(reader, element, "fill"),
    stroke: readPaint(reader, element, "stroke"),
    defaultFill:
      reader.cascade.inherited(element, "fill", reader.svg) === undefined,
  }));

export const paintColors = (paint: IconPaint | null): string[] =>
  !paint
    ? []
    : "color" in paint
    ? [paint.color]
    : paint.stops.map((s) => s.color);

const makeReader = (svgText: string): Reader | null => {
  const svg = parseSvg(svgText);
  return svg ? { svg, cascade: new Cascade(readStyleRules(svg)) } : null;
};

/** The parts of an SVG (the original inside a painted copy), with their paints. */
export const readIconParts = (svgText: string) => {
  const reader = makeReader(iconSource(svgText));
  return reader ? { svg: reader.svg, parts: readParts(reader) } : null;
};

/** Each color of the original, most used first (D2: what the user sees, also inside `<style>` rules). */
export const readIconColors = (svgText: string): string[] => {
  const read = readIconParts(svgText);
  if (!read) {
    return [];
  }
  const counts = new Map<string, number>();
  for (const part of read.parts) {
    for (const color of [
      ...paintColors(part.fill),
      ...paintColors(part.stroke),
    ]) {
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);
};

// -----------------------------------------------------------------------------
// kind (with a cache by file id)
// -----------------------------------------------------------------------------

export type IconGeometry = {
  /** the original's natural size (numbers) and view box */
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  /** the painted file's outline, in SVG units (0: none) */
  outline: number;
};

export type IconInfo = {
  kind: IconKind;
  /** the original's colors, most used first */
  colors: string[];
  geometry: IconGeometry | null;
};

const PHOTO: IconInfo = { kind: "photo", colors: [], geometry: null };

const parseLength = (value: string | null) => {
  if (!value) {
    return null;
  }
  const match = value
    .trim()
    .match(/^([+-]?[\d.]+(?:e[+-]?\d+)?)\s*([a-z%]*)$/i);
  const number = match ? parseFloat(match[1]) : NaN;
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  const unit = match![2].toLowerCase();
  return unit === "em" ? number * EM_PX : unit === "%" ? null : number;
};

const readViewBox = (svg: Element): [number, number, number, number] | null => {
  const numbers = (svg.getAttribute("viewBox") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  return numbers.length === 4 &&
    numbers.every(Number.isFinite) &&
    numbers[2] > 0 &&
    numbers[3] > 0
    ? (numbers as [number, number, number, number])
    : null;
};

/** The original's natural size and view box (`normalizeSVG` gave it both). */
export const iconGeometryOf = (svg: Element, outline = 0): IconGeometry => {
  const width = parseLength(svg.getAttribute("width"));
  const height = parseLength(svg.getAttribute("height"));
  const viewBox = readViewBox(svg) ?? [0, 0, width ?? 50, height ?? 50];
  return {
    width: width ?? viewBox[2],
    height: height ?? viewBox[3],
    viewBox,
    outline,
  };
};

/** "one": only `currentColor`, or one color; "many": more; "photo": every other picture. */
export const iconKindOfColors = (colors: readonly string[]): IconKind =>
  colors.length === 0 ? "photo" : colors.length === 1 ? "one" : "many";

/** The kind, colors and geometry of an SVG's text (D2). */
export const readIconInfo = (svgText: string): IconInfo => {
  const source = iconSource(svgText);
  if (new TextEncoder().encode(source).length > ICON_MAX_BYTES) {
    return PHOTO;
  }
  const svg = parseSvg(source);
  if (!svg) {
    return PHOTO;
  }
  let hasPicture = false;
  walk(svg, (element) => {
    hasPicture ||= element.localName === "image";
  });
  if (hasPicture) {
    return PHOTO;
  }
  const colors = readIconColors(source);
  const kind = iconKindOfColors(colors);
  if (kind === "photo") {
    return PHOTO;
  }
  let outline = 0;
  if (source !== svgText) {
    const painted = parseSvg(svgText);
    outline =
      parseFloat(
        (painted &&
          findSourceMetadata(painted)?.getAttribute("data-outline")) ??
          "0",
      ) || 0;
  }
  return { kind, colors, geometry: iconGeometryOf(svg, outline) };
};

const infoCache = new Map<string, IconInfo>();

/**
 * The icon info of a file, cached by file id (at most 200). Any file that is not
 * an SVG of at most 256 KB, with a color and no `<image>`, is a "photo".
 */
export const getIconInfo = (
  file: Pick<BinaryFileData, "id" | "mimeType" | "dataURL"> | null | undefined,
): IconInfo => {
  if (!file || file.mimeType !== MIME_TYPES.svg) {
    return PHOTO;
  }
  const cached = infoCache.get(file.id);
  if (cached) {
    // most recently used last
    infoCache.delete(file.id);
    infoCache.set(file.id, cached);
    return cached;
  }
  let info = PHOTO;
  // a painted copy is the original in base64 plus a little: a bigger file cannot hold a qualifying one
  if (file.dataURL.length <= ICON_MAX_BYTES * 3) {
    try {
      info = readIconInfo(svgOfDataURL(file.dataURL));
    } catch {
      info = PHOTO;
    }
  }
  infoCache.set(file.id, info);
  if (infoCache.size > ICON_INFO_CACHE_SIZE) {
    infoCache.delete(infoCache.keys().next().value!);
  }
  return info;
};

export const iconKind = (
  file: Pick<BinaryFileData, "id" | "mimeType" | "dataURL"> | null | undefined,
) => getIconInfo(file).kind;

export const isRecolorableIcon = (
  file: Pick<BinaryFileData, "id" | "mimeType" | "dataURL"> | null | undefined,
) => iconKind(file) !== "photo";

/** The recipe on an element, if it has one. */
export const getIconRecipe = (element: {
  customData?: Record<string, any>;
}): IconRecipe | null => {
  const recipe = element.customData?.yaseenIcon;
  return recipe && typeof recipe === "object" && recipe.colors
    ? (recipe as IconRecipe)
    : null;
};

export const isEmptyIconRecipe = (recipe: IconRecipe | null) =>
  !recipe ||
  (!Object.keys(recipe.colors).length &&
    !Object.keys(recipe.parts ?? {}).length &&
    !(recipe.outline && recipe.outline.width > 0));

// -----------------------------------------------------------------------------
// paint
// -----------------------------------------------------------------------------

const replaceColorValue = (
  value: string,
  colors: Record<string, string>,
): string | null => {
  const key = normalizeIconColor(value);
  return key && colors[key] !== undefined ? colors[key] : null;
};

/** Changes the colors inside declarations; a value after `url(#` never changes. */
const rewriteDeclarations = (text: string, colors: Record<string, string>) =>
  text
    .split(";")
    .map((chunk) => {
      const colon = chunk.indexOf(":");
      if (colon < 0) {
        return chunk;
      }
      const prop = chunk.slice(0, colon).trim().toLowerCase();
      if (!PAINT_PROPS.has(prop)) {
        return chunk;
      }
      const rawValue = chunk.slice(colon + 1);
      const important = /!important\s*$/i.test(rawValue);
      const next = replaceColorValue(rawValue, colors);
      return next === null
        ? chunk
        : `${chunk.slice(0, colon + 1)}${next}${
            important ? " !important" : ""
          }`;
    })
    .join(";");

const appendStyle = (element: Element, prop: string, value: string) => {
  const style = (element.getAttribute("style") ?? "").trim();
  element.setAttribute(
    "style",
    `${style}${
      style && !style.endsWith(";") ? ";" : ""
    }${prop}:${value} !important`,
  );
};

const round = (value: number) => Math.round(value * 1000) / 1000;

const createSvgElement = (svg: Element, tag: string) =>
  svg.ownerDocument.createElementNS(SVG_NS, tag);

/** Every child of the root, in a new `<g>` (the outline filter and the pick map wrap the picture). */
const wrapChildren = (svg: Element, keep: (child: Element) => boolean) => {
  const g = createSvgElement(svg, "g");
  for (const child of Array.from(svg.childNodes)) {
    if (child.nodeType === 1 && keep(child as Element)) {
      continue;
    }
    g.appendChild(child);
  }
  svg.appendChild(g);
  return g;
};

/** The root's size and view box with an outline of `units` on each side. */
const setGeometry = (svg: Element, geometry: IconGeometry, units: number) => {
  const [x, y, w, h] = geometry.viewBox;
  svg.setAttribute(
    "viewBox",
    [x - units, y - units, w + units * 2, h + units * 2].map(round).join(" "),
  );
  svg.setAttribute("width", `${round((geometry.width * (w + units * 2)) / w)}`);
  svg.setAttribute(
    "height",
    `${round((geometry.height * (h + units * 2)) / h)}`,
  );
};

/** Applies `colors`, then `parts` (each pick starts from the original). */
const applyColors = (
  reader: Reader,
  parts: IconPart[],
  recipe: Pick<IconRecipe, "colors" | "parts">,
) => {
  const { svg } = reader;
  const colors = recipe.colors;
  if (Object.keys(colors).length) {
    // 1. every attribute and inline style that holds one of the colors
    const all: Element[] = [svg];
    walk(svg, (element) => all.push(element));
    for (const element of all) {
      for (const prop of PAINT_PROPS) {
        const value = element.getAttribute(prop);
        if (value !== null) {
          const next = replaceColorValue(value, colors);
          if (next !== null) {
            element.setAttribute(prop, next);
          }
        }
      }
      const style = element.getAttribute("style");
      if (style) {
        element.setAttribute("style", rewriteDeclarations(style, colors));
      }
      // 2. `<style>` rules (extra 22): only inside a rule's braces, so a selector never changes
      if (element.localName === "style" && element.textContent) {
        element.textContent = stripComments(element.textContent).replace(
          /\{([^{}]*)\}/g,
          (_, body: string) => `{${rewriteDeclarations(body, colors)}}`,
        );
      }
    }
    // 3. the SVG default: a shape that declares no fill is black
    if (colors["#000000"] !== undefined) {
      for (const part of parts) {
        if (part.defaultFill) {
          part.element.setAttribute("fill", colors["#000000"]);
        }
        if (part.fill && "stops" in part.fill) {
          for (const { stop } of part.fill.stops) {
            if (
              reader.cascade.inherited(stop, "stop-color", stop) === undefined
            ) {
              stop.setAttribute("stop-color", colors["#000000"]);
            }
          }
        }
      }
    }
  }
  for (const [key, color] of Object.entries(recipe.parts ?? {})) {
    const [index, which] = key.split(":");
    const part = parts[Number(index)];
    if (part) {
      appendStyle(part.element, which === "stroke" ? "stroke" : "fill", color);
    }
  }
};

const addOutline = (
  svg: Element,
  geometry: IconGeometry,
  units: number,
  color: string,
) => {
  const [x, y, w, h] = geometry.viewBox;
  const defs = createSvgElement(svg, "defs");
  const filter = createSvgElement(svg, "filter");
  filter.setAttribute("id", OUTLINE_FILTER_ID);
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("x", `${round(x - units)}`);
  filter.setAttribute("y", `${round(y - units)}`);
  filter.setAttribute("width", `${round(w + units * 2)}`);
  filter.setAttribute("height", `${round(h + units * 2)}`);
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const morphology = createSvgElement(svg, "feMorphology");
  morphology.setAttribute("in", "SourceAlpha");
  morphology.setAttribute("operator", "dilate");
  morphology.setAttribute("radius", `${round(units)}`);
  morphology.setAttribute("result", "grown");
  const flood = createSvgElement(svg, "feFlood");
  flood.setAttribute("flood-color", color);
  flood.setAttribute("result", "paint");
  const composite = createSvgElement(svg, "feComposite");
  composite.setAttribute("in", "paint");
  composite.setAttribute("in2", "grown");
  composite.setAttribute("operator", "in");
  composite.setAttribute("result", "ring");
  const merge = createSvgElement(svg, "feMerge");
  for (const input of ["ring", "SourceGraphic"]) {
    const node = createSvgElement(svg, "feMergeNode");
    node.setAttribute("in", input);
    merge.appendChild(node);
  }
  filter.append(morphology, flood, composite, merge);
  defs.appendChild(filter);
  const g = wrapChildren(svg, () => false);
  g.setAttribute("filter", `url(#${OUTLINE_FILTER_ID})`);
  svg.insertBefore(defs, g);
};

/**
 * The painted SVG: the original (taken out of `svgText` when it is a painted
 * copy) in the recipe's colors, with an outline of `outlineUnits` SVG units
 * behind it (a `feMorphology` dilate), and the original inside it.
 */
export const paintIcon = (
  svgText: string,
  recipe: IconRecipe,
  outlineUnits = 0,
): string => {
  const source = iconSource(svgText);
  const reader = makeReader(source);
  if (!reader) {
    throw new Error("Invalid SVG");
  }
  const { svg } = reader;
  const geometry = iconGeometryOf(svg);
  const parts = readParts(reader);
  applyColors(reader, parts, recipe);
  const units =
    recipe.outline && recipe.outline.width > 0 && outlineUnits > 0
      ? outlineUnits
      : 0;
  if (units) {
    addOutline(svg, geometry, units, recipe.outline!.color);
  }
  setGeometry(svg, geometry, units);
  if (!svg.getAttribute("xmlns")) {
    svg.setAttribute("xmlns", SVG_NS);
  }
  const metadata = createSvgElement(svg, "metadata");
  metadata.setAttribute("id", ICON_SOURCE_ID);
  metadata.setAttribute("data-outline", `${round(units)}`);
  metadata.textContent = bytesToBase64(new TextEncoder().encode(source));
  svg.insertBefore(metadata, svg.firstChild);
  return svg.outerHTML;
};

// -----------------------------------------------------------------------------
// the element: its file, its box and its crop
// -----------------------------------------------------------------------------

export type IconPaintResult = {
  /** the new file's SVG; the original itself when the recipe is empty */
  svg: string;
  /** the element's new box, crop and recipe */
  updates: {
    x: number;
    y: number;
    width: number;
    height: number;
    crop: ImageCrop | null;
    customData: Record<string, any> | undefined;
  };
};

/** Board pixels per SVG unit of the original, at the element's size. */
const boardPixelsPerUnit = (
  element: Pick<ExcalidrawImageElement, "width" | "height" | "crop">,
  geometry: IconGeometry,
) => {
  const [, , w, h] = geometry.viewBox;
  const r = geometry.outline;
  const naturalPerUnitX = geometry.width / w;
  const naturalPerUnitY = geometry.height / h;
  const naturalWidth = naturalPerUnitX * (w + r * 2);
  const naturalHeight = naturalPerUnitY * (h + r * 2);
  const boardPerNaturalX =
    element.width / (element.crop ? element.crop.width : naturalWidth);
  const boardPerNaturalY =
    element.height / (element.crop ? element.crop.height : naturalHeight);
  return {
    x: boardPerNaturalX * naturalPerUnitX,
    y: boardPerNaturalY * naturalPerUnitY,
    naturalPerUnitX,
    naturalPerUnitY,
  };
};

/** The outline width an element shows now, in board pixels (it scales with a resize). */
export const iconOutlineWidth = (
  element: Pick<ExcalidrawImageElement, "width" | "height" | "crop">,
  info: IconInfo,
) =>
  info.geometry && info.geometry.outline > 0
    ? round(
        info.geometry.outline * boardPixelsPerUnit(element, info.geometry).x,
      )
    : 0;

/**
 * Paints an icon element with a recipe. The outline grows the box on each side,
 * so the icon does not shrink (extra 23); removing it shrinks the box back. A
 * cropped icon keeps its box: the crop moves with the outline instead.
 */
export const paintIconElement = (
  element: Pick<
    ExcalidrawImageElement,
    "x" | "y" | "width" | "height" | "crop" | "customData"
  >,
  svgText: string,
  recipe: IconRecipe,
): IconPaintResult => {
  const info = readIconInfo(svgText);
  if (info.kind === "photo" || !info.geometry) {
    throw new Error("Not an icon");
  }
  const geometry = info.geometry;
  const scale = boardPixelsPerUnit(element, geometry);
  const nextWidth = recipe.outline?.width ?? 0;
  const nextUnits = nextWidth > 0 ? nextWidth / scale.x : 0;
  const delta = nextUnits - geometry.outline;

  const empty = isEmptyIconRecipe(recipe);
  const { yaseenIcon: _old, ...otherData } = element.customData ?? {};
  const savedRecipe: IconRecipe = {
    colors: { ...recipe.colors },
    ...(recipe.parts && Object.keys(recipe.parts).length
      ? { parts: { ...recipe.parts } }
      : null),
    outline:
      recipe.outline && nextWidth > 0
        ? { color: recipe.outline.color, width: round(nextWidth) }
        : null,
  };
  const customData = empty
    ? Object.keys(otherData).length
      ? otherData
      : undefined
    : { ...otherData, yaseenIcon: savedRecipe };

  const [, , w, h] = geometry.viewBox;
  let { x, y, width, height } = element;
  let crop = element.crop;
  if (crop) {
    crop = {
      ...crop,
      x: crop.x + delta * scale.naturalPerUnitX,
      y: crop.y + delta * scale.naturalPerUnitY,
      naturalWidth: scale.naturalPerUnitX * (w + nextUnits * 2),
      naturalHeight: scale.naturalPerUnitY * (h + nextUnits * 2),
    };
  } else {
    x -= delta * scale.x;
    y -= delta * scale.y;
    width += delta * scale.x * 2;
    height += delta * scale.y * 2;
  }
  return {
    svg: empty
      ? iconSource(svgText)
      : paintIcon(svgText, savedRecipe, nextUnits),
    updates: { x, y, width, height, crop, customData },
  };
};
