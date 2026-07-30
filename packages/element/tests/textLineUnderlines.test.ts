import {
  getSelectedLogicalLineRange,
  normalizeLineUnderlines,
  toggleSelectedLineUnderlines,
} from "../src/textLineUnderlines";

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
