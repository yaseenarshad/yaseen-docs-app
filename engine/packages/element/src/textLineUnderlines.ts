import { getFontString, isRTL } from "@excalidraw/common";

import {
  getWrappedTextLineWithMeasure,
  getWrappedTextLines,
} from "./textWrapping";
import { charWidth, getLineHeightInPx, getLineWidth } from "./textMeasurements";
import { getHiddenLines } from "./textFolds";
import { parseTextListLine, TEXT_LIST_CHECK_MARKERS } from "./textList";
import {
  getHostLinksVersion,
  getLinkPillWidth,
  getTextLinks,
  hasHostLinks,
} from "./textLinks";

import type { TextLinkMatch } from "./textLinks";
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
  /** YAZ-4102 3E: the fill behind the letters (`TEXT_HIGHLIGHT_FILLS`). */
  highlight?: string;
  /**
   * YAZ-4039 D7: a link run. `text` is the raw `[[inner]]`, and `width` is the
   * drawn pill with the page's name.
   */
  link?: StyledTextLink;
  /**
   * YAZ-4277 D4: a checklist marker (`☐` or `☑` and the spaces after it).
   * The renderers draw a box in its place; its width stays the letters'.
   */
  checkbox?: "open" | "done";
};

export type StyledTextLink = Omit<TextLinkMatch, "start" | "end">;

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
  /**
   * YAZ-4100 3C: a styled line of a right-to-left script. Its segments stay in
   * text order, and their `x` goes from the right.
   */
  rtl?: true;
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
  if (line.rtl) {
    return getRightToLeftOffsetX(line.segments, position);
  }
  let x = 0;
  for (const segment of line.segments) {
    if (position <= segment.start) {
      return segment.x;
    }
    if (position < segment.end) {
      if (segment.link) {
        // inside a pill: its letters share its drawn width
        return (
          segment.x +
          (segment.width * (position - segment.start)) /
            (segment.end - segment.start)
        );
      }
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

/** YAZ-4100 3C: the offset's x in a right-to-left line: a segment's text starts at its right edge. */
const getRightToLeftOffsetX = (
  segments: readonly StyledTextSegment[],
  position: number,
) => {
  for (const segment of segments) {
    const right = segment.x + segment.width;
    if (position <= segment.start) {
      return right;
    }
    if (position < segment.end) {
      return (
        right -
        (segment.link
          ? (segment.width * (position - segment.start)) /
            (segment.end - segment.start)
          : getLineWidth(
              segment.text.slice(0, position - segment.start),
              segment.font,
            ))
      );
    }
  }
  return segments.length ? segments[segments.length - 1].x : 0;
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

      // YAZ-4100 3C: in a right-to-left line the end is left of the start
      const from = getStyledVisualLineOffsetX(line, start);
      const to = getStyledVisualLineOffsetX(line, end);
      const left = Math.min(from, to);

      rectangles.push({
        lineIndex,
        left:
          getStyledVisualLineStart(line, args.containerWidth, args.textAlign) +
          left,
        top: lineIndex * args.lineHeightPx,
        width: Math.abs(to - from),
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
  highlight?: string;
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
    // YAZ-4039 D7: a line with a link pill takes the segment path too
    const links = getTextLinks(originalLine);
    const parsedLine = parseTextListLine(originalLine);
    // YAZ-4277 D4: and so does a checklist item, for its box
    const checkbox =
      parsedLine.markerKind === "check"
        ? {
            start: parsedLine.indentation.length,
            end: originalLine.length - parsedLine.content.length,
            state:
              parsedLine.marker === TEXT_LIST_CHECK_MARKERS[1]
                ? ("done" as const)
                : ("open" as const),
          }
        : null;
    const pieces =
      hasRuns || links.length || checkbox
        ? getLinePieces(
            originalLine,
            sourceOffset,
            runs,
            runIndex,
            {
              bold: args.wholeElementBold,
              italic: args.wholeElementItalic,
              underlined: args.wholeElementUnderlined,
              strikethrough: args.wholeElementStrikethrough,
              color: undefined,
            },
            links,
            checkbox,
          )
        : null;
    const visualLines = pieces
      ? getWrappedTextLineWithMeasure(
          originalLine,
          getPiecesMeasure(pieces, getFont),
          args.maxWidth,
          links,
        )
      : getWrappedTextLines(originalLine, font, args.maxWidth);
    const isListItem = parsedLine.markerKind !== "none";
    // YAZ-4100 3C: a styled line in a right-to-left script draws its pieces
    // from the right; a line with no run keeps today's path
    const rtl = !!pieces && isRTL(originalLine);
    const measuredLines = visualLines.map((line) => {
      const pieceSegments = pieces
        ? getLineSegments(line, pieces, lineStart, getFont)
        : undefined;
      // Empty text lines still occupy one space of layout width in the
      // existing text metrics contract. This keeps a new/empty bound text
      // editor centered and large enough to place the caret.
      const width = pieceSegments?.length
        ? pieceSegments.reduce((sum, segment) => sum + segment.width, 0)
        : getLineWidth(line.text || " ", font);
      const segments = rtl
        ? pieceSegments?.map((segment) => ({
            ...segment,
            x: width - segment.x - segment.width,
          }))
        : pieceSegments;
      return {
        ...line,
        width,
        visualWidth: line.horizontalOffset + width,
        segments,
        ...(rtl ? { rtl: true as const } : {}),
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

type LinePiece = ResolvedTextStyle & {
  start: number;
  end: number;
  link?: StyledTextLink;
  checkbox?: "open" | "done";
};

/**
 * The line split at its run edges, with offsets from the line start. A link
 * is one piece with the style of its first letter (YAZ-4039 D7).
 */
const getLinePieces = (
  line: string,
  lineStart: number,
  runs: readonly ExcalidrawTextRun[],
  firstRun: number,
  whole: ResolvedTextStyle,
  links: readonly TextLinkMatch[],
  checkbox: { start: number; end: number; state: "open" | "done" } | null,
) => {
  const pieces = getRunPieces(line, lineStart, runs, firstRun, whole);
  const checked = checkbox ? splitCheckboxPiece(pieces, checkbox) : pieces;
  if (!links.length) {
    return checked;
  }
  const linked: LinePiece[] = [];
  for (const piece of checked) {
    let start = piece.start;
    for (const { start: linkStart, end: linkEnd, ...link } of links) {
      if (linkEnd <= start || linkStart >= piece.end) {
        continue;
      }
      if (linkStart > start) {
        linked.push({ ...piece, start, end: linkStart });
      }
      if (linkStart >= piece.start) {
        linked.push({ ...piece, start: linkStart, end: linkEnd, link });
      }
      start = Math.min(piece.end, linkEnd);
    }
    if (start < piece.end) {
      linked.push({ ...piece, start, end: piece.end });
    }
  }
  return linked;
};

/** YAZ-4277 D4: the checklist marker as one piece of its own, in the style of its first letter. */
const splitCheckboxPiece = (
  pieces: readonly LinePiece[],
  checkbox: { start: number; end: number; state: "open" | "done" },
) => {
  const split: LinePiece[] = [];
  for (const piece of pieces) {
    if (piece.end <= checkbox.start || piece.start >= checkbox.end) {
      split.push(piece);
      continue;
    }
    if (piece.start < checkbox.start) {
      split.push({ ...piece, end: checkbox.start });
    }
    if (piece.start <= checkbox.start) {
      split.push({
        ...piece,
        start: checkbox.start,
        end: checkbox.end,
        checkbox: checkbox.state,
      });
    }
    if (piece.end > checkbox.end) {
      split.push({ ...piece, start: Math.max(piece.start, checkbox.end) });
    }
  }
  return split;
};

const getRunPieces = (
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
      ...(run.highlight ? { highlight: run.highlight } : {}),
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
        if (piece.link) {
          // a pill's width, shared by its letters
          width +=
            (getLinkPillWidth(
              piece.link.label,
              getFont(piece.bold, piece.italic),
              piece.link.icon,
            ) *
              (Math.min(end, piece.end) - Math.max(start, piece.start))) /
            (piece.end - piece.start);
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
    const width = piece.link
      ? getLinkPillWidth(piece.link.label, font, piece.link.icon)
      : getLineWidth(text, font);
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
      ...(piece.highlight ? { highlight: piece.highlight } : {}),
      ...(piece.link ? { link: piece.link } : {}),
      ...(piece.checkbox ? { checkbox: piece.checkbox } : {}),
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
  | "foldedLines"
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
 * One layout of all the lines of a text box. Each line lays out alone, so the
 * lines a fold hides (YAZ-4277 D3) are left out after it: they get no visual
 * line. `text` keeps them (null: no line is hidden, the lines' own text).
 * YAZ-4312 S6: a change of a folded box lays out its lines once, not twice.
 */
const layOutTextElement = (
  element: TextElementLayoutStyle,
  maxWidth: number,
  originalText: string,
) => {
  const all = getStyledVisualLines(
    getTextElementStyledLinesArgs(element, maxWidth, originalText),
  );
  const hidden = getHiddenLines(element, originalText);
  return hidden
    ? {
        lines: all.filter((line) => !hidden.has(line.logicalLine)),
        text: all.map((line) => line.text).join("\n"),
      }
    : { lines: all, text: null };
};

/** YAZ-4074 6A item 16: the most text boxes the styled-lines memo holds. */
export const STYLED_LINES_MEMO_MAX = 1000;

/**
 * YAZ-3718 D1: one layout for each text box with runs, links or folds (YAZ-4277
 * D3), keyed by its text, runs, font, folds and width. `refreshTextDimensions`, the canvas and the
 * editor overlay ask for the same layout on a keystroke, so only the first one
 * measures. The memo is for the whole window: a box that was deleted, or whose
 * board closed, keeps its entry until the memo is full. Then the box changed
 * longest ago goes out (YAZ-4074 6A item 16); it measures again if it comes back.
 */
const styledLinesMemo = new Map<
  ExcalidrawTextElement["id"],
  {
    originalText: string;
    textRuns: ExcalidrawTextElement["textRuns"];
    font: FontString;
    textDecoration: ExcalidrawTextElement["textDecoration"];
    strikethrough: ExcalidrawTextElement["strikethrough"];
    foldedLines: ExcalidrawTextElement["foldedLines"];
    maxWidth: number;
    linksVersion: number;
    lines: StyledVisualLine[];
    text: string | null;
  }
>();

/** The layout of a text box from its source text, from the memo when it can. */
const getTextElementLayout = (
  element: TextElementLayoutStyle & Pick<ExcalidrawTextElement, "id">,
  maxWidth: number,
  originalText: string,
): { lines: StyledVisualLine[]; text: string | null } => {
  if (
    !element.textRuns &&
    !element.foldedLines?.length &&
    !hasHostLinks(originalText)
  ) {
    return layOutTextElement(element, maxWidth, originalText);
  }
  const font = getFontString(element);
  const memo = styledLinesMemo.get(element.id);
  // YAZ-4039 D7: a box with links is memoized too; a label change moves the version
  const linksVersion = getHostLinksVersion();
  if (
    memo &&
    memo.originalText === originalText &&
    memo.textRuns === element.textRuns &&
    memo.font === font &&
    memo.textDecoration === element.textDecoration &&
    memo.strikethrough === element.strikethrough &&
    memo.foldedLines === element.foldedLines &&
    memo.maxWidth === maxWidth &&
    memo.linksVersion === linksVersion
  ) {
    return memo;
  }
  const { lines, text } = layOutTextElement(element, maxWidth, originalText);
  // a changed box goes to the end; a full memo drops the box changed longest ago
  styledLinesMemo.delete(element.id);
  if (styledLinesMemo.size >= STYLED_LINES_MEMO_MAX) {
    styledLinesMemo.delete(styledLinesMemo.keys().next().value!);
  }
  styledLinesMemo.set(element.id, {
    originalText,
    textRuns: element.textRuns,
    font,
    textDecoration: element.textDecoration,
    strikethrough: element.strikethrough,
    foldedLines: element.foldedLines,
    maxWidth,
    linksVersion,
    lines,
    text,
  });
  return { lines, text };
};

/** The visual lines of a text box laid out from its source text. */
export const getTextElementStyledLines = (
  element: TextElementLayoutStyle & Pick<ExcalidrawTextElement, "id">,
  maxWidth: number,
  originalText: string,
) => getTextElementLayout(element, maxWidth, originalText).lines;

/**
 * The size of a text box comes from its visible lines (YAZ-4277 D6). Its
 * `text`, which the box saves as `element.text`, keeps the folded lines too
 * (D3): copy as text and other Excalidraw apps still have all of it.
 */
export const getTextElementStyledLayout = (
  element: TextElementLayoutStyle &
    Pick<ExcalidrawTextElement, "id" | "originalText" | "lineHeight">,
  maxWidth: number,
  originalText = element.originalText,
) => {
  const { lines, text } = getTextElementLayout(element, maxWidth, originalText);
  const layout = getStyledTextLayoutFromLines(lines, element);
  return text === null ? layout : { ...layout, text };
};
