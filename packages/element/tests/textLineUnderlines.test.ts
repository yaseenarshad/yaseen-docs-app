import {
  areSelectedLinesStyled,
  getStyledVisualLineStart,
  getStyledVisualLines,
  getStyledVisualSelectionGeometry,
  getUnderlinedVisualLines,
  getSelectedLogicalLineRange,
  normalizeLineStyles,
  normalizeLineUnderlines,
  remapLineStylesForTextEdit,
  remapLineUnderlinesForTextEdit,
  toggleSelectedLineStyles,
  toggleSelectedLineUnderlines,
} from "../src/textLineUnderlines";

import type { FontString } from "../src/types";

describe("text line underlines", () => {
  it("targets the caret line and excludes a line touched only by the end boundary", () => {
    expect(getSelectedLogicalLineRange("Title\nSubtitle", 2, 2)).toEqual({
      start: 0,
      end: 0,
    });
    expect(getSelectedLogicalLineRange("Title\nSubtitle", 0, 6)).toEqual({
      start: 0,
      end: 0,
    });
    expect(getSelectedLogicalLineRange("Title\nSubtitle", 0, 9)).toEqual({
      start: 0,
      end: 1,
    });
  });

  it("underlines all selected lines and toggles them off together", () => {
    const enabled = toggleSelectedLineUnderlines({
      text: "Title\nSubtitle\nBody",
      lineUnderlines: undefined,
      selectionStart: 0,
      selectionEnd: 14,
      wholeElementUnderlined: false,
    });
    expect(enabled).toEqual([true, true]);

    expect(
      toggleSelectedLineUnderlines({
        text: "Title\nSubtitle\nBody",
        lineUnderlines: enabled,
        selectionStart: 0,
        selectionEnd: 14,
        wholeElementUnderlined: false,
      }),
    ).toBeUndefined();
  });

  it("materializes legacy whole-element underline before removing one line", () => {
    expect(
      toggleSelectedLineUnderlines({
        text: "Title\nSubtitle",
        lineUnderlines: undefined,
        selectionStart: 0,
        selectionEnd: 5,
        wholeElementUnderlined: true,
      }),
    ).toEqual([false, true]);
  });

  it("normalizes malformed, excess, and trailing false entries", () => {
    expect(normalizeLineUnderlines([true, "yes", false, true], 3)).toEqual([
      true,
    ]);
    expect(normalizeLineUnderlines([false, false], 2)).toBeUndefined();
    expect(normalizeLineUnderlines("invalid", 2)).toBeUndefined();
  });
});

describe("generic logical-line styles", () => {
  it("normalizes and toggles an independent boolean line style", () => {
    expect(normalizeLineStyles([true, "invalid", false, true], 3)).toEqual([
      true,
    ]);

    const enabled = toggleSelectedLineStyles({
      text: "Title\nSubtitle\nBody",
      lineStyles: undefined,
      selectionStart: 0,
      selectionEnd: 14,
      wholeElementStyled: false,
    });

    expect(enabled).toEqual([true, true]);
    expect(
      areSelectedLinesStyled({
        text: "Title\nSubtitle\nBody",
        lineStyles: enabled,
        selectionStart: 0,
        selectionEnd: 14,
        wholeElementStyled: false,
      }),
    ).toBe(true);
  });

  it("materializes a whole-element style before disabling one line", () => {
    expect(
      toggleSelectedLineStyles({
        text: "Title\nSubtitle",
        lineStyles: undefined,
        selectionStart: 0,
        selectionEnd: 5,
        wholeElementStyled: true,
      }),
    ).toEqual([false, true]);
  });
});

describe("remapLineUnderlinesForTextEdit", () => {
  it("preserves decoration for character edits", () => {
    expect(
      remapLineUnderlinesForTextEdit("Title\nSubtitle", "New Title\nSubtitle", [
        true,
      ]),
    ).toEqual([true]);
  });

  it("inherits decoration when an underlined line is split", () => {
    expect(remapLineUnderlinesForTextEdit("Title", "Ti\ntle", [true])).toEqual([
      true,
      true,
    ]);
  });

  it("keeps a merged line underlined when either source line was underlined", () => {
    expect(
      remapLineUnderlinesForTextEdit("Title\nSubtitle", "TitleSubtitle", [
        false,
        true,
      ]),
    ).toEqual([true]);
  });

  it("shifts unaffected lines after multiline insertion", () => {
    expect(
      remapLineUnderlinesForTextEdit("Title\nBody", "Intro\nTitle\nBody", [
        true,
        false,
      ]),
    ).toEqual([true, true]);
  });
});

