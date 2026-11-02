import type { ExcalidrawTextRun } from "./types";

/**
 * YAZ-3718 D1: styles on a range of letters in a text box. A run covers the
 * UTF-16 offsets `start` to `end` (end-exclusive) of `originalText`.
 */

export type TextRunStyle = Omit<ExcalidrawTextRun, "start" | "end">;

export type TextRunFlag = "bold" | "italic" | "underline" | "strikethrough";

const TEXT_RUN_FLAGS: readonly TextRunFlag[] = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
];

/**
 * YAZ-4102 3E: the highlight colors of notes, by name, with the notes' fills
 * (`client/src/editor/marks/highlight.ts`, `--mark-bg*` in `app.css`). Yellow
 * is the default (`==x==` in a note).
 */
export const TEXT_HIGHLIGHT_FILLS: Readonly<Record<string, string>> = {
  yellow: "rgba(255, 213, 0, 0.4)",
  green: "rgba(80, 200, 120, 0.35)",
  blue: "rgba(80, 160, 255, 0.35)",
  pink: "rgba(255, 120, 180, 0.35)",
};

export const DEFAULT_TEXT_HIGHLIGHT = "yellow";

/** YAZ-3943 demo 2: a custom highlight from the full picker: a `#rrggbb` color. */
const HEX_HIGHLIGHT = /^#[0-9a-f]{6}$/i;

const isTextHighlight = (value: unknown): value is string =>
  typeof value === "string" &&
  (Object.hasOwn(TEXT_HIGHLIGHT_FILLS, value) || HEX_HIGHLIGHT.test(value));

/**
 * The fill behind highlighted letters: a note color's own fill, or a custom
 * color as translucent as the note fills (40 %), so the letters stay readable.
 */
export const getTextHighlightFill = (highlight: string) => {
  const named = TEXT_HIGHLIGHT_FILLS[highlight];
  if (named) {
    return named;
  }
  const [r, g, b] = [1, 3, 5].map((at) =>
    parseInt(highlight.slice(at, at + 2), 16),
  );
  return `rgba(${r}, ${g}, ${b}, 0.4)`;
};

/** The note color nearest to a custom highlight (a note has only the four); a note color as it is. */
export const getNearestNoteHighlight = (highlight: string) => {
  if (Object.hasOwn(TEXT_HIGHLIGHT_FILLS, highlight)) {
    return highlight;
  }
  const rgb = (fill: string) =>
    (/(\d+), (\d+), (\d+)/.exec(fill) ?? []).slice(1).map(Number);
  const [r, g, b] = rgb(getTextHighlightFill(highlight));
  let nearest = DEFAULT_TEXT_HIGHLIGHT;
  let best = Infinity;
  for (const [name, fill] of Object.entries(TEXT_HIGHLIGHT_FILLS)) {
    const [nr, ng, nb] = rgb(fill);
    const distance = (r - nr) ** 2 + (g - ng) ** 2 + (b - nb) ** 2;
    if (distance < best) {
      best = distance;
      nearest = name;
    }
  }
  return nearest;
};

const hasStyle = (style: TextRunStyle) =>
  TEXT_RUN_FLAGS.some((flag) => style[flag]) ||
  style.color !== undefined ||
  style.highlight !== undefined;

export const isSameTextRunStyle = (a: TextRunStyle, b: TextRunStyle) =>
  TEXT_RUN_FLAGS.every((flag) => a[flag] === b[flag]) &&
  a.color === b.color &&
  a.highlight === b.highlight;

const toStyle = (value: Record<string, unknown>): TextRunStyle => ({
  ...(value.bold === true ? { bold: true as const } : {}),
  ...(value.italic === true ? { italic: true as const } : {}),
  ...(value.underline === true ? { underline: true as const } : {}),
  ...(value.strikethrough === true ? { strikethrough: true as const } : {}),
  ...(typeof value.color === "string" && value.color
    ? { color: value.color }
    : {}),
  ...(isTextHighlight(value.highlight) ? { highlight: value.highlight } : {}),
});

