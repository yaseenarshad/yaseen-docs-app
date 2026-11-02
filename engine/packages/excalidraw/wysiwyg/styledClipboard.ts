import {
  getBulletMarkerForDepth,
  getNearestNoteHighlight,
  normalizeTextRuns,
  TEXT_HIGHLIGHT_FILLS,
  TEXT_LIST_INDENT,
} from "@excalidraw/element";

import type { TextRunStyle } from "@excalidraw/element";
import type { ExcalidrawTextRun } from "@excalidraw/element/types";

/**
 * YAZ-4103 3F: copy and paste keep the letter styles between a note and a
 * text box. A note copies HTML (ProseMirror's marks: `strong`, `em`, `u`,
 * `del`, `mark`, and its `[[links]]` as written); the text box reads it into
 * runs, and writes the same HTML for its own letters. Text color has no note
 * mark: it stays out of the HTML.
 */

const BLOCKS = new Set([
  "P",
  "DIV",
  "LI",
  "UL",
  "OL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "TR",
  "TABLE",
]);

const SKIPPED = new Set(["STYLE", "SCRIPT", "META", "TITLE", "HEAD"]);

/** The note's highlight name of a `mark`: its `highlight-<name>` class, else yellow. */
const highlightOf = (element: Element) => {
  const name = /(?:^|\s)highlight-(\w+)/.exec(element.className)?.[1];
  return name && Object.hasOwn(TEXT_HIGHLIGHT_FILLS, name) ? name : "yellow";
};

/**
 * YAZ-3943 demo 2: the style an element's inline CSS gives (Google Docs
 * writes `<span style="font-weight:700">`); colors and fonts are dropped.
 */
const cssStyleOf = (element: Element): TextRunStyle => {
  const css = element.getAttribute("style") ?? "";
  const decoration = /text-decoration[^:;]*:([^;]*)/.exec(css)?.[1] ?? "";
  return {
    ...(/font-weight:\s*(bold|[6-9]00)/.test(css) ? { bold: true } : {}),
    ...(/font-style:\s*italic/.test(css) ? { italic: true } : {}),
    ...(decoration.includes("underline") ? { underline: true } : {}),
    ...(decoration.includes("line-through") ? { strikethrough: true } : {}),
  };
};

/** The style a tag, and its inline CSS, add to the letters inside it. */
const styleOf = (element: Element): TextRunStyle => ({
  ...tagStyleOf(element),
  ...cssStyleOf(element),
});

const tagStyleOf = (element: Element): TextRunStyle => {
  switch (element.tagName) {
    case "STRONG":
      return { bold: true };
    case "B":
      // Google Docs wraps a whole copy in `<b style="font-weight:normal">`
      return /font-weight:\s*(normal|400)/.test(
        element.getAttribute("style") ?? "",
      )
        ? {}
        : { bold: true };
    case "EM":
    case "I":
      return { italic: true };
    case "U":
      return { underline: true };
    case "S":
    case "DEL":
    case "STRIKE":
      return { strikethrough: true };
    case "MARK":
      return { highlight: highlightOf(element) };
    // YAZ-3943 demo 2: a heading is bold text
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return { bold: true };
    default:
      return {};
  }
};

/**
 * The text and runs of pasted HTML: blocks are lines, a list item gets the
 * text box's marker, a heading is bold, and a link keeps its words (a
 * `[[link]]` is text, so it is a pill again). At most one blank line in a
 * row. Null when no letter has a style: the paste stays plain.
 *
 * YAZ-3943 demo 2 (a paste on the board): `keepPlain` gives the text with no
 * style too, and `linkOf` turns a link's address into the board's `[[link]]`
 * (a vault page), in place of its words.
 */
