import {
  getAllFoldedLines,
  getFoldableLines,
  getFoldedLines,
  getHiddenLines,
  getToggledFoldedLines,
  normalizeFoldedLines,
} from "../src/textFolds";
import { getTextElementStyledLayout } from "../src/textLineUnderlines";

import type { ExcalidrawTextElement } from "../src/types";

// YAZ-4277: the real box from Yaseen's board
const MOAT =
  "Our main Moat:\n• 1) Automated Pipeline\n    ○ \n• 2) Editing (Power User)\n• 3) Schedule / Posting\n• 4) Server / Rendering Scaling";

const LEVELS = [
  "• a", //            0: children 1-4
  "    ○ a1", //       1: children 2-3
  "        ▪ a1x", //  2
  "        ▪ a1y", //  3
  "    ○ a2", //       4: no child
  "• b", //            5: no child
  "plain", //          6
  "    indented", //   7: a plain line is no list item
].join("\n");

const box = (originalText: string, foldedLines?: number[]) =>
  ({ originalText, foldedLines } as Pick<
    ExcalidrawTextElement,
    "originalText" | "foldedLines"
  >);

describe("text folds: the switch point (YAZ-4277 D3)", () => {
  it("a list item with deeper lines after it can fold", () => {
    expect(getFoldableLines(MOAT)).toEqual([1]);
    expect(getFoldableLines(LEVELS)).toEqual([0, 1]);
  });

  it("checklist items fold like bullets; numbered and plain lines do not", () => {
    expect(
      getFoldableLines("☐ task\n    ☑ sub\n1. n\n    ○ x\nplain\n    y"),
    ).toEqual([0]);
  });

  it("a fold hides the children, up to the next line at the same or a lower level", () => {
    expect([...getHiddenLines(box(MOAT, [1]))!]).toEqual([2]);
    expect([...getHiddenLines(box(LEVELS, [0]))!]).toEqual([1, 2, 3, 4]);
    expect([...getHiddenLines(box(LEVELS, [1]))!]).toEqual([2, 3]);
    expect(getHiddenLines(box(LEVELS))).toBeNull();
  });

  it("a fold that points to no list item with children hides nothing", () => {
    expect(getFoldedLines(box(LEVELS, [0, 4, 6, 99]))).toEqual([0]);
    expect(getHiddenLines(box(LEVELS, [5, 6]))).toBeNull();
  });

  it("restore keeps valid folds sorted and once, and drops stale ones", () => {
    expect(normalizeFoldedLines(LEVELS, [1, 0, 1, 4, -1, 2.5, "0"])).toEqual([
      0, 1,
    ]);
    expect(normalizeFoldedLines(LEVELS, [5])).toBeUndefined();
    expect(normalizeFoldedLines(LEVELS, [])).toBeUndefined();
    expect(normalizeFoldedLines(LEVELS, "0")).toBeUndefined();
  });

  it("an outside edit that adds a line above a fold drops it; no text is hidden", () => {
    const edited = `New first line\n${MOAT}`;
    expect(normalizeFoldedLines(edited, [1])).toBeUndefined();
    expect(getHiddenLines(box(edited, [1]))).toBeNull();
  });

  it("toggle, fold all and unfold all", () => {
    expect(getToggledFoldedLines(box(LEVELS), 1)).toEqual([1]);
    expect(getToggledFoldedLines(box(LEVELS, [0, 1]), 0)).toEqual([1]);
    expect(getAllFoldedLines(box(LEVELS))).toEqual([0, 1]);
  });

  it("the layout skips the hidden lines; the box text keeps all of them", () => {
    const element = {
      id: "moat",
      originalText: MOAT,
      fontFamily: 10,
      fontSize: 20,
      lineHeight: 1.25,
      foldedLines: [1],
    } as unknown as ExcalidrawTextElement;
    const folded = getTextElementStyledLayout(element, Infinity);
    const open = getTextElementStyledLayout(
      { ...element, foldedLines: undefined },
      Infinity,
    );
    expect(open.lines).toHaveLength(6);
    expect(folded.lines.map((line) => line.logicalLine)).toEqual([
      0, 1, 3, 4, 5,
    ]);
    expect(folded.height).toBe(open.height - 25);
    expect(folded.text).toBe(open.text);
    // the offsets still point into the whole text
    expect(folded.lines[2].start).toBe(MOAT.indexOf("• 2)"));
  });
});
