import {
  getBulletMarkerForDepth,
  hasTextList,
  parseTextListLine,
  TEXT_LIST_INDENT,
  TEXT_LIST_BULLET_MARKERS,
} from "@excalidraw/element";

import type {
  ParsedTextListLine,
  TextListMarkerKind,
} from "@excalidraw/element";

export {
  getBulletMarkerForDepth,
  hasTextList,
  parseTextListLine,
  TEXT_LIST_INDENT,
  TEXT_LIST_BULLET_MARKERS,
};

export type { ParsedTextListLine, TextListMarkerKind };

export type TextListMode = "plain" | "bullet" | "numbered" | "mixed";

export type TextListTransform = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  mode: Exclude<TextListMode, "mixed">;
};

const getIndentationWidth = (indentation: string) =>
  Array.from(indentation).reduce(
    (width, character) => width + (character === "\t" ? 4 : 1),
    0,
  );

type TextListLineRecord = {
  raw: string;
  start: number;
  end: number;
  parsed: ParsedTextListLine;
  resolvedMode: Exclude<TextListMode, "mixed">;
};

const getLineRecords = (text: string): TextListLineRecord[] => {
  let start = 0;
  const records = text.split("\n").map((raw) => {
    const record: TextListLineRecord = {
      raw,
      start,
      end: start + raw.length,
      parsed: parseTextListLine(raw),
      resolvedMode: "plain",
    };
    start += raw.length + 1;
    return record;
  });

  let blockStart = 0;
  while (blockStart < records.length) {
    while (blockStart < records.length && !records[blockStart].raw.trim()) {
      blockStart++;
    }
    if (blockStart >= records.length) {
      break;
    }
    let blockEnd = blockStart;
    while (blockEnd < records.length && records[blockEnd].raw.trim()) {
      blockEnd++;
    }
    const block = records.slice(blockStart, blockEnd);
    const isNumbered = block.some(
      ({ parsed }) => parsed.depth === 0 && parsed.markerKind === "number",
    );
    for (const record of block) {
      if (record.parsed.markerKind !== "none") {
        record.resolvedMode = isNumbered ? "numbered" : "bullet";
      }
    }
    blockStart = blockEnd + 1;
  }

  return records;
};

const getSelectedLineIndices = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
) => {
  const records = getLineRecords(text);
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  const effectiveEnd = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const first = Math.max(
    0,
    records.findIndex(({ start: lineStart, end: lineEnd }) =>
      start === text.length
        ? lineEnd === text.length
        : start >= lineStart && start <= lineEnd,
    ),
  );
  const lastMatch = records.findIndex(
    ({ start: lineStart, end: lineEnd }) =>
      effectiveEnd >= lineStart && effectiveEnd <= lineEnd,
  );
  const last = lastMatch === -1 ? records.length - 1 : lastMatch;

  return { records, first, last, start, end };
};

export const getTextListMode = (
  text: string,
  selectionStart = 0,
  selectionEnd = text.length,
): TextListMode => {
  const { records, first, last } = getSelectedLineIndices(
    text,
    selectionStart,
    selectionEnd,
  );
  const modes = records
    .slice(first, last + 1)
    .filter(({ raw }) => raw.trim())
    .map(({ resolvedMode }) => resolvedMode);

  if (!modes.length || modes.every((mode) => mode === "plain")) {
    return "plain";
  }
  if (modes.every((mode) => mode === "bullet")) {
    return "bullet";
  }
  if (modes.every((mode) => mode === "numbered")) {
    return "numbered";
  }
  return "mixed";
};

const formatLineForMode = (
  line: string,
  mode: Exclude<TextListMode, "mixed">,
) => {
  if (!line.trim()) {
    return line;
  }
  const parsed = parseTextListLine(line);
  const content = parsed.content;
  if (mode === "plain") {
    return `${parsed.indentation}${content}`;
  }
  const marker =
    mode === "numbered" && parsed.depth === 0
      ? "1."
      : getBulletMarkerForDepth(parsed.depth);
  return `${parsed.indentation}${marker} ${content}`;
};