describe("remapLineStylesForTextEdit", () => {
  it("carries the line style onto the new line when Enter splits a styled line", () => {
    // in the middle, at the end, at the start
    expect(remapLineStylesForTextEdit("Title", "Ti\ntle", [true])).toEqual([
      true,
      true,
    ]);
    expect(remapLineStylesForTextEdit("Title", "Title\n", [true])).toEqual([
      true,
      true,
    ]);
    expect(remapLineStylesForTextEdit("Title", "\nTitle", [true])).toEqual([
      true,
      true,
    ]);
    // a manually styled blank line
    expect(
      remapLineStylesForTextEdit("Title\n", "Title\n\n", [false, true]),
    ).toEqual([false, true, true]);
    // a whole-element style
    expect(
      remapLineStylesForTextEdit("Title", "Title\n", undefined, {
        wholeElementStyled: true,
      }),
    ).toEqual([true, true]);
  });

  it("uses the caret to tell Enter at a line end from Enter at the next line start", () => {
    // "Title|" + Enter and "|body" + Enter give the same text; the caret differs
    expect(
      remapLineStylesForTextEdit("Title\nbody", "Title\n\nbody", [true], {
        caret: 6,
      }),
    ).toEqual([true, true]);
    expect(
      remapLineStylesForTextEdit("Title\nbody", "Title\n\nbody", [true], {
        caret: 7,
      }),
    ).toEqual([true]);
    expect(
      remapLineStylesForTextEdit(
        "plain\nBold",
        "plain\n\nBold",
        [false, true],
        {
          caret: 6,
        },
      ),
    ).toEqual([false, false, true]);
    expect(
      remapLineStylesForTextEdit("• A\n• B", "• A\n• \n• B", [true], {
        caret: 6,
      }),
    ).toEqual([true, true]);
  });

  it("copies the line above into a line inserted at a known index", () => {
    // a numbered Enter renumbers the items below it, so a text diff cannot find the new line
    expect(
      remapLineStylesForTextEdit(
        "1. A\n2. B\n3. C",
        "1. A\n2. \n3. B\n4. C",
        [false, true],
        { insertedLine: 1 },
      ),
    ).toEqual([false, false, true]);
    expect(
      remapLineStylesForTextEdit(
        "1. A\n2. B\n3. C",
        "1. A\n2. \n3. B\n4. C",
        [true, false, true],
        { insertedLine: 1 },
      ),
    ).toEqual([true, true, false, true]);
    expect(
      remapLineStylesForTextEdit("1. A\n2. B", "1. A\n2. \n3. B", undefined, {
        insertedLine: 1,
        wholeElementStyled: true,
      }),
    ).toEqual([true, true, true]);
  });

  it("keeps the new line plain when Enter splits a plain line", () => {
    expect(
      remapLineStylesForTextEdit("Title\nBody", "Title\nBody\n", [true]),
    ).toEqual([true]);
  });

  it("gives a line break that replaces a multiline selection the first line style", () => {
    expect(
      remapLineStylesForTextEdit("Title\nBody", "Ti\ndy", [true, false]),
    ).toEqual([true, true]);
    expect(
      remapLineStylesForTextEdit("Title\nBody", "Ti\ndy", [false, true]),
    ).toBeUndefined();
  });

  it("lets manually styled blank lines retain their style as text is typed", () => {
    expect(
      remapLineStylesForTextEdit("Title\n", "Title\nIdea", [false, true]),
    ).toEqual([false, true]);
  });

  it("preserves a style on merge when either source line had it", () => {
    expect(
      remapLineStylesForTextEdit("Title\nSubtitle", "TitleSubtitle", [
        false,
        true,
      ]),
    ).toEqual([true]);
  });

  it("inherits the receiving line style for multiline paste", () => {
    expect(
      remapLineStylesForTextEdit("Title\nBody", "Intro\nTitle\nBody", [
        true,
        false,
      ]),
    ).toEqual([true, true]);
  });
});

