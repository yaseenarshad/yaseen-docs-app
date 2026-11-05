import { newTextElement } from "../src/newElement";
import {
  getAllFoldedLines,
  getFoldableLines,
  getFoldedLines,
  getFoldsAside,
  getFoldsToPutBack,
  getHiddenLines,
  getToggledFoldedLines,
  normalizeFoldedLines,
  takeFoldsAside,
  withFoldsPutBack,
} from "../src/textFolds";
import { getTextElementStyledLayout } from "../src/textLineUnderlines";
import {
  DEFAULT_FOLD_ARROW_PREFS,
  getFoldArrowSize,
} from "../src/textFoldArrows";

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

describe("fold arrow size (YAZ-4277 D7)", () => {
  const text = { fontSize: 29 };
  const prefs = { ...DEFAULT_FOLD_ARROW_PREFS, size: 150, minScreenSize: 14 };

  it("on screen: max(size × text size × zoom, smallest), in scene units", () => {
    // 29 × 150% = 43.5; at zoom 1 that is 43.5 px on screen
    expect(getFoldArrowSize(text, prefs, 1)).toBe(43.5);
    expect(getFoldArrowSize(text, prefs, 4) * 4).toBe(174);
    // at 25%, 43.5 × 0.25 = 10.9 px < 14 px: it stays 14 px on screen
    expect(getFoldArrowSize(text, prefs, 0.25) * 0.25).toBe(14);
  });

  it("an export uses the size row alone", () => {
    expect(getFoldArrowSize(text, prefs)).toBe(43.5);
    expect(getFoldArrowSize(text, { ...prefs, minScreenSize: 48 })).toBe(43.5);
  });
});

describe("folding off: the folds kept aside (YAZ-4277 D18, YAZ-4312 S1, M2)", () => {
  const OUTLINE = "• Phase one\n    ○ child\n• Two";
  const textBox = (id: string, text = OUTLINE, foldedLines?: number[]) => {
    const element = { ...newTextElement({ x: 0, y: 0, text }), id };
    if (!foldedLines) {
      return element;
    }
    // as the board saves a folded box: its height is its visible lines
    const height = getTextElementStyledLayout(
      { ...element, foldedLines },
      Infinity,
    ).height;
    return { ...element, foldedLines, height };
  };

  it("reads the folds of each live box with its text; a deleted box, an open box and a stale fold give none", () => {
    const aside = getFoldsAside([
      textBox("t", OUTLINE, [0]),
      { ...textBox("gone", OUTLINE, [0]), isDeleted: true },
      textBox("open"),
      textBox("stale", "• a\n• b", [0]),
    ]);
    expect([...aside]).toEqual([["t", { text: OUTLINE, lines: [0] }]]);
  });

  it("takes the folds out and measures each box to all its lines, without a sentinel fold; the input stays", () => {
    const folded = textBox("t", OUTLINE, [0]);
    const open = textBox("t");
    expect(folded.height).toBeLessThan(open.height);
    const input = [folded, textBox("open")];
    const { elements, aside } = takeFoldsAside(input);
    expect("foldedLines" in elements[0]).toBe(false);
    expect(elements[0].height).toBe(open.height);
    expect(elements[1]).toBe(input[1]);
    expect(input[0]).toBe(folded);
    expect(folded.foldedLines).toEqual([0]);
    expect(aside.get("t")).toEqual({ text: OUTLINE, lines: [0] });
  });

  it("puts folds back only on a live box with the same text and no folds of its own", () => {
    const { aside } = takeFoldsAside([
      textBox("same", OUTLINE, [0]),
      textBox("edited", OUTLINE, [0]),
      textBox("own", OUTLINE, [0]),
      textBox("gone", OUTLINE, [0]),
    ]);
    // a bullet with a child above the folded one: line 0 can fold, but it is another bullet
    const EDITED = `• Zero\n    ○ z\n${OUTLINE}`;
    const now = [
      textBox("same"),
      textBox("edited", EDITED),
      textBox("own", OUTLINE, [0]),
      { ...textBox("gone"), isDeleted: true },
    ];
    expect([...getFoldsToPutBack(now, aside)]).toEqual([["same", [0]]]);
    const saved = withFoldsPutBack(now, aside);
    expect(saved.map((element) => element.foldedLines)).toEqual([
      [0],
      undefined,
      [0],
      undefined,
    ]);
    // the board's own elements stay as they are
    expect(now[0].foldedLines).toBeUndefined();
    expect(saved[1]).toBe(now[1]);
  });

  it("with nothing aside, the save gets the same array", () => {
    const now = [textBox("t")];
    expect(withFoldsPutBack(now, new Map())).toBe(now);
  });
});
