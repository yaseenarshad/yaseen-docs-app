import { getFontString } from "@excalidraw/common";

import {
  getWrappedTextLineWithMeasure,
  getWrappedTextLines,
} from "./textWrapping";
import { charWidth, getLineHeightInPx, getLineWidth } from "./textMeasurements";
import { parseTextListLine } from "./textList";

import type { TextMeasure, WrappedTextLine } from "./textWrapping";
import type {
  ExcalidrawTextElement,
  ExcalidrawTextRun,
  FontString,
  TextAlign,
} from "./types";

export const getLogicalLineIndexAtOffset = (text: string, offset: number) => {
  const clamped = Math.max(0, Math.min(offset, text.length));
  return text.slice(0, clamped).split("\n").length - 1;
};

/**
 * YAZ-3718 D1: a piece of a visual line with one style. Its `width` is the
 * drawn width, and `x` is where it starts from the visual line start.
 */
export type StyledTextSegment = {
  text: string;
  start: number;
  end: number;
  x: number;
  width: number;
  font: FontString;
  bold: boolean;
  italic: boolean;
  underlined: boolean;
  strikethrough: boolean;
  /** Missing: the color of the whole box. */
  color: string | undefined;
};

export type StyledVisualLine = {
  text: string;
  start: number;
  end: number;
  horizontalOffset: number;
  logicalLine: number;
  bold: boolean;
  italic: boolean;
  underlined: boolean;
  strikethrough: boolean;
  font: FontString;
  width: number;
  visualWidth: number;
  blockWidth: number;
  isListItem: boolean;
  /**
   * YAZ-3718 D1: the styled pieces of a line that has text runs. A line with
   * no run has none, and draws as one text with the line's own style.
   */
  segments?: readonly StyledTextSegment[];
};

export const getStyledVisualLineStart = (
  line: StyledVisualLine,
  containerWidth: number,
  textAlign: TextAlign,
) => {
  const alignedBlockStart =
    textAlign === "center"
      ? (containerWidth - line.blockWidth) / 2
      : textAlign === "right"
      ? containerWidth - line.blockWidth
      : 0;

  return alignedBlockStart + line.horizontalOffset;
};

/** The x of the source offset `offset` from the visual line start. */
export const getStyledVisualLineOffsetX = (
  line: StyledVisualLine,
  offset: number,
) => {
  const localOffset = Math.max(0, Math.min(offset, line.end) - line.start);
  if (!line.segments) {
    return getLineWidth(line.text.slice(0, localOffset), line.font);
  }
  const position = line.start + localOffset;
  let x = 0;
  for (const segment of line.segments) {
    if (position <= segment.start) {
      return segment.x;
    }
    if (position < segment.end) {
      return (
        segment.x +
        getLineWidth(
          segment.text.slice(0, position - segment.start),
          segment.font,
        )
      );
    }
    x = segment.x + segment.width;
  }
  return x;
};

