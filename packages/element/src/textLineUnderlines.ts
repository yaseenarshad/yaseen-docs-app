import { getFontString } from "@excalidraw/common";

import { getWrappedTextLines } from "./textWrapping";
import { getLineHeightInPx, getLineWidth } from "./textMeasurements";
import { parseTextListLine } from "./textList";

import type { ExcalidrawTextElement, FontString, TextAlign } from "./types";

const getLineCount = (text: string) => text.split("\n").length;

export const getLogicalLineIndexAtOffset = (text: string, offset: number) => {
  const clamped = Math.max(0, Math.min(offset, text.length));
  return text.slice(0, clamped).split("\n").length - 1;
};

export const getSelectedLogicalLineRange = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
) => {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  const adjustedEnd = end > start && text[end - 1] === "\n" ? end - 1 : end;

  return {
    start: getLogicalLineIndexAtOffset(text, start),
    end: getLogicalLineIndexAtOffset(text, adjustedEnd),
  };
};

export const normalizeLineStyles = (
  value: unknown,
  lineCount: number,
): readonly boolean[] | undefined => {
  if (!Array.isArray(value) || lineCount <= 0) {
    return undefined;
  }

  const normalized = value.slice(0, lineCount).map((entry) => entry === true);

  while (normalized.length && !normalized[normalized.length - 1]) {
    normalized.pop();
  }

  return normalized.length ? normalized : undefined;
};

export const normalizeLineUnderlines = normalizeLineStyles;

export const areSelectedLinesStyled = (args: {
  text: string;
  lineStyles: readonly boolean[] | undefined;
  selectionStart: number;
  selectionEnd: number;
  wholeElementStyled: boolean;
}) => {
  const range = getSelectedLogicalLineRange(
    args.text,
    args.selectionStart,
    args.selectionEnd,
  );

  return Array.from(
    { length: range.end - range.start + 1 },
    (_, offset) =>
      args.wholeElementStyled ||
      args.lineStyles?.[range.start + offset] === true,
  ).every(Boolean);
};

export const areSelectedLinesUnderlined = (args: {
  text: string;
  lineUnderlines: readonly boolean[] | undefined;
  selectionStart: number;
  selectionEnd: number;
  wholeElementUnderlined: boolean;
}) =>
  areSelectedLinesStyled({
    text: args.text,
    lineStyles: args.lineUnderlines,
    selectionStart: args.selectionStart,
    selectionEnd: args.selectionEnd,
    wholeElementStyled: args.wholeElementUnderlined,
  });

export const toggleSelectedLineStyles = (args: {
  text: string;
  lineStyles: readonly boolean[] | undefined;
  selectionStart: number;
  selectionEnd: number;
  wholeElementStyled: boolean;
  enabled?: boolean;
}) => {
  const lineCount = getLineCount(args.text);
  const next = args.wholeElementStyled
    ? Array<boolean>(lineCount).fill(true)
    : Array.from(
        { length: lineCount },
        (_, index) => args.lineStyles?.[index] === true,
      );
  const range = getSelectedLogicalLineRange(
    args.text,
    args.selectionStart,
    args.selectionEnd,
  );
  const enabled =
    args.enabled ??
    !areSelectedLinesStyled({
      ...args,
      lineStyles: next,
      wholeElementStyled: false,
    });

  for (let index = range.start; index <= range.end; index++) {
    next[index] = enabled;
  }

  return normalizeLineStyles(next, lineCount);
};

export const toggleSelectedLineUnderlines = (args: {
  text: string;
  lineUnderlines: readonly boolean[] | undefined;
  selectionStart: number;
  selectionEnd: number;
  wholeElementUnderlined: boolean;
  enabled?: boolean;
}) =>
  toggleSelectedLineStyles({
    text: args.text,
    lineStyles: args.lineUnderlines,
    selectionStart: args.selectionStart,
    selectionEnd: args.selectionEnd,
    wholeElementStyled: args.wholeElementUnderlined,
    enabled: args.enabled,
  });

