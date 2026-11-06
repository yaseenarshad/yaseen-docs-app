import { getFontString } from "@excalidraw/common";

import {
  getStyledVisualLineOffsetX,
  getStyledVisualLineStart,
  getStyledVisualLines,
  getStyledVisualSelectionGeometry,
  getTextElementStyledLayout,
  getTextElementStyledLines,
  STYLED_LINES_MEMO_MAX,
} from "../src/textLineUnderlines";
import { getWrappedTextLines } from "../src/textWrapping";
import {
  charWidth,
  setCustomTextMetricsProvider,
} from "../src/textMeasurements";
import { getFoldArrowAnchors } from "../src/textFoldArrows";

import type {
  ExcalidrawTextElement,
  ExcalidrawTextRun,
  FontString,
} from "../src/types";

const getFont = ({ bold, italic }: { bold: boolean; italic: boolean }) =>
  `${italic ? "italic " : ""}${
    bold ? "bold " : ""
  }10px Assistant` as FontString;

const plainArgs = {
  getFont,
  textRuns: undefined,
  wholeElementBold: false,
  wholeElementItalic: false,
  wholeElementUnderlined: false,
  wholeElementStrikethrough: false,
};

it("marks every wrapped fragment of an underlined logical line", () => {
  const lines = getStyledVisualLines({
    ...plainArgs,
    originalText: "A long title that wraps\nSubtitle",
    maxWidth: 90,
    textRuns: [{ start: 0, end: 23, underline: true }],
  });

  expect(lines.length).toBeGreaterThan(2);
  const titleLines = lines.filter((line) => line.logicalLine === 0);
  expect(titleLines.length).toBeGreaterThan(1);
  expect(
    titleLines.every((line) =>
      line.segments?.every((segment) => segment.underlined),
    ),
  ).toBe(true);
  expect(
    lines
      .filter((line) => line.logicalLine === 1)
      .every((line) => !line.underlined && !line.segments),
  ).toBe(true);
});

it("resolves every segment font and combined run styles", () => {
  const lines = getStyledVisualLines({
    ...plainArgs,
    originalText: "Title\nSubtitle",
    maxWidth: Infinity,
    textRuns: [
      { start: 0, end: 5, bold: true, strikethrough: true },
      { start: 6, end: 14, underline: true, strikethrough: true },
    ],
  });

  expect(lines.map((line) => line.segments)).toMatchObject([
    [
      {
        text: "Title",
        bold: true,
        italic: false,
        underlined: false,
        strikethrough: true,
        font: "bold 10px Assistant",
      },
    ],
    [
      {
        text: "Subtitle",
        bold: false,
        underlined: true,
        strikethrough: true,
        font: "10px Assistant",
      },
    ],
  ]);
  expect(lines.every((line) => line.width >= 0)).toBe(true);
});

it("preserves the text metrics width for an empty caret line", () => {
  const [line] = getStyledVisualLines({
    originalText: "",
    ...plainArgs,
    maxWidth: Infinity,
  });

  expect(line.text).toBe("");
  expect(line.width).toBeGreaterThan(0);
});

it("keeps one measured block width for a list item's first and continuation lines", () => {
  const lines = getStyledVisualLines({
    originalText: "• A abcdefg",
    ...plainArgs,
    maxWidth: 100,
  });

  expect(lines).toMatchObject([
    {
      text: "• A",
      horizontalOffset: 0,
      width: 30,
      visualWidth: 30,
      blockWidth: 90,
      isListItem: true,
    },
    {
      text: "abcdefg",
      horizontalOffset: 20,
      width: 70,
      visualWidth: 90,
      blockWidth: 90,
      isListItem: true,
    },
  ]);
});

it("maps selections and carets through a wrapped list's hanging indent", () => {
  const lines = getStyledVisualLines({
    originalText: "• A abcdefg",
    ...plainArgs,
    maxWidth: 100,
  });
  const continuation = lines[1];
  const selection = getStyledVisualSelectionGeometry({
    lines,
    containerWidth: 100,
    textAlign: "left",
    lineHeightPx: 10,
    selectionStart: continuation.start,
    selectionEnd: continuation.end,
  });
  const caret = getStyledVisualSelectionGeometry({
    lines,
    containerWidth: 100,
    textAlign: "left",
    lineHeightPx: 10,
    selectionStart: continuation.start,
    selectionEnd: continuation.start,
  });

  expect(selection.rectangles).toEqual([
    {
      lineIndex: 1,
      left: 20,
      top: 10,
      width: 70,
      height: 10,
    },
  ]);
  expect(selection.caret).toBeNull();
  expect(caret.rectangles).toEqual([]);
  expect(caret.caret).toEqual({
    lineIndex: 1,
    left: 20,
    top: 10,
    height: 10,
  });
});