it("marks every wrapped fragment of an underlined logical line", () => {
  const lines = getUnderlinedVisualLines({
    originalText: "A long title that wraps\nSubtitle",
    font: "20px Assistant" as FontString,
    maxWidth: 90,
    lineUnderlines: [true],
    wholeElementUnderlined: false,
  });

  expect(lines.length).toBeGreaterThan(2);
  const titleLines = lines.filter((line) => line.logicalLine === 0);
  expect(titleLines.length).toBeGreaterThan(1);
  expect(titleLines.every((line) => line.underlined)).toBe(true);
  expect(
    lines
      .filter((line) => line.logicalLine === 1)
      .every((line) => !line.underlined),
  ).toBe(true);
});

it("resolves every visual line font and combined logical-line styles", () => {
  const lines = getStyledVisualLines({
    originalText: "Title\nSubtitle",
    regularFont: "20px Assistant" as FontString,
    boldFont: "bold 20px Assistant" as FontString,
    maxWidth: Infinity,
    lineBolds: [true],
    lineUnderlines: [false, true],
    lineStrikethroughs: [true, true],
    wholeElementBold: false,
    wholeElementUnderlined: false,
    wholeElementStrikethrough: false,
  });

  expect(lines).toMatchObject([
    {
      text: "Title",
      logicalLine: 0,
      bold: true,
      underlined: false,
      strikethrough: true,
      font: "bold 20px Assistant",
    },
    {
      text: "Subtitle",
      logicalLine: 1,
      bold: false,
      underlined: true,
      strikethrough: true,
      font: "20px Assistant",
    },
  ]);
  expect(lines.every((line) => line.width >= 0)).toBe(true);
});

it("preserves the text metrics width for an empty caret line", () => {
  const [line] = getStyledVisualLines({
    originalText: "",
    regularFont: "20px Assistant" as FontString,
    boldFont: "bold 20px Assistant" as FontString,
    maxWidth: Infinity,
    lineBolds: undefined,
    lineUnderlines: undefined,
    lineStrikethroughs: undefined,
    wholeElementBold: false,
    wholeElementUnderlined: false,
    wholeElementStrikethrough: false,
  });

  expect(line.text).toBe("");
  expect(line.width).toBeGreaterThan(0);
});

it("keeps one measured block width for a list item's first and continuation lines", () => {
  const lines = getStyledVisualLines({
    originalText: "• A abcdefg",
    regularFont: "10px Assistant" as FontString,
    boldFont: "bold 10px Assistant" as FontString,
    maxWidth: 100,
    lineBolds: undefined,
    lineUnderlines: undefined,
    lineStrikethroughs: undefined,
    wholeElementBold: false,
    wholeElementUnderlined: false,
    wholeElementStrikethrough: false,
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
    regularFont: "10px Assistant" as FontString,
    boldFont: "bold 10px Assistant" as FontString,
    maxWidth: 100,
    lineBolds: undefined,
    lineUnderlines: undefined,
    lineStrikethroughs: undefined,
    wholeElementBold: false,
    wholeElementUnderlined: false,
    wholeElementStrikethrough: false,
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
    regularFont: "10px Assistant" as FontString,
    boldFont: "bold 10px Assistant" as FontString,
    maxWidth: 80,
    lineBolds: undefined,
    lineUnderlines: undefined,
    lineStrikethroughs: undefined,
    wholeElementBold: false,
    wholeElementUnderlined: false,
    wholeElementStrikethrough: false,
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
    regularFont: "10px Assistant" as FontString,
    boldFont: "bold 10px Assistant" as FontString,
    maxWidth: 100,
    lineBolds: undefined,
    lineUnderlines: undefined,
    lineStrikethroughs: undefined,
    wholeElementBold: false,
    wholeElementUnderlined: false,
    wholeElementStrikethrough: false,
  });
  const plainLines = getStyledVisualLines({
    originalText: "A abcdefg",
    regularFont: "10px Assistant" as FontString,
    boldFont: "bold 10px Assistant" as FontString,
    maxWidth: 80,
    lineBolds: undefined,
    lineUnderlines: undefined,
    lineStrikethroughs: undefined,
    wholeElementBold: false,
    wholeElementUnderlined: false,
    wholeElementStrikethrough: false,
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