const getEditWindow = (previousText: string, nextText: string) => {
  let start = 0;
  while (
    start < previousText.length &&
    start < nextText.length &&
    previousText[start] === nextText[start]
  ) {
    start++;
  }

  let previousEnd = previousText.length;
  let nextEnd = nextText.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }

  return { start, previousEnd, nextEnd };
};

export const remapLineStylesForTextEdit = (
  previousText: string,
  nextText: string,
  lineStyles: readonly boolean[] | undefined,
  options?: {
    wholeElementStyled?: boolean;
  },
) => {
  const previousLineCount = previousText.split("\n").length;
  const resolvedLineStyles = options?.wholeElementStyled
    ? Array<boolean>(previousLineCount).fill(true)
    : lineStyles;

  if (!resolvedLineStyles?.some(Boolean) || previousText === nextText) {
    return normalizeLineStyles(resolvedLineStyles, nextText.split("\n").length);
  }

  const edit = getEditWindow(previousText, nextText);
  const previousStartLine = getLogicalLineIndexAtOffset(
    previousText,
    edit.start,
  );
  const previousEndLine = getLogicalLineIndexAtOffset(
    previousText,
    edit.previousEnd,
  );
  const nextStartLine = getLogicalLineIndexAtOffset(nextText, edit.start);
  const nextEndLine = getLogicalLineIndexAtOffset(nextText, edit.nextEnd);
  const previousAffected = Array.from(
    { length: previousEndLine - previousStartLine + 1 },
    (_, offset) => resolvedLineStyles[previousStartLine + offset] === true,
  );
  const nextAffectedCount = nextEndLine - nextStartLine + 1;
  const nextAffected = Array<boolean>(nextAffectedCount).fill(
    nextAffectedCount < previousAffected.length
      ? previousAffected.some(Boolean)
      : previousAffected[0] === true,
  );
  const next = [
    ...resolvedLineStyles.slice(0, previousStartLine),
    ...nextAffected,
    ...resolvedLineStyles.slice(previousEndLine + 1),
  ];

  return normalizeLineStyles(next, nextText.split("\n").length);
};

export const remapLineUnderlinesForTextEdit = (
  previousText: string,
  nextText: string,
  lineUnderlines: readonly boolean[] | undefined,
  options?: {
    wholeElementStyled?: boolean;
  },
) =>
  remapLineStylesForTextEdit(previousText, nextText, lineUnderlines, options);

export const getUnderlinedVisualLines = (args: {
  originalText: string;
  font: FontString;
  maxWidth: number;
  lineUnderlines: readonly boolean[] | undefined;
  wholeElementUnderlined: boolean;
}) =>
  getStyledVisualLines({
    originalText: args.originalText,
    regularFont: args.font,
    boldFont: args.font,
    maxWidth: args.maxWidth,
    lineBolds: undefined,
    lineUnderlines: args.lineUnderlines,
    lineStrikethroughs: undefined,
    wholeElementBold: false,
    wholeElementUnderlined: args.wholeElementUnderlined,
    wholeElementStrikethrough: false,
  });