it("preserves independent visual line widths for wrapped plain text", () => {
  const lines = getStyledVisualLines({
    originalText: "A abcdefg",
    ...plainArgs,
    maxWidth: 80,
  });

  expect(lines).toMatchObject([
    {
      text: "A",
      horizontalOffset: 0,
      width: 10,
      visualWidth: 10,
      blockWidth: 10,
      isListItem: false,
    },
    {
      text: "abcdefg",
      horizontalOffset: 0,
      width: 70,
      visualWidth: 70,
      blockWidth: 70,
      isListItem: false,
    },
  ]);
});

it("aligns a list item as one block while preserving plain-line alignment", () => {
  const listLines = getStyledVisualLines({
    originalText: "• A abcdefg",
    ...plainArgs,
    maxWidth: 100,
  });
  const plainLines = getStyledVisualLines({
    originalText: "A abcdefg",
    ...plainArgs,
    maxWidth: 80,
  });

  expect(
    listLines.map((line) => getStyledVisualLineStart(line, 200, "center")),
  ).toEqual([55, 75]);
  expect(
    listLines.map((line) => getStyledVisualLineStart(line, 200, "right")),
  ).toEqual([110, 130]);
  expect(
    plainLines.map((line) => getStyledVisualLineStart(line, 200, "center")),
  ).toEqual([95, 65]);
});

