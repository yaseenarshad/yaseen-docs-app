/**
 * YAZ-4277 D3: the switch point for the folds of a text box. This module is
 * the only code that reads or writes `foldedLines`. The layout, the
 * renderers, the fold arrows, the keys, restore and the host editor all ask
 * it. A later per-tab mode (YAZ-4297) changes only this module.
 *
 * `foldedLines` holds the indexes (in `originalText.split("\n")`) of the
 * folded list items. Absent or empty: no fold.
 *
 * A list item is a line with a bullet marker (`•`, `○`, `▪`) or a checklist
 * marker (`☐`, `☑`), as `parseTextListLine` reads it. A numbered line is not
 * a list item here.
 *
 * The children of a list item are the lines after it with a deeper level (4
 * spaces per level), up to the next line at the same or a lower level. Any
 * line counts: a plain line, an empty bullet (`    ○ `) or a line of only
 * spaces. A list item with no children cannot fold.
 *
 * A fold hides the children of its item. A fold that does not point to a
 * list item with children hides nothing: after an outside edit the worst case
 * is a fold that opens. No text is hidden by mistake and none is lost.
 */
import { updateBoundElements } from "./binding";
import { getContainerElement, redrawTextBoundingBox } from "./textElement";
import { parseTextListLine } from "./textList";

import type { Scene } from "./Scene";
import type { ExcalidrawTextElement, NonDeleted } from "./types";

/** A box as the readers need it; the layout passes its own text. */
type FoldedElement = Pick<ExcalidrawTextElement, "foldedLines"> &
  Partial<Pick<ExcalidrawTextElement, "originalText">>;

type FoldOutline = {
  /** The children of line `i` are the lines `i + 1` to `childrenEnd[i] - 1`. */
  childrenEnd: number[];
  foldable: boolean[];
};

const FOLDABLE_MARKER_KINDS = new Set(["bullet", "check"]);

/**
 * The outline of a text, kept for its last text only: the arrows, the layout
 * and a hover ask for the same text many times in a row.
 */
let lastOutline: { text: string; outline: FoldOutline } | null = null;

const getFoldOutline = (text: string): FoldOutline => {
  if (lastOutline?.text === text) {
    return lastOutline.outline;
  }
  const lines = text.split("\n").map(parseTextListLine);
  const childrenEnd = new Array<number>(lines.length);
  const foldable = new Array<boolean>(lines.length);
  // one pass from the end: a line's children end where the first later
  // line at its level or lower starts
  const open: number[] = [];
  for (let index = lines.length - 1; index >= 0; index--) {
    const depth = lines[index].depth;
    while (open.length && lines[open[open.length - 1]].depth > depth) {
      open.pop();
    }
    childrenEnd[index] = open.length ? open[open.length - 1] : lines.length;
    open.push(index);
    foldable[index] =
      FOLDABLE_MARKER_KINDS.has(lines[index].markerKind) &&
      childrenEnd[index] > index + 1;
  }
  const outline = { childrenEnd, foldable };
  lastOutline = { text, outline };
  return outline;
};

/** The lines of `text` that can fold: list items with children. */
export const getFoldableLines = (text: string): number[] => {
  const { foldable } = getFoldOutline(text);
  const lines: number[] = [];
  for (let index = 0; index < foldable.length; index++) {
    if (foldable[index]) {
      lines.push(index);
    }
  }
  return lines;
};

/** True when line `line` of `text` is a list item with children. */
export const isFoldableLine = (text: string, line: number) =>
  getFoldOutline(text).foldable[line] === true;

/**
 * The folds of a box, sorted, each a list item with children in `text`
 * (default: the box's own text). The renderers and the editor read this.
 */
export const getFoldedLines = (
  element: FoldedElement,
  text = element.originalText ?? "",
): readonly number[] => {
  const folded = element.foldedLines;
  if (!folded?.length) {
    return [];
  }
  const { foldable } = getFoldOutline(text);
  return folded.every((line) => foldable[line] === true)
    ? folded
    : folded.filter((line) => foldable[line] === true);
};

/** True when line `line` is folded. */
export const isLineFolded = (
  element: Pick<ExcalidrawTextElement, "foldedLines" | "originalText">,
  line: number,
) => getFoldedLines(element).includes(line);

/**
 * The lines a box's folds hide in `text`, or null when it hides none. Only a
 * box with a fold pays for the outline.
 */
export const getHiddenLines = (
  element: FoldedElement,
  text = element.originalText ?? "",
): ReadonlySet<number> | null => {
  const folded = getFoldedLines(element, text);
  if (!folded.length) {
    return null;
  }
  const { childrenEnd } = getFoldOutline(text);
  const hidden = new Set<number>();
  for (const line of folded) {
    for (let child = line + 1; child < childrenEnd[line]; child++) {
      hidden.add(child);
    }
  }
  return hidden;
};

/**
 * The stale-fold guard (restore, an outside edit): sorted, no repeats, and
 * only list items with children in `text`. Undefined when no fold is left.
 */
export const normalizeFoldedLines = (
  text: string,
  foldedLines: unknown,
): number[] | undefined => {
  if (!Array.isArray(foldedLines) || !foldedLines.length) {
    return undefined;
  }
  const { foldable } = getFoldOutline(text);
  const lines = [...new Set(foldedLines)]
    .filter(
      (line): line is number =>
        Number.isInteger(line) && foldable[line as number] === true,
    )
    .sort((a, b) => a - b);
  return lines.length ? lines : undefined;
};

/** The folds after a fold or an unfold of line `line`. */
export const getToggledFoldedLines = (
  element: Pick<ExcalidrawTextElement, "foldedLines" | "originalText">,
  line: number,
) => {
  const folded = getFoldedLines(element);
  return folded.includes(line)
    ? folded.filter((other) => other !== line)
    : [...folded, line];
};

/** Fold all: every list item with children. */
export const getAllFoldedLines = (
  element: Pick<ExcalidrawTextElement, "originalText">,
) => getFoldableLines(element.originalText);

/**
 * Writes the folds of a box: the box resizes to its visible lines (D6) and
 * its bound arrows follow. The caller commits it as no undo step
 * (`CaptureUpdateAction.NEVER`), which still saves the board (D3).
 * Returns false when the folds did not change.
 */
export const setFoldedLines = (
  element: NonDeleted<ExcalidrawTextElement>,
  foldedLines: readonly number[],
  scene: Scene,
): boolean => {
  const next = normalizeFoldedLines(element.originalText, foldedLines);
  const current = getFoldedLines(element);
  if (
    (next?.length ?? 0) === current.length &&
    (next ?? []).every((line, index) => line === current[index])
  ) {
    return false;
  }
  scene.mutateElement(element, { foldedLines: next });
  redrawTextBoundingBox(
    element,
    getContainerElement(element, scene.getNonDeletedElementsMap()),
    scene,
  );
  updateBoundElements(element, scene);
  return true;
};
