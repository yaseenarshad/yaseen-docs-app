import { getLineWidth } from "./textMeasurements";

import type { FontString } from "./types";

/**
 * YAZ-4039 D7: `[[inner]]` in a text box is a page link. The text keeps the
 * raw `[[inner]]` (normal Excalidraw shows it as text). The layout makes it a
 * run of kind "link": one unit, drawn as a pill with the page's name.
 *
 * The host (the app) says what each link shows. With no host, a link stays
 * plain text, as in normal Excalidraw.
 */

/** What a link shows: the page's name, and whether its page is missing. */
export type HostLink = {
  label: string;
  /** The page is not there: a dim pill, as in a note. */
  missing?: boolean;
  /** The link opens a folder: the folder icon. */
  folder?: boolean;
};

/** The host's answer for `[[inner]]`, or null: the link stays plain text. */
export type HostLinkResolver = (inner: string) => HostLink | null;

/** A link of a line, with offsets from the line start. */
export type TextLinkMatch = HostLink & {
  start: number;
  end: number;
  inner: string;
};

/**
 * The resolvers of the mounted editors. The last one is in use. The app makes
 * one resolver for each vault, so the editors of one vault share it.
 */
const resolvers: HostLinkResolver[] = [];
let linksVersion = 0;

/** Adds a host resolver; returns its removal. */
export const registerHostLinkResolver = (resolver: HostLinkResolver) => {
  const previous = resolvers[resolvers.length - 1];
  resolvers.push(resolver);
  if (previous !== resolver) {
    linksVersion++;
  }
  return () => {
    const index = resolvers.lastIndexOf(resolver);
    if (index < 0) {
      return;
    }
    resolvers.splice(index, 1);
    if (resolvers[resolvers.length - 1] !== resolver) {
      linksVersion++;
    }
  };
};

/** The host's labels changed (a rename, the index loaded): layouts with links are stale. */
export const refreshHostLinks = () => {
  linksVersion++;
};

/** Part of the layout memo key: it moves when a label can have changed. */
export const getHostLinksVersion = () => linksVersion;

/** True when the text can hold a link pill: one string scan, no resolve. */
export const hasHostLinks = (text: string) =>
  resolvers.length > 0 && text.includes("[[");

// The app's wiki link shape (`shared/linkRewrite.ts` WIKILINK_RE): `![[x]]` is an embed.
const LINK_RE = /(!?)\[\[([^[\]]+)\]\]/g;

/** The links of one line that the host shows as pills. */
export const getTextLinks = (line: string): TextLinkMatch[] => {
  const resolve = resolvers[resolvers.length - 1];
  if (!resolve || !line.includes("[[")) {
    return [];
  }
  const links: TextLinkMatch[] = [];
  for (const match of line.matchAll(LINK_RE)) {
    if (match[1] === "!") {
      continue;
    }
    const link = resolve(match[2]);
    if (link && link.label) {
      const start = match.index!;
      links.push({
        ...link,
        start,
        end: start + match[0].length,
        inner: match[2],
      });
    }
  }
  return links;
};

const getFontSize = (font: FontString) =>
  Number(font.match(/([\d.]+)px/)?.[1] ?? 20);

/**
 * The pill's parts, in px of the font size: padding, the file icon and the gap
 * after it. As a note's pill: 4px padding and the icon before the name.
 */
export const getLinkPillMetrics = (font: FontString) => {
  const fontSize = getFontSize(font);
  return {
    padding: fontSize * 0.25,
    iconSize: fontSize * 0.75,
    gap: fontSize * 0.2,
    height: fontSize * 1.25,
    radius: fontSize * 0.25,
  };
};

/** The drawn width of a link pill: it counts in the line wrapping. */
export const getLinkPillWidth = (label: string, font: FontString) => {
  const { padding, iconSize, gap } = getLinkPillMetrics(font);
  return padding * 2 + iconSize + gap + getLineWidth(label, font);
};

/**
 * The file icon of a pill as a closed outline, in px from the icon box's top
 * left: a page with a folded corner, or a folder. The canvas and the SVG draw
 * the same points.
 */
export const getLinkPillIconOutline = (
  size: number,
  folder: boolean | undefined,
): [number, number][] => {
  const points: [number, number][] = folder
    ? [
        [0, 0.2],
        [0.38, 0.2],
        [0.48, 0.32],
        [1, 0.32],
        [1, 0.88],
        [0, 0.88],
      ]
    : [
        [0.12, 0.05],
        [0.6, 0.05],
        [0.88, 0.33],
        [0.88, 0.95],
        [0.12, 0.95],
      ];
  return points.map(([x, y]) => [x * size, y * size]);
};

/** The pill's colors, as the note's `--accent` and `--fg-muted`. */
export const getLinkPillColors = (dark: boolean, missing: boolean) => {
  const accent = dark ? "#7c8aff" : "#5b6cff";
  return missing
    ? { text: dark ? "#8f8f8f" : "#7a7a7a", background: null }
    : { text: accent, background: dark ? "#7c8aff26" : "#5b6cff1a" };
};