const normalizeNumberedLines = (lines: string[]) => {
  let blockStart = 0;
  while (blockStart < lines.length) {
    while (blockStart < lines.length && !lines[blockStart].trim()) {
      blockStart++;
    }
    if (blockStart >= lines.length) {
      break;
    }
    let blockEnd = blockStart;
    while (blockEnd < lines.length && lines[blockEnd].trim()) {
      blockEnd++;
    }
    const isNumbered = lines.slice(blockStart, blockEnd).some((line) => {
      const parsed = parseTextListLine(line);
      return parsed.depth === 0 && parsed.markerKind === "number";
    });
    if (isNumbered) {
      let nextNumber = 1;
      for (let index = blockStart; index < blockEnd; index++) {
        const parsed = parseTextListLine(lines[index]);
        if (parsed.markerKind === "none") {
          continue;
        }
        const marker =
          parsed.depth === 0
            ? `${nextNumber++}.`
            : getBulletMarkerForDepth(parsed.depth);
        lines[index] = `${parsed.indentation}${marker} ${parsed.content}`;
      }
    }
    blockStart = blockEnd + 1;
  }
  return lines;
};

export const renumberTextLists = (text: string) =>
  normalizeNumberedLines(text.split("\n")).join("\n");

const getContentStart = (line: string) => {
  const parsed = parseTextListLine(line);
  return line.length - parsed.content.length;
};

const mapOffset = (
  originalRecords: TextListLineRecord[],
  nextLines: string[],
  offset: number,
) => {
  const lineIndex = originalRecords.findIndex(
    ({ start, end }) => offset >= start && offset <= end,
  );
  if (lineIndex === -1) {
    return nextLines.join("\n").length;
  }
  const record = originalRecords[lineIndex];
  const previousDelta = originalRecords
    .slice(0, lineIndex)
    .reduce(
      (total, previous, index) =>
        total + nextLines[index].length - previous.raw.length,
      0,
    );
  const localOffset = offset - record.start;
  const oldContentStart = getContentStart(record.raw);
  const newContentStart = getContentStart(nextLines[lineIndex]);
  const nextLocalOffset =
    localOffset <= record.parsed.indentation.length
      ? localOffset
      : localOffset >= oldContentStart
      ? localOffset + newContentStart - oldContentStart
      : newContentStart;
  return offset + previousDelta + nextLocalOffset - localOffset;
};

export const setTextListMode = (
  text: string,
  selectionStart = 0,
  selectionEnd = text.length,
  mode: Exclude<TextListMode, "mixed">,
): TextListTransform => {
  const { records, first, last, start, end } = getSelectedLineIndices(
    text,
    selectionStart,
    selectionEnd,
  );
  const nextLines = records.map(({ raw }, index) =>
    index >= first && index <= last ? formatLineForMode(raw, mode) : raw,
  );
  normalizeNumberedLines(nextLines);

  return {
    text: nextLines.join("\n"),
    selectionStart: mapOffset(records, nextLines, start),
    selectionEnd: mapOffset(records, nextLines, end),
    mode,
  };
};

export const cycleTextList = (
  text: string,
  selectionStart = 0,
  selectionEnd = text.length,
): TextListTransform => {
  const currentMode = getTextListMode(text, selectionStart, selectionEnd);
  const mode =
    currentMode === "bullet"
      ? "numbered"
      : currentMode === "numbered"
      ? "plain"
      : "bullet";

  return setTextListMode(text, selectionStart, selectionEnd, mode);
};

export const normalizeTextLists = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextListTransform => {
  const records = getLineRecords(text);
  const nextLines = records.map(({ raw }) => raw);
  normalizeNumberedLines(nextLines);
  const nextText = nextLines.join("\n");
  const resolvedMode = getTextListMode(nextText);

  return {
    text: nextText,
    selectionStart: mapOffset(records, nextLines, selectionStart),
    selectionEnd: mapOffset(records, nextLines, selectionEnd),
    mode: resolvedMode === "mixed" ? "plain" : resolvedMode,
  };
};

const removeOneIndent = (indentation: string) => {
  if (indentation.endsWith("\t")) {
    return indentation.slice(0, -1);
  }
  return indentation.replace(/ {1,4}$/, "");
};

