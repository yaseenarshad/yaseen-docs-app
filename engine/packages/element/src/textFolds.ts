/**
 * YAZ-4277 D3: the switch point for the folds of a text box. This module is
 * the only code that reads or writes `foldedLines` and `foldedLineTexts`. The layout, the
 * renderers, the fold arrows, the keys, restore, the host editor and the
 * host's folding off (D18: `takeFoldsAside`, `withFoldsPutBack`) all ask it.
 * A later per-tab mode (YAZ-4297) changes only this module.
 *
 * `foldedLines` holds the indexes (in `originalText.split("\n")`) of the
 * folded list items. Absent or empty: no fold.
 *
 * YAZ-4434 (D31): `foldedLineTexts` holds the anchor of each fold, in the
 * same order: the folded item's text, trimmed, without its marker. Each fold
 * write saves it, and each text write keeps it in step (`withFoldAnchors`,
 * YAZ-4439). Restore uses it to find a fold's item after an outside edit
 * moved the lines (`restoreFolds`). A file with no anchors keeps the
 * line-number guard (`normalizeFoldedLines`).
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
 * is a fold that opens. No text is hidden by mistake and none is lost. With
 * anchors, restore never folds an item whose text is not the anchor.
 */
import { arrayToMap } from "@excalidraw/common";

import { updateBoundElements } from "./binding";
import { refreshTextDimensions } from "./newElement";
import { getContainerElement, redrawTextBoundingBox } from "./textElement";
import { parseTextListLine } from "./textList";
import { isTextElement } from "./typeChecks";

import type { Scene } from "./Scene";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeleted,
} from "./types";

/** A box as the readers need it; the layout passes its own text. */
type FoldedElement = Pick<ExcalidrawTextElement, "foldedLines"> &
  Partial<Pick<ExcalidrawTextElement, "originalText">>;

type FoldOutline = {
  /** The children of line `i` are the lines `i + 1` to `childrenEnd[i] - 1`. */
  childrenEnd: number[];
  foldable: boolean[];
  /** The anchor of each line: its item text, trimmed (YAZ-4434). */
  texts: string[];
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
  const texts = new Array<string>(lines.length);
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
    texts[index] = lines[index].content.trim();
  }
  const outline = { childrenEnd, foldable, texts };
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

/**
 * YAZ-4434 (D31): the anchor of each fold in `lines`: the item text of that
 * line of `text`, trimmed, without its marker.
 */
export const getFoldAnchors = (
  text: string,
  lines: readonly number[],
): string[] => {
  const { texts } = getFoldOutline(text);
  return lines.map((line) => texts[line] ?? "");
};

const sameStrings = (
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
) =>
  (a?.length ?? 0) === (b?.length ?? 0) &&
  (a ?? []).every((value, index) => value === b![index]);

/**
 * YAZ-4434 (D31): the anchors after an in-app edit of a box's text to
 * `nextText`, as an element update: empty when the box has no fold or its
 * anchors stay the same. The edit keeps the line numbers right (the editor
 * reports a fold that moved); this keeps each anchor equal to its line's
 * text, so a renamed folded bullet stays folded after a reload.
 */
export const getFoldAnchorsUpdate = (
  element: Pick<ExcalidrawTextElement, "foldedLines" | "foldedLineTexts">,
  nextText: string,
): Partial<Pick<ExcalidrawTextElement, "foldedLineTexts">> => {
  if (!element.foldedLines?.length) {
    return {};
  }
  const anchors = getFoldAnchors(nextText, element.foldedLines);
  return sameStrings(anchors, element.foldedLineTexts)
    ? {}
    : { foldedLineTexts: anchors };
};

/**
 * YAZ-4439 (D31): the switch point for each write of a box's text. Every path
 * writes `originalText` through `newElementWith` or `mutateElement`: the text
 * edit, Edit link, Remove link, a checklist tick, a list change. Both ask this.
 * An update that changes the text of a box with a fold, and sets no anchors
 * itself, gets the anchors of its folds in the new text. So the fold stays
 * after a reload. An update with no new text costs one check.
 */
