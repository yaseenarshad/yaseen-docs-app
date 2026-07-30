import {
  getUnderlinedVisualLines,
  getSelectedLogicalLineRange,
  normalizeLineUnderlines,
  remapLineUnderlinesForTextEdit,
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
    expect(
      normalizeLineUnderlines([true, "yes", false, true], 3),
    ).toEqual([true]);
    expect(normalizeLineUnderlines([false, false], 2)).toBeUndefined();
    expect(normalizeLineUnderlines("invalid", 2)).toBeUndefined();
  });
});

describe("remapLineUnderlinesForTextEdit", () => {
  it("preserves decoration for character edits", () => {
    expect(
      remapLineUnderlinesForTextEdit(
        "Title\nSubtitle",
        "New Title\nSubtitle",
        [true],
      ),
    ).toEqual([true]);
  });

  it("inherits decoration when an underlined line is split", () => {
    expect(
      remapLineUnderlinesForTextEdit("Title", "Ti\ntle", [true]),
    ).toEqual([true, true]);
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
      remapLineUnderlinesForTextEdit(
        "Title\nBody",
        "Intro\nTitle\nBody",
        [true, false],
      ),
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
