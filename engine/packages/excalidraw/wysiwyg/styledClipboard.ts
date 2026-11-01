import {
  getBulletMarkerForDepth,
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

/** The style a tag adds to the letters inside it. */
const styleOf = (element: Element): TextRunStyle => {
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
    default:
      return {};
  }
};

/**
 * The text and runs of pasted HTML: blocks are lines, a list item gets the
 * text box's marker, and a link keeps its words (a `[[link]]` is text, so it
 * is a pill again). Null when no letter has a style: the paste stays plain.
 */
export const parseStyledHtml = (
  html: string,
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
  const walk = (node: Node, style: TextRunStyle, depth: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? "").replace(/ /g, " ");
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
      text += "\n";
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
          walk(grandchild, inner, innerDepth);
        }
        continue;
      }
      first = false;
      walk(child, inner, innerDepth);
    }
    if (block) {
      newLine();
    }
  };
  for (const child of template.content.childNodes) {
    walk(child, {}, 0);
  }
  text = text.replace(/\n+$/, "");
  const textRuns = normalizeTextRuns(runs, text.length);
  return textRuns ? { text, textRuns } : null;
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
    html =
      style.highlight === "yellow"
        ? `<mark>${html}</mark>`
        : `<mark class="highlight-${style.highlight}">${html}</mark>`;
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