/** The style of the run that holds the letter at `offset`, or no style. */
export const getTextRunStyleAt = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  offset: number,
): TextRunStyle => {
  const run = runs?.find((run) => run.start <= offset && offset < run.end);
  return run ? toStyle(run) : {};
};

/**
 * Makes runs valid for a text of `textLength` letters: clamps them to the
 * text, sorts them, joins overlaps (a later color wins), merges neighbors with
 * the same style and drops empty runs. A normal Excalidraw edit can leave
 * runs that are past the end of the text.
 */
export const normalizeTextRuns = (
  value: unknown,
  textLength: number,
): readonly ExcalidrawTextRun[] | undefined => {
  if (!Array.isArray(value) || textLength <= 0) {
    return undefined;
  }

  const clamp = (offset: number) =>
    Math.max(0, Math.min(Math.floor(offset), textLength));
  const runs = value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !Number.isFinite(entry.start) ||
      !Number.isFinite(entry.end)
    ) {
      return [];
    }
    const run = {
      start: clamp(entry.start),
      end: clamp(entry.end),
      ...toStyle(entry),
    };
    return run.start < run.end && hasStyle(run) ? [run] : [];
  });
  const cuts = [...new Set(runs.flatMap((run) => [run.start, run.end]))].sort(
    (a, b) => a - b,
  );
  const normalized: ExcalidrawTextRun[] = [];

  for (let index = 0; index < cuts.length - 1; index++) {
    const start = cuts[index];
    const end = cuts[index + 1];
    let style: TextRunStyle = {};
    for (const run of runs) {
      if (run.start <= start && end <= run.end) {
        style = { ...style, ...toStyle(run) };
      }
    }
    if (!hasStyle(style)) {
      continue;
    }
    const previous = normalized[normalized.length - 1];
    if (previous?.end === start && isSameTextRunStyle(previous, style)) {
      normalized[normalized.length - 1] = { ...previous, end };
    } else {
      normalized.push({ start, end, ...style });
    }
  }

  return normalized.length ? normalized : undefined;
};

/**
 * Changes the style of the letters `start` to `end` with `update`, and keeps
 * the runs outside the range as they are.
 */
export const updateTextRunStyle = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  textLength: number,
  start: number,
  end: number,
  update: (style: TextRunStyle) => TextRunStyle,
): readonly ExcalidrawTextRun[] | undefined => {
  const cuts = [
    ...new Set([
      0,
      textLength,
      start,
      end,
      ...(runs ?? []).flatMap((run) => [run.start, run.end]),
    ]),
  ]
    .filter((offset) => offset >= 0 && offset <= textLength)
    .sort((a, b) => a - b);
  const pieces: ExcalidrawTextRun[] = [];

  for (let index = 0; index < cuts.length - 1; index++) {
    const pieceStart = cuts[index];
    const pieceEnd = cuts[index + 1];
    const style = getTextRunStyleAt(runs, pieceStart);
    pieces.push({
      start: pieceStart,
      end: pieceEnd,
      ...(start <= pieceStart && pieceEnd <= end ? update(style) : style),
    });
  }

  return normalizeTextRuns(pieces, textLength);
};

/** Sets (`value`) or removes one flag on the letters `start` to `end`. */
export const setTextRunFlag = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  textLength: number,
  start: number,
  end: number,
  flag: TextRunFlag,
  value: boolean,
) =>
  updateTextRunStyle(runs, textLength, start, end, (style) => {
    const { [flag]: _, ...rest } = style;
    return value ? { ...rest, [flag]: true } : rest;
  });

/** Sets (`color`) or removes (`undefined`) the color of the letters. */
export const setTextRunColor = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  textLength: number,
  start: number,
  end: number,
  color: string | undefined,
) =>
  updateTextRunStyle(runs, textLength, start, end, ({ color: _, ...rest }) =>
    color === undefined ? rest : { ...rest, color },
  );