export type StyledVisualLine = {
  text: string;
  start: number;
  end: number;
  horizontalOffset: number;
  logicalLine: number;
  bold: boolean;
  underlined: boolean;
  strikethrough: boolean;
  font: FontString;
  width: number;
  visualWidth: number;
  blockWidth: number;
  isListItem: boolean;
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

      const localStart = Math.max(0, start - line.start);
      const localEnd = Math.max(localStart, end - line.start);
      const prefixWidth = getLineWidth(
        line.text.slice(0, localStart),
        line.font,
      );
      const selectedWidth = getLineWidth(
        line.text.slice(localStart, localEnd),
        line.font,
      );

      rectangles.push({
        lineIndex,
        left:
          getStyledVisualLineStart(line, args.containerWidth, args.textAlign) +
          prefixWidth,
        top: lineIndex * args.lineHeightPx,
        width: selectedWidth,
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
    const localOffset = Math.max(
      0,
      Math.min(selectionStart, line.end) - line.start,
    );
    caret = {
      lineIndex,
      left:
        getStyledVisualLineStart(line, args.containerWidth, args.textAlign) +
        getLineWidth(line.text.slice(0, localOffset), line.font),
      top: lineIndex * args.lineHeightPx,
      height: args.lineHeightPx,
    };
  }

  return { rectangles, caret };
};

export const getStyledVisualLines = (args: {
  originalText: string;
  regularFont: FontString;
  boldFont: FontString;
  maxWidth: number;
  lineBolds: readonly boolean[] | undefined;
  lineUnderlines: readonly boolean[] | undefined;
  lineStrikethroughs: readonly boolean[] | undefined;
  wholeElementBold: boolean;
  wholeElementUnderlined: boolean;
  wholeElementStrikethrough: boolean;
}): StyledVisualLine[] => {
  const lines: StyledVisualLine[] = [];
  let sourceOffset = 0;

  for (const [logicalLine, originalLine] of args.originalText
    .split("\n")
    .entries()) {
    const bold =
      args.wholeElementBold || args.lineBolds?.[logicalLine] === true;
    const underlined =
      args.wholeElementUnderlined ||
      args.lineUnderlines?.[logicalLine] === true;
    const strikethrough =
      args.wholeElementStrikethrough ||
      args.lineStrikethroughs?.[logicalLine] === true;
    const font = bold ? args.boldFont : args.regularFont;
    const visualLines = getWrappedTextLines(originalLine, font, args.maxWidth);
    const isListItem = parseTextListLine(originalLine).markerKind !== "none";
    const measuredLines = visualLines.map((line) => {
      // Empty text lines still occupy one space of layout width in the
      // existing text metrics contract. This keeps a new/empty bound text
      // editor centered and large enough to place the caret.
      const width = getLineWidth(line.text || " ", font);
      return {
        ...line,
        width,
        visualWidth: line.horizontalOffset + width,
      };
    });
    const listBlockWidth = Math.max(
      0,
      ...measuredLines.map((line) => line.visualWidth),
    );

    for (const line of measuredLines) {
      lines.push({
        ...line,
        start: sourceOffset + line.start,
        end: sourceOffset + line.end,
        logicalLine,
        bold,
        underlined,
        strikethrough,
        font,
        blockWidth: isListItem ? listBlockWidth : line.visualWidth,
        isListItem,
      });
    }

    sourceOffset += originalLine.length + 1;
  }

  return lines;
};

export const getStyledTextLayout = (
  args: Parameters<typeof getStyledVisualLines>[0] & {
    fontSize: number;
    lineHeight: ExcalidrawTextElement["lineHeight"];
  },
) => {
  const lines = getStyledVisualLines(args);

  return {
    lines,
    text: lines.map((line) => line.text).join("\n"),
    width: Math.max(0, ...lines.map((line) => line.blockWidth)),
    height: getLineHeightInPx(args.fontSize, args.lineHeight) * lines.length,
  };
};

export const getTextElementStyledLayout = (
  element: ExcalidrawTextElement,
  maxWidth: number,
  originalText = element.originalText,
) =>
  getStyledTextLayout({
    originalText,
    regularFont: getFontString({ ...element, fontWeight: "normal" }),
    boldFont: getFontString({ ...element, fontWeight: "bold" }),
    maxWidth,
    lineBolds: element.lineBolds,
    lineUnderlines: element.lineUnderlines,
    lineStrikethroughs: element.lineStrikethroughs,
    wholeElementBold: element.fontWeight === "bold",
    wholeElementUnderlined: element.textDecoration === "underline",
    wholeElementStrikethrough: element.strikethrough === true,
    fontSize: element.fontSize,
    lineHeight: element.lineHeight,
  });