describe("YAZ-3718 D1: text runs in the layout", () => {
  // a bold letter is 15 px wide and a normal one 10 px; the counter counts measures
  let measures = 0;
  beforeEach(() => {
    measures = 0;
    setCustomTextMetricsProvider({
      getLineWidth: (text, font) => {
        measures++;
        return text.length * (font.includes("bold") ? 15 : 10);
      },
    });
  });
  afterEach(() => {
    setCustomTextMetricsProvider({
      getLineWidth: (text) => text.length * 10,
    });
  });

  const getMixedFont = ({ bold, italic }: { bold: boolean; italic: boolean }) =>
    `${italic ? "italic " : ""}${bold ? "bold " : ""}10px Mixed` as FontString;
  const mixedArgs = { ...plainArgs, getFont: getMixedFont };

  describe("YAZ-4100 3C: right-to-left text in a styled line", () => {
    // "مرحبا" bold (5 × 15 px), then " بالعالم" (8 × 10 px): 155 px
    const ARABIC = "مرحبا بالعالم";
    const arabicLine = () =>
      getStyledVisualLines({
        ...mixedArgs,
        originalText: ARABIC,
        maxWidth: Infinity,
        textRuns: [{ start: 0, end: 5, bold: true }],
      })[0];

    it("places a mixed-style Arabic line's pieces from the right, in text order", () => {
      const line = arabicLine();
      expect(line.rtl).toBe(true);
      expect(
        line.segments!.map(({ text, x, width }) => ({ text, x, width })),
      ).toEqual([
        { text: "مرحبا", x: 80, width: 75 },
        { text: " بالعالم", x: 0, width: 80 },
      ]);
    });

    it("puts the caret and the selection where the letters are drawn", () => {
      const line = arabicLine();
      expect(
        [0, 2, 5, 13].map((offset) => getStyledVisualLineOffsetX(line, offset)),
      ).toEqual([155, 125, 80, 0]);
      const { rectangles } = getStyledVisualSelectionGeometry({
        lines: [line],
        containerWidth: 155,
        textAlign: "left",
        lineHeightPx: 20,
        selectionStart: 0,
        selectionEnd: 5,
      });
      expect(rectangles).toEqual([
        { lineIndex: 0, left: 80, top: 0, width: 75, height: 20 },
      ]);
    });

    it("leaves a left-to-right line and an Arabic line with no run as they were", () => {
      const ltr = getStyledVisualLines({
        ...mixedArgs,
        originalText: "Hello world",
        maxWidth: Infinity,
        textRuns: [{ start: 0, end: 5, bold: true }],
      })[0];
      expect(ltr.rtl).toBeUndefined();
      expect(ltr.segments!.map((segment) => segment.x)).toEqual([0, 75]);
      expect(getStyledVisualLineOffsetX(ltr, 2)).toBe(30);

      const plain = getStyledVisualLines({
        ...mixedArgs,
        originalText: ARABIC,
        maxWidth: Infinity,
      })[0];
      expect(plain.rtl).toBeUndefined();
      expect(plain.segments).toBeUndefined();
    });
  });

  it("gives a line with no run exactly today's layout", () => {
    const originalText = "Plain words that wrap\nStyled";
    const withRuns = getStyledVisualLines({
      ...mixedArgs,
      originalText,
      maxWidth: 100,
      textRuns: [{ start: 22, end: 28, bold: true }],
    });
    const withoutRuns = getStyledVisualLines({
      ...mixedArgs,
      originalText,
      maxWidth: 100,
    });
    const plainLines = withRuns.filter((line) => line.logicalLine === 0);

    expect(plainLines).toEqual(
      withoutRuns.filter((line) => line.logicalLine === 0),
    );
    expect(plainLines.every((line) => !line.segments)).toBe(true);
    expect(
      plainLines.map(({ text, start, end }) => ({ text, start, end })),
    ).toEqual(
      getWrappedTextLines(
        "Plain words that wrap",
        "10px Mixed" as FontString,
        100,
      ).map(({ text, start, end }) => ({ text, start, end })),
    );
    expect(withRuns.find((line) => line.logicalLine === 1)?.segments).toEqual([
      expect.objectContaining({ text: "Styled", x: 0, width: 90, bold: true }),
    ]);
  });

  it("wraps a line with each segment measured in its own font", () => {
    // all normal, "aaa bbb" is 70 px and fits; with a bold "bbb" it is 85 px
    expect(
      getStyledVisualLines({
        ...mixedArgs,
        originalText: "aaa bbb",
        maxWidth: 70,
      }).map((line) => line.text),
    ).toEqual(["aaa bbb"]);

    const lines = getStyledVisualLines({
      ...mixedArgs,
      originalText: "aaa bbb",
      maxWidth: 70,
      textRuns: [{ start: 4, end: 7, bold: true }],
    });

    expect(lines.map((line) => line.text)).toEqual(["aaa", "bbb"]);
    expect(lines[0]).toMatchObject({ width: 30, segments: [{ text: "aaa" }] });
    expect(lines[1]).toMatchObject({
      start: 4,
      end: 7,
      width: 45,
      segments: [{ text: "bbb", x: 0, width: 45, bold: true }],
    });
  });

  it("splits a line into segments with their own x, width, style and color", () => {
    const [line] = getStyledVisualLines({
      ...mixedArgs,
      originalText: "ab cd ef",
      maxWidth: Infinity,
      textRuns: [
        { start: 3, end: 5, bold: true, underline: true },
        { start: 6, end: 8, italic: true, color: "#e03131" },
      ],
    });

    expect(line.width).toBe(30 + 30 + 10 + 20);
    expect(line.segments).toEqual([
      expect.objectContaining({ text: "ab ", x: 0, width: 30, bold: false }),
      expect.objectContaining({
        text: "cd",
        start: 3,
        end: 5,
        x: 30,
        width: 30,
        bold: true,
        underlined: true,
        font: "bold 10px Mixed",
      }),
      expect.objectContaining({ text: " ", x: 60, width: 10 }),
      expect.objectContaining({
        text: "ef",
        x: 70,
        width: 20,
        italic: true,
        color: "#e03131",
        font: "italic 10px Mixed",
      }),
    ]);
  });

  it("maps a selection and a caret through segment widths", () => {
    const lines = getStyledVisualLines({
      ...mixedArgs,
      originalText: "ab cd",
      maxWidth: Infinity,
      textRuns: [{ start: 3, end: 5, bold: true }],
    });
    const geometry = (selectionStart: number, selectionEnd: number) =>
      getStyledVisualSelectionGeometry({
        lines,
        containerWidth: 200,
        textAlign: "left",
        lineHeightPx: 10,
        selectionStart,
        selectionEnd,
      });

    expect(geometry(1, 4).rectangles).toEqual([
      { lineIndex: 0, left: 10, top: 0, width: 20 + 15, height: 10 },
    ]);
    expect(geometry(5, 5).caret).toMatchObject({ left: 30 + 30 });
  });

  it("lays out a box with runs once for a keystroke (memo hit)", () => {
    const element = {
      id: "memo-text",
      fontFamily: 999,
      fontSize: 10,
      lineHeight: 1.25,
      originalText: "Hello bold",
      textRuns: [{ start: 6, end: 10, bold: true }],
    } as unknown as ExcalidrawTextElement;

    getTextElementStyledLayout(element, Infinity);
    expect(measures).toBeGreaterThan(0);

    // a keystroke: refreshTextDimensions lays out the next text and runs ...
    const typed = {
      ...element,
      originalText: "Hello bold!",
      textRuns: [
        { start: 6, end: 11, bold: true },
      ] as readonly ExcalidrawTextRun[],
    };
    measures = 0;
    const layout = getTextElementStyledLayout(typed, Infinity);
    const keystrokeMeasures = measures;
    expect(keystrokeMeasures).toBeGreaterThan(0);

    // ... then the canvas and the editor overlay ask for the same layout
    measures = 0;
    expect(getTextElementStyledLines(typed, Infinity, typed.originalText)).toBe(
      layout.lines,
    );
    expect(getTextElementStyledLines(typed, Infinity, typed.originalText)).toBe(
      layout.lines,
    );
    expect(measures).toBe(0);

    // a change of runs lays out again
    getTextElementStyledLines(
      { ...typed, textRuns: [{ start: 0, end: 5, italic: true }] },
      Infinity,
      typed.originalText,
    );
    expect(measures).toBeGreaterThan(0);
  });

  it("YAZ-4074 6A item 16: the memo keeps at most STYLED_LINES_MEMO_MAX boxes, the oldest out", () => {
    const textRuns = [{ start: 0, end: 2, bold: true }];
    const box = (n: number) =>
      ({
        id: `cap-${n}`,
        fontFamily: 999,
        fontSize: 10,
        lineHeight: 1.25,
        originalText: "Hi",
        textRuns,
      } as unknown as ExcalidrawTextElement);
    for (let n = 0; n <= STYLED_LINES_MEMO_MAX; n++) {
      getTextElementStyledLines(box(n), Infinity, "Hi");
    }
    // the newest box is still held
    measures = 0;
    getTextElementStyledLines(box(STYLED_LINES_MEMO_MAX), Infinity, "Hi");
    expect(measures).toBe(0);
    // the first one left the memo: it measures again
    getTextElementStyledLines(box(0), Infinity, "Hi");
    expect(measures).toBeGreaterThan(0);
  });
});

