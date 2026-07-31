export const TEXT_LIST_INDENT = "    ";

export const TEXT_LIST_BULLET_MARKERS = ["•", "○", "▪"] as const;

export type TextListMarkerKind = "none" | "bullet" | "number";

export type ParsedTextListLine = {
  raw: string;
  indentation: string;
  depth: number;
  marker: string | null;
  markerKind: TextListMarkerKind;
  content: string;
};

const getIndentationWidth = (indentation: string) =>
  Array.from(indentation).reduce(
    (width, character) => width + (character === "\t" ? 4 : 1),
    0,
  );

export const getBulletMarkerForDepth = (depth: number) =>
  TEXT_LIST_BULLET_MARKERS[
    Math.max(0, Math.floor(depth)) % TEXT_LIST_BULLET_MARKERS.length
  ];

export const parseTextListLine = (line: string): ParsedTextListLine => {
  const match = line.match(/^([ \t]*)(?:(•|○|▪)|(\d+\.))[ \t]+(.*)$/u);
  const indentation = line.match(/^[ \t]*/)?.[0] ?? "";

  if (!match) {
    return {
      raw: line,
      indentation,
      depth: Math.floor(getIndentationWidth(indentation) / 4),
      marker: null,
      markerKind: "none",
      content: line.slice(indentation.length),
    };
  }

  const [, matchedIndentation, bullet, number, content] = match;
  return {
    raw: line,
    indentation: matchedIndentation,
    depth: Math.floor(getIndentationWidth(matchedIndentation) / 4),
    marker: bullet ?? number,
    markerKind: bullet ? "bullet" : "number",
    content,
  };
};

export const hasTextList = (text: string) =>
  text
    .split("\n")
    .some((line) => parseTextListLine(line).markerKind !== "none");