export const indentTextList = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  direction: 1 | -1,
): TextListTransform => {
  const { records, first, last, start, end } = getSelectedLineIndices(
    text,
    selectionStart,
    selectionEnd,
  );
  const nextLines = records.map((record, index) => {
    if (
      index < first ||
      index > last ||
      !record.raw.trim() ||
      record.parsed.markerKind === "none"
    ) {
      return record.raw;
    }
    const indentation =
      direction === 1
        ? `${record.parsed.indentation}${TEXT_LIST_INDENT}`
        : removeOneIndent(record.parsed.indentation);
    const depth = Math.floor(getIndentationWidth(indentation) / 4);
    const marker =
      record.resolvedMode === "numbered" && depth === 0
        ? "1."
        : getBulletMarkerForDepth(depth);
    return `${indentation}${marker} ${record.parsed.content}`;
  });
  normalizeNumberedLines(nextLines);
  const mode = records
    .slice(first, last + 1)
    .find(({ resolvedMode }) => resolvedMode !== "plain")?.resolvedMode;

  return {
    text: nextLines.join("\n"),
    selectionStart: mapOffset(records, nextLines, start),
    selectionEnd: mapOffset(records, nextLines, end),
    mode: mode ?? "plain",
  };
};

export const continueTextListItem = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextListTransform | null => {
  if (selectionStart !== selectionEnd) {
    return null;
  }
  const { records, first, start } = getSelectedLineIndices(
    text,
    selectionStart,
    selectionEnd,
  );
  const record = records[first];
  if (!record || record.parsed.markerKind === "none") {
    return null;
  }

  const nextLines = records.map(({ raw }) => raw);
  const mode = record.resolvedMode === "plain" ? "bullet" : record.resolvedMode;
  if (!record.parsed.content.trim() && start === record.end) {
    if (record.parsed.depth === 0) {
      nextLines[first] = record.parsed.indentation;
    } else {
      const indentation = removeOneIndent(record.parsed.indentation);
      const depth = Math.floor(getIndentationWidth(indentation) / 4);
      const marker =
        mode === "numbered" && depth === 0
          ? "1."
          : getBulletMarkerForDepth(depth);
      nextLines[first] = `${indentation}${marker} `;
    }
    normalizeNumberedLines(nextLines);
    const nextLine = nextLines[first];
    const nextCaret =
      records
        .slice(0, first)
        .reduce((offset, line) => offset + line.raw.length + 1, 0) +
      nextLine.length;
    return {
      text: nextLines.join("\n"),
      selectionStart: nextCaret,
      selectionEnd: nextCaret,
      mode,
    };
  }

  const localCaret = start - record.start;
  const marker =
    mode === "numbered" && record.parsed.depth === 0
      ? "1."
      : getBulletMarkerForDepth(record.parsed.depth);
  const continuation = `${record.parsed.indentation}${marker} `;
  const before = record.raw.slice(0, localCaret);
  const after = record.raw.slice(localCaret);
  nextLines.splice(first, 1, before, `${continuation}${after}`);
  normalizeNumberedLines(nextLines);
  const nextCaret =
    records
      .slice(0, first)
      .reduce((offset, line) => offset + line.raw.length + 1, 0) +
    before.length +
    1 +
    nextLines[first + 1].length -
    after.length;
  return {
    text: nextLines.join("\n"),
    selectionStart: nextCaret,
    selectionEnd: nextCaret,
    mode,
  };
};

export const formatPastedTextForList = (
  pastedText: string,
  mode: "bullet" | "numbered",
  receivingDepth: number,
) => {
  const parsedLines = pastedText.split("\n").map(parseTextListLine);
  const firstContentLine = parsedLines.find((line) => line.raw.trim());
  const sourceBaseDepth = firstContentLine?.depth ?? 0;
  const lines = parsedLines.map((parsed) => {
    if (!parsed.raw.trim()) {
      return "";
    }
    const depth = Math.max(
      0,
      receivingDepth +
        (parsed.markerKind === "none" ? 0 : parsed.depth - sourceBaseDepth),
    );
    const marker =
      mode === "numbered" && depth === 0
        ? "1."
        : getBulletMarkerForDepth(depth);
    return `${TEXT_LIST_INDENT.repeat(depth)}${marker} ${parsed.content}`;
  });
  return normalizeNumberedLines(lines).join("\n");
};