/** YAZ-4102 3E: sets (`highlight`, a name) or removes the letters' highlight. */
export const setTextRunHighlight = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  textLength: number,
  start: number,
  end: number,
  highlight: string | undefined,
) =>
  updateTextRunStyle(
    runs,
    textLength,
    start,
    end,
    ({ highlight: _, ...rest }) =>
      highlight === undefined ? rest : { ...rest, highlight },
  );

/** YAZ-4102 3E: the one highlight of the letters `start` to `end`, else undefined. */
export const getTextRangeHighlight = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  start: number,
  end: number,
): string | undefined => {
  let covered = start;
  let highlight: string | undefined;
  for (const run of runs ?? []) {
    if (run.end <= covered || run.start >= end) {
      continue;
    }
    if (
      run.start > covered ||
      !run.highlight ||
      (highlight !== undefined && run.highlight !== highlight)
    ) {
      return undefined;
    }
    highlight = run.highlight;
    covered = run.end;
  }
  return covered >= end ? highlight : undefined;
};

/**
 * YAZ-4103 3F: the pasted letters `start` to `start + length` get exactly the
 * pasted runs (offsets from `start`), not the style of the letters around.
 */
export const setPastedTextRuns = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  textLength: number,
  start: number,
  length: number,
  pasted: readonly ExcalidrawTextRun[],
) =>
  pasted.reduce(
    (next, run) =>
      updateTextRunStyle(
        next,
        textLength,
        start + run.start,
        start + run.end,
        () => toStyle(run),
      ),
    updateTextRunStyle(runs, textLength, start, start + length, () => ({})),
  );

/** Removes one flag, the color or the highlight from every run (the whole box changes). */
export const clearTextRunStyle = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  textLength: number,
  field: TextRunFlag | "color" | "highlight",
) =>
  runs?.some((run) => run[field] !== undefined)
    ? updateTextRunStyle(runs, textLength, 0, textLength, (style) => {
        const { [field]: _, ...rest } = style;
        return rest;
      })
    : runs;

/** True when every letter from `start` to `end` has the flag. */
export const isTextRangeStyled = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  start: number,
  end: number,
  flag: TextRunFlag,
) => {
  let covered = start;
  for (const run of runs ?? []) {
    if (run.end <= covered || !run[flag]) {
      continue;
    }
    if (run.start > covered) {
      return false;
    }
    covered = run.end;
    if (covered >= end) {
      return true;
    }
  }
  return covered >= end;
};

/**
 * YAZ-4101 3D: the color of the letters `start` to `end` as the toolbar shows
 * it: their one run color, undefined for the box color, or null when they have
 * several. A caret gives the color the next typed letter gets.
 */
export const getTextRangeColor = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  text: string,
  start: number,
  end: number,
): string | undefined | null => {
  if (start === end) {
    return getTextRunInsertStyle(runs, text, start).color;
  }
  const colors = new Set<string | undefined>();
  let covered = start;
  for (const run of runs ?? []) {
    if (run.end <= covered || run.start >= end) {
      continue;
    }
    if (run.start > covered) {
      colors.add(undefined);
    }
    colors.add(run.color);
    covered = run.end;
  }
  if (covered < end) {
    colors.add(undefined);
  }
  return colors.size > 1 ? null : [...colors][0];
};

/**
 * YAZ-4101 3D: what the toolbar shows for the letters `start` to `end`, as
 * one key: B, I, U and S on when every letter has it, the color and the
 * highlight. A caret gives the style of the next typed letter.
 */
export const getTextRangeToolbarKey = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  text: string,
  start: number,
  end: number,
) => {
  const caret = start === end ? getTextRunInsertStyle(runs, text, start) : null;
  const color = getTextRangeColor(runs, text, start, end);
  return JSON.stringify([
    // JSON writes `undefined` as `null`: the box color and mixed apart
    color === null ? "mixed" : color ?? "box",
    (caret ? caret.highlight : getTextRangeHighlight(runs, start, end)) ??
      "none",
    ...TEXT_RUN_FLAGS.map((flag) =>
      caret ? caret[flag] === true : isTextRangeStyled(runs, start, end, flag),
    ),
  ]);
};