export const parseStyledHtml = (
  html: string,
  options?: {
    keepPlain?: boolean;
    linkOf?: (href: string) => string | null | undefined;
  },
): { text: string; textRuns: readonly ExcalidrawTextRun[] } | null => {
  const template = document.createElement("template");
  template.innerHTML = html;
  let text = "";
  const runs: ExcalidrawTextRun[] = [];
  const newLine = () => {
    if (text && !text.endsWith("\n")) {
      text += "\n";
    }
  };
  const walk = (
    node: Node,
    style: TextRunStyle,
    depth: number,
    pre = false,
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      let value = (node.textContent ?? "").replace(/ /g, " ");
      // HTML's white space is one space, except in a code block
      if (!pre) {
        value = value.replace(/[\t\n\r ]+/g, " ");
        if (!text || text.endsWith("\n")) {
          value = value.replace(/^ /, "");
        }
      }
      // the white space between blocks is no text
      if (!value.trim() && (!text || text.endsWith("\n"))) {
        return;
      }
      if (Object.keys(style).length) {
        runs.push({
          start: text.length,
          end: text.length + value.length,
          ...style,
        });
      }
      text += value;
      return;
    }
    if (!(node instanceof Element) || SKIPPED.has(node.tagName)) {
      return;
    }
    if (node.tagName === "BR") {
      // at most one blank line in a row
      if (text && !text.endsWith("\n\n")) {
        text += "\n";
      }
      return;
    }
    const link =
      node.tagName === "A" && options?.linkOf
        ? options.linkOf(node.getAttribute("href") ?? "")
        : null;
    if (link) {
      text += link;
      return;
    }
    const block = BLOCKS.has(node.tagName);
    if (block) {
      newLine();
    }
    if (node.tagName === "LI") {
      const list = node.parentElement;
      const marker =
        list?.tagName === "OL"
          ? `${
              Number(list.getAttribute("start") ?? 1) +
              [...list.children].indexOf(node)
            }.`
          : getBulletMarkerForDepth(depth);
      text += `${TEXT_LIST_INDENT.repeat(depth)}${marker} `;
    }
    const inner = { ...style, ...styleOf(node) };
    // a list inside an item is one step in
    const innerDepth = node.tagName === "LI" ? depth + 1 : depth;
    // the first block of a list item is on the marker's line
    let first = node.tagName === "LI";
    for (const child of node.childNodes) {
      if (first && child instanceof Element && child.tagName === "P") {
        first = false;
        for (const grandchild of child.childNodes) {
          walk(grandchild, inner, innerDepth, pre);
        }
        continue;
      }
      first = false;
      walk(child, inner, innerDepth, pre || node.tagName === "PRE");
    }
    if (block) {
      newLine();
    }
  };
  for (const child of template.content.childNodes) {
    walk(child, {}, 0);
  }
  text = text.replace(/\s+$/, "");
  const textRuns = normalizeTextRuns(runs, text.length);
  return textRuns
    ? { text, textRuns }
    : options?.keepPlain && text
    ? { text, textRuns: [] }
    : null;
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]!),
  );

/** One piece of a line in the note's tags, outermost first; no color. */
const wrap = (value: string, style: TextRunStyle) => {
  let html = escapeHtml(value);
  if (style.highlight) {
    // a custom highlight (YAZ-3943 demo 2) is the nearest of the note's four
    const note = getNearestNoteHighlight(style.highlight);
    html =
      note === "yellow"
        ? `<mark>${html}</mark>`
        : `<mark class="highlight-${note}">${html}</mark>`;
  }
  if (style.strikethrough) {
    html = `<del>${html}</del>`;
  }
  if (style.underline) {
    html = `<u>${html}</u>`;
  }
  if (style.italic) {
    html = `<em>${html}</em>`;
  }
  if (style.bold) {
    html = `<strong>${html}</strong>`;
  }
  return html;
};

/**
 * The letters `start` to `end` of a text box as the HTML a note pastes: one
 * paragraph for each line, the note's tag for each style, links as written.
 * Null when none of the letters has a style other than color: the copy stays
 * plain text.
 */
export const getStyledHtml = (
  text: string,
  runs: readonly ExcalidrawTextRun[] | undefined,
  start: number,
  end: number,
) => {
  const styled = (runs ?? []).filter(
    (run) =>
      run.start < end &&
      run.end > start &&
      (run.bold ||
        run.italic ||
        run.underline ||
        run.strikethrough ||
        run.highlight),
  );
  if (!styled.length) {
    return null;
  }
  const cuts = [
    ...new Set([
      start,
      end,
      ...styled.flatMap((run) => [run.start, run.end]),
      ...[...text.slice(start, end).matchAll(/\n/g)].flatMap((match) => [
        start + match.index!,
        start + match.index! + 1,
      ]),
    ]),
  ]
    .filter((offset) => offset >= start && offset <= end)
    .sort((a, b) => a - b);
  const lines: string[] = [""];
  for (let index = 0; index < cuts.length - 1; index++) {
    const piece = text.slice(cuts[index], cuts[index + 1]);
    if (piece === "\n") {
      lines.push("");
      continue;
    }
    const run = styled.find(
      (run) => run.start <= cuts[index] && cuts[index] < run.end,
    );
    lines[lines.length - 1] += wrap(piece, run ?? {});
  }
  return lines.map((line) => `<p>${line}</p>`).join("");
};

/**
 * YAZ-3943 demo 2: plain pasted text for ONE text box: at most one blank line
 * in a row, and `-`, `*` or `+` list lines as the box's bullets, with their
 * indent (the smallest indent is one step).
 */
export const getPlainPasteText = (text: string) => {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split("\n");
  const bullet = /^([ \t]*)[-*+][ \t]+/;
  const width = (indent: string) => indent.replace(/\t/g, "    ").length;
  const indents = lines
    .map((line) => bullet.exec(line)?.[1])
    .filter((indent): indent is string => !!indent)
    .map(width);
  const step = indents.length ? Math.min(...indents) : 4;
  return lines
    .map((line) =>
      line.replace(bullet, (_, indent: string) => {
        const depth = Math.floor(width(indent) / step);
        return `${TEXT_LIST_INDENT.repeat(depth)}${getBulletMarkerForDepth(
          depth,
        )} `;
      }),
    )
    .join("\n");
};