describe("YAZ-4438: a box lays out again with the real font", () => {
  // `Fonts.onLoaded` clears the letter widths of each box's font. A layout
  // made with the fallback font must not stay in the memo after that.
  const perLetter = (px: number) => ({
    getLineWidth: (text: string) => Array.from(text).length * px,
  });
  const make = (
    id: string,
    originalText: string,
    extra: Partial<ExcalidrawTextElement> = {},
  ) =>
    ({
      id,
      version: 1,
      originalText,
      text: originalText,
      fontFamily: 5,
      fontSize: 20,
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      strikethrough: false,
      lineHeight: 1.25,
      textAlign: "left",
      width: 200,
      ...extra,
    } as unknown as ExcalidrawTextElement);
  // what `Fonts.onLoaded` does when the real font comes in
  const loadRealFont = (element: ExcalidrawTextElement) => {
    setCustomTextMetricsProvider(perLetter(12));
    charWidth.clearCache(getFontString(element));
  };
  afterEach(() => {
    setCustomTextMetricsProvider({
      getLineWidth: (text) => text.length * 10,
    });
  });

  const LONG = "one two three four five six seven eight nine ten";
  it.each([
    ["bullets, no fold", `• ${LONG}\n• b`, {}],
    ["plain lines, no list", `${LONG}\nb`, {}],
    [
      "bullets with a fold",
      `• ${LONG}\n    ○ child\n• b\n    ○ c`,
      { foldedLines: [2] },
    ],
  ] as const)("%s", (name, text, extra) => {
    setCustomTextMetricsProvider(perLetter(8)); // the fallback font
    const element = make(`font-${name}`, text, extra);
    const before = getTextElementStyledLines(element, 200, text).map(
      (line) => line.text,
    );
    loadRealFont(element);
    const after = getTextElementStyledLines(element, 200, text).map(
      (line) => line.text,
    );
    const fresh = getTextElementStyledLines(
      make(`fresh-${name}`, text, extra),
      200,
      text,
    ).map((line) => line.text);
    expect(fresh).not.toEqual(before); // the two fonts wrap differently
    expect(after).toEqual(fresh);
  });

  it("the fold arrows sit on the lines of the real font", () => {
    const text = `• ${LONG}\n    ○ child\n• b\n    ○ c`;
    setCustomTextMetricsProvider(perLetter(8));
    const element = make("font-arrows", text);
    const before = getFoldArrowAnchors(element, 200);
    loadRealFont(element);
    const after = getFoldArrowAnchors(element, 200);
    const fresh = getFoldArrowAnchors(make("fresh-arrows", text), 200);
    expect(fresh).not.toEqual(before);
    expect(after).toEqual(fresh);
  });

  it("a key in a box does not lay out again when no font loads", () => {
    let measures = 0;
    setCustomTextMetricsProvider({
      getLineWidth: (line) => {
        measures++;
        return line.length * 10;
      },
    });
    const element = make("font-steady", `• ${LONG}`);
    getTextElementStyledLines(element, 200, element.originalText);
    measures = 0;
    getTextElementStyledLines(element, 200, element.originalText);
    expect(measures).toBe(0);
  });
});