export type StyledVisualSelectionRect = {
  lineIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type StyledVisualCaretGeometry = {
  lineIndex: number;
  left: number;
  top: number;
  height: number;
};

/**
 * Maps source-text selections to the same per-line geometry used to render
 * wrapped/styled text. This is required by the WYSIWYG overlay because the
 * browser textarea does not understand synthetic soft wraps or hanging
 * indents.
 */
export const getStyledVisualSelectionGeometry = (args: {
  lines: readonly StyledVisualLine[];
  containerWidth: number;
  textAlign: TextAlign;
  lineHeightPx: number;
  selectionStart: number;
  selectionEnd: number;
}) => {
  const selectionStart = Math.max(
    0,
    Math.min(args.selectionStart, args.selectionEnd),
  );
  const selectionEnd = Math.max(
    selectionStart,
    Math.max(args.selectionStart, args.selectionEnd),
  );
  const rectangles: StyledVisualSelectionRect[] = [];

  if (selectionStart !== selectionEnd) {
    for (const [lineIndex, line] of args.lines.entries()) {
      const start = Math.max(selectionStart, line.start);
      const end = Math.min(selectionEnd, line.end);

      if (start >= end) {
        continue;
      }

      const left = getStyledVisualLineOffsetX(line, start);

      rectangles.push({
        lineIndex,
        left:
          getStyledVisualLineStart(line, args.containerWidth, args.textAlign) +
          left,
        top: lineIndex * args.lineHeightPx,
        width: getStyledVisualLineOffsetX(line, end) - left,
        height: args.lineHeightPx,
      });
    }
  }

  let caret: StyledVisualCaretGeometry | null = null;

  if (selectionStart === selectionEnd && args.lines.length) {
    let lineIndex = 0;
    for (let index = 0; index < args.lines.length; index++) {
      if (args.lines[index].start <= selectionStart) {
        lineIndex = index;
      } else {
        break;
      }
    }

    const line = args.lines[lineIndex];
    caret = {
      lineIndex,
      left:
        getStyledVisualLineStart(line, args.containerWidth, args.textAlign) +
        getStyledVisualLineOffsetX(line, selectionStart),
      top: lineIndex * args.lineHeightPx,
      height: args.lineHeightPx,
    };
  }

  return { rectangles, caret };
};

type ResolvedTextStyle = {
  bold: boolean;
  italic: boolean;
  underlined: boolean;
  strikethrough: boolean;
  color: string | undefined;
};

export const getStyledVisualLines = (args: {
  originalText: string;
  getFont: (style: { bold: boolean; italic: boolean }) => FontString;
  maxWidth: number;
  textRuns: readonly ExcalidrawTextRun[] | undefined;
  wholeElementBold: boolean;
  wholeElementItalic: boolean;
  wholeElementUnderlined: boolean;
  wholeElementStrikethrough: boolean;
}): StyledVisualLine[] => {
  const lines: StyledVisualLine[] = [];
  const fonts: FontString[] = [];
  const getFont = (bold: boolean, italic: boolean) => {
    const index = (bold ? 2 : 0) + (italic ? 1 : 0);
    if (!fonts[index]) {
      fonts[index] = args.getFont({ bold, italic });
    }
    return fonts[index];
  };
  const font = getFont(args.wholeElementBold, args.wholeElementItalic);
  const runs = args.textRuns ?? [];
  let runIndex = 0;
  let sourceOffset = 0;

  for (const [logicalLine, originalLine] of args.originalText
    .split("\n")
    .entries()) {
    const lineStart = sourceOffset;
    const lineEnd = lineStart + originalLine.length;
    while (runIndex < runs.length && runs[runIndex].end <= sourceOffset) {
      runIndex++;
    }
    const hasRuns =
      originalLine.length > 0 &&
      runIndex < runs.length &&
      runs[runIndex].start < lineEnd;
    const pieces = hasRuns
      ? getLinePieces(originalLine, sourceOffset, runs, runIndex, {
          bold: args.wholeElementBold,
          italic: args.wholeElementItalic,
          underlined: args.wholeElementUnderlined,
          strikethrough: args.wholeElementStrikethrough,
          color: undefined,
        })
      : null;
    const visualLines = pieces
      ? getWrappedTextLineWithMeasure(
          originalLine,
          getPiecesMeasure(pieces, getFont),
          args.maxWidth,
        )
      : getWrappedTextLines(originalLine, font, args.maxWidth);
    const isListItem = parseTextListLine(originalLine).markerKind !== "none";
    const measuredLines = visualLines.map((line) => {
      const segments = pieces
        ? getLineSegments(line, pieces, lineStart, getFont)
        : undefined;
      // Empty text lines still occupy one space of layout width in the
      // existing text metrics contract. This keeps a new/empty bound text
      // editor centered and large enough to place the caret.
      const width = segments?.length
        ? segments.reduce((sum, segment) => sum + segment.width, 0)
        : getLineWidth(line.text || " ", font);
      return {
        ...line,
        width,
        visualWidth: line.horizontalOffset + width,
        segments,
      };
    });
    const listBlockWidth = Math.max(
      0,
      ...measuredLines.map((line) => line.visualWidth),
    );

    for (const { segments, ...line } of measuredLines) {
      lines.push({
        ...line,
        start: sourceOffset + line.start,
        end: sourceOffset + line.end,
        logicalLine,
        bold: args.wholeElementBold,
        italic: args.wholeElementItalic,
        underlined: args.wholeElementUnderlined,
        strikethrough: args.wholeElementStrikethrough,
        font,
        blockWidth: isListItem ? listBlockWidth : line.visualWidth,
        isListItem,
        ...(segments ? { segments } : {}),
      });
    }

    sourceOffset += originalLine.length + 1;
  }

  return lines;
};

type LinePiece = ResolvedTextStyle & { start: number; end: number };

/** The line split at its run edges, with offsets from the line start. */
const getLinePieces = (
  line: string,
  lineStart: number,
  runs: readonly ExcalidrawTextRun[],
  firstRun: number,
  whole: ResolvedTextStyle,
) => {
  const pieces: LinePiece[] = [];
  let cursor = 0;
  for (
    let index = firstRun;
    index < runs.length && runs[index].start < lineStart + line.length;
    index++
  ) {
    const run = runs[index];
    const start = Math.max(0, run.start - lineStart);
    const end = Math.min(line.length, run.end - lineStart);
    if (start > cursor) {
      pieces.push({ ...whole, start: cursor, end: start });
    }
    pieces.push({
      start,
      end,
      bold: whole.bold || run.bold === true,
      italic: whole.italic || run.italic === true,
      underlined: whole.underlined || run.underline === true,
      strikethrough: whole.strikethrough || run.strikethrough === true,
      color: run.color,
    });
    cursor = end;
  }
  if (cursor < line.length) {
    pieces.push({ ...whole, start: cursor, end: line.length });
  }
  return pieces;
};

/** Measures each letter with the font of its piece (offsets from the line start). */
const getPiecesMeasure = (
  pieces: readonly LinePiece[],
  getFont: (bold: boolean, italic: boolean) => FontString,
): TextMeasure => {
  const pieceAt = (offset: number) =>
    pieces.find((piece) => offset < piece.end) ?? pieces[pieces.length - 1];
  return {
    text: (text, start) => {
      const end = start + text.length;
      let width = 0;
      for (const piece of pieces) {
        if (piece.end <= start || piece.start >= end) {
          continue;
        }
        width += getLineWidth(
          text.slice(
            Math.max(start, piece.start) - start,
            Math.min(end, piece.end) - start,
          ),
          getFont(piece.bold, piece.italic),
        );
      }
      return width;
    },
    char: (char, start) => {
      const piece = pieceAt(start);
      return charWidth.calculate(char, getFont(piece.bold, piece.italic));
    },
  };
};

const getLineSegments = (
  line: WrappedTextLine,
  pieces: readonly LinePiece[],
  lineStart: number,
  getFont: (bold: boolean, italic: boolean) => FontString,
) => {
  const segments: StyledTextSegment[] = [];
  let x = 0;
  for (const piece of pieces) {
    const start = Math.max(line.start, piece.start);
    const end = Math.min(line.end, piece.end);
    if (start >= end) {
      continue;
    }
    const text = line.text.slice(start - line.start, end - line.start);
    const font = getFont(piece.bold, piece.italic);
    const width = getLineWidth(text, font);
    segments.push({
      text,
      start: lineStart + start,
      end: lineStart + end,
      x,
      width,
      font,
      bold: piece.bold,
      italic: piece.italic,
      underlined: piece.underlined,
      strikethrough: piece.strikethrough,
      color: piece.color,
    });
    x += width;
  }
  return segments;
};

export const getStyledTextLayout = (
  args: Parameters<typeof getStyledVisualLines>[0] & {
    fontSize: number;
    lineHeight: ExcalidrawTextElement["lineHeight"];
  },
) => getStyledTextLayoutFromLines(getStyledVisualLines(args), args);

const getStyledTextLayoutFromLines = (
  lines: StyledVisualLine[],
  args: {
    fontSize: number;
    lineHeight: ExcalidrawTextElement["lineHeight"];
  },
) => ({
  lines,
  text: lines.map((line) => line.text).join("\n"),
  width: Math.max(0, ...lines.map((line) => line.blockWidth)),
  height: getLineHeightInPx(args.fontSize, args.lineHeight) * lines.length,
});

type TextElementLayoutStyle = Pick<
  ExcalidrawTextElement,
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "fontStyle"
  | "textDecoration"
  | "strikethrough"
  | "textRuns"
>;

const getTextElementStyledLinesArgs = (
  element: TextElementLayoutStyle,
  maxWidth: number,
  originalText: string,
): Parameters<typeof getStyledVisualLines>[0] => ({
  originalText,
  getFont: ({ bold, italic }) =>
    getFontString({
      fontFamily: element.fontFamily,
      fontSize: element.fontSize,
      fontWeight: bold ? "bold" : "normal",
      fontStyle: italic ? "italic" : "normal",
    }),
  maxWidth,
  textRuns: element.textRuns,
  wholeElementBold: element.fontWeight === "bold",
  wholeElementItalic: element.fontStyle === "italic",
  wholeElementUnderlined: element.textDecoration === "underline",
  wholeElementStrikethrough: element.strikethrough === true,
});

/**
 * YAZ-3718 D1: one layout for each text box with runs, keyed by its text, runs,
 * font and width. `refreshTextDimensions`, the canvas and the editor overlay
 * ask for the same layout on a keystroke, so only the first one measures. The
 * entry is replaced on change, so the memo does not grow.
 */
const styledLinesMemo = new Map<
  ExcalidrawTextElement["id"],
  {
    originalText: string;
    textRuns: ExcalidrawTextElement["textRuns"];
    font: FontString;
    textDecoration: ExcalidrawTextElement["textDecoration"];
    strikethrough: ExcalidrawTextElement["strikethrough"];
    maxWidth: number;
    lines: StyledVisualLine[];
  }
>();

/** The visual lines of a text box laid out from its source text. */
export const getTextElementStyledLines = (
  element: TextElementLayoutStyle & Pick<ExcalidrawTextElement, "id">,
  maxWidth: number,
  originalText: string,
) => {
  const args = getTextElementStyledLinesArgs(element, maxWidth, originalText);
  if (!element.textRuns) {
    return getStyledVisualLines(args);
  }
  const font = getFontString(element);
  const memo = styledLinesMemo.get(element.id);
  if (
    memo &&
    memo.originalText === originalText &&
    memo.textRuns === element.textRuns &&
    memo.font === font &&
    memo.textDecoration === element.textDecoration &&
    memo.strikethrough === element.strikethrough &&
    memo.maxWidth === maxWidth
  ) {
    return memo.lines;
  }
  const lines = getStyledVisualLines(args);
  styledLinesMemo.set(element.id, {
    originalText,
    textRuns: element.textRuns,
    font,
    textDecoration: element.textDecoration,
    strikethrough: element.strikethrough,
    maxWidth,
    lines,
  });
  return lines;
};

export const getTextElementStyledLayout = (
  element: TextElementLayoutStyle &
    Pick<ExcalidrawTextElement, "id" | "originalText" | "lineHeight">,
  maxWidth: number,
  originalText = element.originalText,
) =>
  getStyledTextLayoutFromLines(
    getTextElementStyledLines(element, maxWidth, originalText),
    element,
  );