/** Converts the old per-line flags (one run over each flagged line). */
export const convertLineStylesToTextRuns = (
  text: string,
  lineStyles: Partial<Record<TextRunFlag, unknown>>,
): ExcalidrawTextRun[] => {
  const runs: ExcalidrawTextRun[] = [];
  let lineStart = 0;

  for (const [lineIndex, line] of text.split("\n").entries()) {
    for (const flag of TEXT_RUN_FLAGS) {
      const flags = lineStyles[flag];
      if (Array.isArray(flags) && flags[lineIndex] === true && line.length) {
        runs.push({
          start: lineStart,
          end: lineStart + line.length,
          [flag]: true,
        });
      }
    }
    lineStart += line.length + 1;
  }

  return runs;
};

const getEditWindow = (
  previousText: string,
  nextText: string,
  caret?: number,
) => {
  // An insert ends at the caret. Without it, "Title|" + Enter and "|body" + Enter
  // give the same text, and the common prefix would put the edit on the wrong line.
  const maxStart =
    caret === undefined
      ? Infinity
      : caret - Math.max(0, nextText.length - previousText.length);
  let start = 0;
  while (
    start < maxStart &&
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

/** YAZ-4071 7L: the letters that an edit put in, `start`..`end` of `nextText`. */
export const getInsertedTextRange = (
  previousText: string,
  nextText: string,
) => {
  const edit = getEditWindow(previousText, nextText);
  return { start: edit.start, end: edit.nextEnd };
};

/** YAZ-4071 7L: the runs of the letters `start`..`end`, from 0 (what a cut takes with it). */
export const getTextRunsInRange = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  start: number,
  end: number,
): ExcalidrawTextRun[] =>
  (runs ?? [])
    .filter((run) => run.end > start && run.start < end)
    .map((run) => ({
      ...run,
      start: Math.max(run.start, start) - start,
      end: Math.min(run.end, end) - start,
    }));

/**
 * The style that typed letters get at `offset`, like a note mark: the letter
 * before, or at a line start the first letter of the line. A replace takes the
 * style of the first letter it replaces.
 */
const getInsertStyle = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  text: string,
  offset: number,
  replaces: boolean,
) => {
  if (replaces) {
    return getTextRunStyleAt(runs, offset);
  }
  const atLineStart = offset === 0 || text[offset - 1] === "\n";
  if (atLineStart && offset < text.length && text[offset] !== "\n") {
    return getTextRunStyleAt(runs, offset);
  }
  return getTextRunStyleAt(runs, offset - 1);
};

/** The style that a letter typed at `offset` gets (a caret's toolbar state). */
export const getTextRunInsertStyle = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  text: string,
  offset: number,
) => getInsertStyle(runs, text, offset, false);

/** Moves the runs through one edit: `start`..`previousEnd` became `start`..`nextEnd`. */
const applyTextEdit = (
  runs: readonly ExcalidrawTextRun[] | undefined,
  previousText: string,
  start: number,
  previousEnd: number,
  nextEnd: number,
  insertStyle?: TextRunStyle,
  /** The inserted letters get no style (an indent or a list marker). */
  plain?: boolean,
) => {
  const delta = nextEnd - previousEnd;
  const map = (offset: number) =>
    offset <= start ? offset : offset >= previousEnd ? offset + delta : start;
  const style =
    nextEnd > start && !plain
      ? {
          ...getInsertStyle(runs, previousText, start, previousEnd > start),
          ...insertStyle,
        }
      : {};
  const moved: ExcalidrawTextRun[] = (runs ?? []).map((run) => ({
    ...run,
    start: map(run.start),
    end: map(run.end),
  }));
  if (nextEnd > start) {
    // the inserted letters: cut the runs there, then give the letters their style
    const inserted = { start, end: nextEnd };
    const kept = moved.flatMap((run) => {
      if (run.end <= inserted.start || run.start >= inserted.end) {
        return [run];
      }
      return [
        { ...run, end: inserted.start },
        { ...run, start: inserted.end },
      ].filter((piece) => piece.start < piece.end);
    });
    kept.push({ ...inserted, ...style });
    return kept;
  }
  return moved;
};