export const withFoldAnchors = <T extends object>(
  element: ExcalidrawElement,
  updates: T,
): T => {
  const update = updates as Partial<ExcalidrawTextElement>;
  if (
    typeof update.originalText !== "string" ||
    !isTextElement(element) ||
    update.originalText === element.originalText ||
    "foldedLineTexts" in update
  ) {
    return updates;
  }
  const foldedLines =
    "foldedLines" in update ? update.foldedLines : element.foldedLines;
  if (!foldedLines?.length) {
    // the same write opens the last fold: its anchors go too
    return element.foldedLineTexts === undefined
      ? updates
      : { ...updates, foldedLineTexts: undefined };
  }
  const anchors = getFoldAnchorsUpdate(
    { foldedLines, foldedLineTexts: element.foldedLineTexts },
    update.originalText,
  );
  return "foldedLineTexts" in anchors ? { ...updates, ...anchors } : updates;
};

/**
 * YAZ-4434 (D31), the guard at restore (a load, an outside edit). With an
 * anchor for each fold, each fold:
 * - stays when its line is a list item with children and has its text;
 * - else moves to the list item with children and that text nearest to its
 *   line (the earlier line wins a tie; two folds never take one line);
 * - else opens.
 * An item whose text is not the anchor never folds. With no anchors (an
 * old file), or anchors of another length, the line-number guard applies
 * (`normalizeFoldedLines`) and no anchor is added. Undefined: no fold left.
 */
