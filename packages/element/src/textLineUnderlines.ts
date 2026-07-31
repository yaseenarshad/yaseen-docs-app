import { getFontString } from "@excalidraw/common";

import { getWrappedTextLines } from "./textWrapping";
import { getLineHeightInPx, getLineWidth } from "./textMeasurements";

import type { ExcalidrawTextElement, FontString } from "./types";

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
    newLineStyle?: "inherit" | "plain";
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
  const insertedText = nextText.slice(edit.start, edit.nextEnd);
  const nextAffected =
    options?.newLineStyle === "plain" &&
    nextAffectedCount > 1 &&
    insertedText.includes("\n")
      ? [
          previousAffected[0] === true,
          ...Array<boolean>(nextAffectedCount - 1).fill(false),
        ]
      : Array<boolean>(nextAffectedCount).fill(
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
    newLineStyle?: "inherit" | "plain";
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
  logicalLine: number;
  bold: boolean;
  underlined: boolean;
  strikethrough: boolean;
  font: FontString;
  width: number;
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

    for (const line of visualLines) {
      lines.push({
        ...line,
        start: sourceOffset + line.start,
        end: sourceOffset + line.end,
        logicalLine,
        bold,
        underlined,
        strikethrough,
        font,
        // Empty text lines still occupy one space of layout width in the
        // existing text metrics contract. This keeps a new/empty bound text
        // editor centered and large enough to place the caret.
        width: getLineWidth(line.text || " ", font),
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
    width: Math.max(0, ...lines.map((line) => line.width)),
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