/**
 * Pairs of (previous line, next text) for an edit that is moved line by line,
 * or null when the line count does not fit. With `insertedLine`, the line
 * above the new line takes both lines; else each line keeps its index.
 */
const getLinePairs = (
  previousText: string,
  nextText: string,
  insertedLine: number | undefined,
) => {
  const previousLines = previousText.split("\n");
  const nextLines = nextText.split("\n");
  if (insertedLine !== undefined && insertedLine > 0) {
    if (nextLines.length !== previousLines.length + 1) {
      return null;
    }
    return previousLines.map((line, index) =>
      index < insertedLine - 1
        ? { previous: line, next: nextLines[index] }
        : index === insertedLine - 1
        ? {
            previous: line,
            next: `${nextLines[index]}\n${nextLines[index + 1]}`,
          }
        : { previous: line, next: nextLines[index + 1] },
    );
  }
  if (nextLines.length !== previousLines.length) {
    return null;
  }
  return previousLines.map((line, index) => ({
    previous: line,
    next: nextLines[index],
  }));
};

/**
 * The run version of a text edit in the editor (YAZ-3718 D10): an insert inside
 * or at the end of a run extends it, Enter keeps the style on both sides, and a
 * delete shrinks runs and drops empty ones.
 */
export const remapTextRunsForTextEdit = (
  previousText: string,
  nextText: string,
  runs: readonly ExcalidrawTextRun[] | undefined,
  options?: {
    /** The caret after the edit: it places an insert that the text alone cannot. */
    caret?: number;
    /**
     * A line the edit inserted at this index (a numbered list Enter, which also
     * renumbers the lines below): each line is moved on its own.
     */
    insertedLine?: number;
    /**
     * YAZ-4071 7C, 7D: the edit changed the start of several lines and kept
     * their count (a list button, Tab or Shift-Tab): each line is moved on its
     * own, and the inserted indent or marker gets no style.
     */
    eachLine?: boolean;
    /** A style the next typed letters get (a B, I, U, S or color with only a caret). */
    insertStyle?: TextRunStyle;
  },
): readonly ExcalidrawTextRun[] | undefined => {
  if (previousText === nextText) {
    return runs;
  }
  if (!runs?.length && !options?.insertStyle) {
    return undefined;
  }

  const insertedLine = options?.insertedLine;
  const pairs =
    (insertedLine !== undefined && insertedLine > 0) || options?.eachLine
      ? getLinePairs(previousText, nextText, insertedLine)
      : null;
  if (pairs) {
    const starts = pairs.map((_, index) =>
      pairs
        .slice(0, index)
        .reduce((sum, pair) => sum + pair.previous.length + 1, 0),
    );
    const nextStarts = pairs.map((_, index) =>
      pairs
        .slice(0, index)
        .reduce((sum, pair) => sum + pair.next.length + 1, 0),
    );
    let moved = runs;
    // from the last line up: the offsets above each edit stay valid
    for (let index = pairs.length - 1; index >= 0; index--) {
      const pair = pairs[index];
      if (pair.previous === pair.next) {
        continue;
      }
      const isInsertedLine =
        insertedLine !== undefined && index === insertedLine - 1;
      const caret =
        isInsertedLine && options?.caret !== undefined
          ? options.caret - nextStarts[index]
          : undefined;
      const edit = getEditWindow(pair.previous, pair.next, caret);
      moved = applyTextEdit(
        moved,
        previousText,
        starts[index] + edit.start,
        starts[index] + edit.previousEnd,
        starts[index] + edit.nextEnd,
        isInsertedLine ? options?.insertStyle : undefined,
        options?.eachLine,
      );
    }
    return normalizeTextRuns(moved, nextText.length);
  }

  const edit = getEditWindow(previousText, nextText, options?.caret);
  return normalizeTextRuns(
    applyTextEdit(
      runs,
      previousText,
      edit.start,
      edit.previousEnd,
      edit.nextEnd,
      options?.insertStyle,
    ),
    nextText.length,
  );
};
