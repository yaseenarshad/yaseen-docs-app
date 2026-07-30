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

export const normalizeLineUnderlines = (
  value: unknown,
  lineCount: number,
): readonly boolean[] | undefined => {
  if (!Array.isArray(value) || lineCount <= 0) {
    return undefined;
  }

  const normalized = value
    .slice(0, lineCount)
    .map((entry) => entry === true);

  while (normalized.length && !normalized[normalized.length - 1]) {
    normalized.pop();
  }

  return normalized.length ? normalized : undefined;
};

export const areSelectedLinesUnderlined = (args: {
  text: string;
  lineUnderlines: readonly boolean[] | undefined;
  selectionStart: number;
  selectionEnd: number;
  wholeElementUnderlined: boolean;
}) => {
  const range = getSelectedLogicalLineRange(
    args.text,
    args.selectionStart,
    args.selectionEnd,
  );

  return Array.from(
    { length: range.end - range.start + 1 },
    (_, offset) =>
      args.wholeElementUnderlined ||
      args.lineUnderlines?.[range.start + offset] === true,
  ).every(Boolean);
};

export const toggleSelectedLineUnderlines = (args: {
  text: string;
  lineUnderlines: readonly boolean[] | undefined;
  selectionStart: number;
  selectionEnd: number;
  wholeElementUnderlined: boolean;
  enabled?: boolean;
}) => {
  const lineCount = getLineCount(args.text);
  const next = args.wholeElementUnderlined
    ? Array<boolean>(lineCount).fill(true)
    : Array.from(
        { length: lineCount },
        (_, index) => args.lineUnderlines?.[index] === true,
      );
  const range = getSelectedLogicalLineRange(
    args.text,
    args.selectionStart,
    args.selectionEnd,
  );
  const enabled =
    args.enabled ??
    !areSelectedLinesUnderlined({
      ...args,
      lineUnderlines: next,
      wholeElementUnderlined: false,
    });

  for (let index = range.start; index <= range.end; index++) {
    next[index] = enabled;
  }

  return normalizeLineUnderlines(next, lineCount);
};

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

export const remapLineUnderlinesForTextEdit = (
  previousText: string,
  nextText: string,
  lineUnderlines: readonly boolean[] | undefined,
) => {
  if (!lineUnderlines?.some(Boolean) || previousText === nextText) {
    return normalizeLineUnderlines(
      lineUnderlines,
      nextText.split("\n").length,
    );
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
    (_, offset) => lineUnderlines[previousStartLine + offset] === true,
  );
  const nextAffectedCount = nextEndLine - nextStartLine + 1;
  const inherited =
    nextAffectedCount < previousAffected.length
      ? previousAffected.some(Boolean)
      : previousAffected[0] === true;
  const next = [
    ...lineUnderlines.slice(0, previousStartLine),
    ...Array<boolean>(nextAffectedCount).fill(inherited),
    ...lineUnderlines.slice(previousEndLine + 1),
  ];

  return normalizeLineUnderlines(next, nextText.split("\n").length);
};