export const restoreFolds = (
  text: string,
  foldedLines: unknown,
  foldedLineTexts: unknown,
): { foldedLines: number[]; foldedLineTexts?: string[] } | undefined => {
  if (!Array.isArray(foldedLines) || !foldedLines.length) {
    return undefined;
  }
  if (
    !Array.isArray(foldedLineTexts) ||
    foldedLineTexts.length !== foldedLines.length ||
    !foldedLineTexts.every((anchor) => typeof anchor === "string")
  ) {
    const lines = normalizeFoldedLines(text, foldedLines);
    return lines && { foldedLines: lines };
  }
  const { foldable, texts } = getFoldOutline(text);
  const taken = new Set<number>();
  const moved: { from: number; anchor: string }[] = [];
  foldedLines.forEach((line: unknown, index) => {
    if (!Number.isInteger(line)) {
      return;
    }
    const from = line as number;
    const anchor = foldedLineTexts[index] as string;
    if (foldable[from] === true && texts[from] === anchor) {
      taken.add(from);
    } else {
      moved.push({ from, anchor });
    }
  });
  moved.sort((a, b) => a.from - b.from);
  for (const { from, anchor } of moved) {
    let nearest = -1;
    for (let line = 0; line < texts.length; line++) {
      if (
        foldable[line] &&
        texts[line] === anchor &&
        !taken.has(line) &&
        (nearest < 0 || Math.abs(line - from) < Math.abs(nearest - from))
      ) {
        nearest = line;
      }
    }
    if (nearest >= 0) {
      taken.add(nearest);
    }
  }
  if (!taken.size) {
    return undefined;
  }
  const lines = [...taken].sort((a, b) => a - b);
  return { foldedLines: lines, foldedLineTexts: getFoldAnchors(text, lines) };
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
 * Writes the folds of a box, each with its anchor (YAZ-4434): the box resizes
 * to its visible lines (D6) and its bound arrows follow. The caller commits
 * it as no undo step (`CaptureUpdateAction.NEVER`), which still saves the
 * board (D3). Returns false when the folds and their anchors did not change.
 */
export const setFoldedLines = (
  element: NonDeleted<ExcalidrawTextElement>,
  foldedLines: readonly number[],
  scene: Scene,
): boolean => {
  const next = normalizeFoldedLines(element.originalText, foldedLines);
  const anchors = next && getFoldAnchors(element.originalText, next);
  const current = getFoldedLines(element);
  if (
    (next?.length ?? 0) === current.length &&
    (next ?? []).every((line, index) => line === current[index]) &&
    (!next || sameStrings(anchors, element.foldedLineTexts))
  ) {
    return false;
  }
  scene.mutateElement(element, {
    foldedLines: next,
    foldedLineTexts: anchors,
  });
  redrawTextBoundingBox(
    element,
    getContainerElement(element, scene.getNonDeletedElementsMap()),
    scene,
  );
  updateBoundElements(element, scene);
  return true;
};

/**
 * YAZ-4277 D18, folding off: the folds a host keeps aside, by box id. Each
 * entry keeps the box's `originalText` too: the line numbers belong to that
 * text only. `lineTexts` are the folds' anchors (YAZ-4434), in that text.
 */
type FoldsAsideEntry = {
  text: string;
  lines: readonly number[];
  lineTexts: readonly string[];
};
export type FoldsAside = ReadonlyMap<string, Readonly<FoldsAsideEntry>>;

/** The folds of each live box in `elements`, to keep aside (folding off). */
export const getFoldsAside = (
  elements: readonly ExcalidrawElement[],
): FoldsAside => {
  const aside = new Map<string, FoldsAsideEntry>();
  for (const element of elements) {
    if (!isTextElement(element) || element.isDeleted) {
      continue;
    }
    const lines = getFoldedLines(element);
    if (lines.length) {
      aside.set(element.id, {
        text: element.originalText,
        lines,
        lineTexts: getFoldAnchors(element.originalText, lines),
      });
    }
  }
  return aside;
};

/**
 * Folding off at load (a board opens, or loads again from disk): `elements`
 * (restored) with no fold, and the folds they had. Each box that had a fold
 * is measured again to all its lines, so it shows every line. The input is
 * not changed.
 */
export const takeFoldsAside = (
  elements: readonly ExcalidrawElement[],
): { elements: ExcalidrawElement[]; aside: FoldsAside } => {
  const aside = getFoldsAside(elements);
  if (!aside.size) {
    return { elements: [...elements], aside };
  }
  const elementsMap = arrayToMap(elements);
  return {
    elements: elements.map((element) => {
      if (!isTextElement(element) || !aside.has(element.id)) {
        return element;
      }
      const open = { ...element } as ExcalidrawTextElement;
      delete (open as { foldedLines?: unknown }).foldedLines;
      delete (open as { foldedLineTexts?: unknown }).foldedLineTexts;
      return {
        ...open,
        ...refreshTextDimensions(
          open,
          getContainerElement(open, elementsMap),
          elementsMap,
        ),
      };
    }),
    aside,
  };
};

/**
 * The aside folds that can go back, by box id: only a live box whose text is
 * the same as when its folds went aside, and that has no folds of its own.
 * A box edited while folding was off loses its aside folds: the edit can
 * move its lines, and an old number could fold another bullet.
 */
export const getFoldsToPutBack = (
  elements: readonly ExcalidrawElement[],
  aside: FoldsAside,
): Map<string, readonly number[]> => {
  const back = new Map<string, readonly number[]>();
  if (!aside.size) {
    return back;
  }
  for (const element of elements) {
    const entry = aside.get(element.id);
    if (
      entry &&
      isTextElement(element) &&
      !element.isDeleted &&
      element.originalText === entry.text &&
      !element.foldedLines?.length
    ) {
      back.set(element.id, entry.lines);
    }
  }
  return back;
};

/**
 * `elements` for the file while folding is off: each box that can take its
 * aside folds back (`getFoldsToPutBack`) is saved with them and their
 * anchors. The size stays as the board shows it; a load with folding on
 * measures it again (D6).
 */
export const withFoldsPutBack = <T extends ExcalidrawElement>(
  elements: readonly T[],
  aside: FoldsAside,
): readonly T[] => {
  const back = getFoldsToPutBack(elements, aside);
  if (!back.size) {
    return elements;
  }
  return elements.map((element) => {
    const lines = back.get(element.id);
    return lines
      ? {
          ...element,
          foldedLines: lines,
          foldedLineTexts: aside.get(element.id)!.lineTexts,
        }
      : element;
  });
};
