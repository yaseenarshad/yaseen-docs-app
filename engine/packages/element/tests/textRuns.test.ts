import {
  convertLineStylesToTextRuns,
  getNearestNoteHighlight,
  getTextHighlightFill,
  getTextRangeColor,
  getTextRangeHighlight,
  getTextRangeToolbarKey,
  isTextRangeStyled,
  normalizeTextRuns,
  getInsertedTextRange,
  getTextRunsInRange,
  remapTextRunsForTextEdit,
  setTextRunColor,
  setTextRunFlag,
  setTextRunHighlight,
  TEXT_HIGHLIGHT_FILLS,
} from "../src/textRuns";
import { mutateElement, newElementWith } from "../src/mutateElement";
import { newTextElement } from "../src/newElement";

describe("YAZ-3718 D1: normalizeTextRuns", () => {
  it("drops malformed and empty runs and keeps only known styles", () => {
    expect(
      normalizeTextRuns(
        [
          { start: 0, end: 2, bold: true, weird: 1 },
          { start: 3, end: 3, bold: true },
          { start: 4, end: 5 },
          { start: "x", end: 5, bold: true },
          null,
          { start: 5, end: 6, underline: "yes", color: "" },
        ],
        10,
      ),
    ).toEqual([{ start: 0, end: 2, bold: true }]);
    expect(normalizeTextRuns("invalid", 10)).toBeUndefined();
    expect(normalizeTextRuns([{ start: 0, end: 2, bold: true }], 0)).toBe(
      undefined,
    );
  });

  it("clamps stale runs to the text", () => {
    // a normal Excalidraw edit made the text shorter
    expect(
      normalizeTextRuns(
        [
          { start: 2, end: 40, italic: true },
          { start: 30, end: 40, bold: true },
        ],
        5,
      ),
    ).toEqual([{ start: 2, end: 5, italic: true }]);
  });

  it("sorts runs, joins overlaps and merges neighbors with the same style", () => {
    expect(
      normalizeTextRuns(
        [
          { start: 4, end: 6, bold: true },
          { start: 0, end: 2, bold: true },
          { start: 2, end: 4, bold: true },
          { start: 5, end: 8, underline: true, color: "#111" },
          { start: 7, end: 8, color: "#222" },
        ],
        10,
      ),
    ).toEqual([
      { start: 0, end: 5, bold: true },
      { start: 5, end: 6, bold: true, underline: true, color: "#111" },
      { start: 6, end: 7, underline: true, color: "#111" },
      { start: 7, end: 8, underline: true, color: "#222" },
    ]);
  });
});

describe("YAZ-3718 D1: convertLineStylesToTextRuns", () => {
  it("converts each old line flag to one run over the line", () => {
    const text = "Title\nSubtitle\n\nBody";

    expect(convertLineStylesToTextRuns(text, { bold: [true] })).toEqual([
      { start: 0, end: 5, bold: true },
    ]);
    expect(
      convertLineStylesToTextRuns(text, { underline: [false, true] }),
    ).toEqual([{ start: 6, end: 14, underline: true }]);
    expect(
      convertLineStylesToTextRuns(text, {
        strikethrough: [false, false, true, true],
      }),
    ).toEqual([{ start: 16, end: 20, strikethrough: true }]);
    expect(
      normalizeTextRuns(
        convertLineStylesToTextRuns(text, {
          bold: [true, true],
          underline: [true],
          strikethrough: "invalid",
        }),
        text.length,
      ),
    ).toEqual([
      { start: 0, end: 5, bold: true, underline: true },
      { start: 6, end: 14, bold: true },
    ]);
  });
});

describe("YAZ-3718 D10: styles on a selection", () => {
  it("styles a selection and removes the style when all of it has it", () => {
    const bold = setTextRunFlag(undefined, 11, 6, 11, "bold", true);
    expect(bold).toEqual([{ start: 6, end: 11, bold: true }]);
    expect(isTextRangeStyled(bold, 6, 11, "bold")).toBe(true);
    expect(isTextRangeStyled(bold, 5, 11, "bold")).toBe(false);
    expect(setTextRunFlag(bold, 11, 6, 11, "bold", false)).toBeUndefined();
  });

  it("un-styles a part of a run and keeps the other styles there", () => {
    const runs = [{ start: 0, end: 10, bold: true, italic: true } as const];

    expect(setTextRunFlag(runs, 10, 3, 6, "bold", false)).toEqual([
      { start: 0, end: 3, bold: true, italic: true },
      { start: 3, end: 6, italic: true },
      { start: 6, end: 10, bold: true, italic: true },
    ]);
  });

  it("colors only the selected letters", () => {
    const runs = setTextRunColor(
      [{ start: 0, end: 4, bold: true }],
      10,
      2,
      6,
      "#e03131",
    );
    expect(runs).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 4, bold: true, color: "#e03131" },
      { start: 4, end: 6, color: "#e03131" },
    ]);
    expect(setTextRunColor(runs, 10, 0, 10, undefined)).toEqual([
      { start: 0, end: 4, bold: true },
    ]);
  });
});

describe("YAZ-3718 D10: remapTextRunsForTextEdit", () => {
  // "Hello bold world" with "bold" in bold
  const text = "Hello bold world";
  const runs = [{ start: 6, end: 10, bold: true as const }];

  it("extends a run for typing inside it and at its end", () => {
    expect(
      remapTextRunsForTextEdit(text, "Hello boXld world", runs, { caret: 9 }),
    ).toEqual([{ start: 6, end: 11, bold: true }]);
    expect(
      remapTextRunsForTextEdit(text, "Hello boldX world", runs, { caret: 11 }),
    ).toEqual([{ start: 6, end: 11, bold: true }]);
  });

  it("does not extend a run for typing before its start", () => {
    expect(
      remapTextRunsForTextEdit(text, "Hello Xbold world", runs, { caret: 7 }),
    ).toEqual([{ start: 7, end: 11, bold: true }]);
  });

  it("gives typing at a line start the style of the line's first letter", () => {
    expect(
      remapTextRunsForTextEdit("ab\ncd", "ab\nXcd", [
        { start: 3, end: 5, bold: true },
      ]),
    ).toEqual([{ start: 3, end: 6, bold: true }]);
  });

  it("moves runs after an edit and shrinks runs for a delete across them", () => {
    expect(
      remapTextRunsForTextEdit(text, "Hi, Hello bold world", runs, {
        caret: 4,
      }),
    ).toEqual([{ start: 10, end: 14, bold: true }]);
    // Backspace over "o b" across the run start
    expect(
      remapTextRunsForTextEdit(text, "Hellold world", runs, { caret: 4 }),
    ).toEqual([{ start: 4, end: 7, bold: true }]);
    // a delete of the whole run drops it
    expect(
      remapTextRunsForTextEdit(text, "Hello  world", runs, { caret: 6 }),
    ).toBeUndefined();
  });

  it("gives typing over a selection across runs the style of its first letter", () => {
    expect(
      remapTextRunsForTextEdit(text, "Hello bXrld", runs, { caret: 8 }),
    ).toEqual([{ start: 6, end: 8, bold: true }]);
    expect(
      remapTextRunsForTextEdit(text, "HelXld world", runs, { caret: 4 }),
    ).toEqual([{ start: 4, end: 6, bold: true }]);
  });

  it("keeps the style on both sides of an Enter, and Backspace joins them again", () => {
    const split = remapTextRunsForTextEdit(text, "Hello bo\nld world", runs, {
      caret: 9,
    });
    expect(split).toEqual([{ start: 6, end: 11, bold: true }]);
    expect(
      remapTextRunsForTextEdit("Hello bo\nld world", text, split, {
        caret: 8,
      }),
    ).toEqual(runs);
    // Enter at the end of a bold text: the new line continues the style
    const enter = remapTextRunsForTextEdit("Hello bold", "Hello bold\n", runs, {
      caret: 11,
    });
    expect(enter).toEqual([{ start: 6, end: 11, bold: true }]);
    expect(
      remapTextRunsForTextEdit("Hello bold\n", "Hello bold\nX", enter, {
        caret: 12,
      }),
    ).toEqual([{ start: 6, end: 12, bold: true }]);
    // a line that starts with plain letters stays plain for typing at its start
    expect(
      remapTextRunsForTextEdit(
        "Hello bold\n world",
        "Hello bold\nX world",
        enter,
        { caret: 12 },
      ),
    ).toEqual(enter);
  });

  it("YAZ-4071 7C, 7D: eachLine moves each line by its own prefix, and the prefix stays plain", () => {
    const lineRuns = [
      { start: 0, end: 3, bold: true as const },
      { start: 8, end: 11, italic: true as const },
    ];
    expect(
      remapTextRunsForTextEdit(
        "aaa\nbbb\nccc",
        "• aaa\n• bbb\n• ccc",
        lineRuns,
        {
          eachLine: true,
        },
      ),
    ).toEqual([
      { start: 2, end: 5, bold: true },
      { start: 14, end: 17, italic: true },
    ]);
    // a marker changed for another marker
    expect(
      remapTextRunsForTextEdit(
        "• aaa\n• bbb",
        "1. aaa\n2. bbb",
        [{ start: 8, end: 11, bold: true as const }],
        { eachLine: true },
      ),
    ).toEqual([{ start: 10, end: 13, bold: true }]);
  });

  it("YAZ-4071 7L: getInsertedTextRange finds the letters an undo brought back, and getTextRunsInRange gives their runs from 0", () => {
    expect(getInsertedTextRange(" cd", "ab cd")).toEqual({ start: 0, end: 2 });
    expect(getInsertedTextRange("XcdY", "XY")).toEqual({ start: 1, end: 1 });
    expect(
      getTextRunsInRange(
        [
          { start: 0, end: 3, bold: true },
          { start: 4, end: 6, italic: true },
        ],
        2,
        5,
      ),
    ).toEqual([
      { start: 0, end: 1, bold: true },
      { start: 2, end: 3, italic: true },
    ]);
  });

  it("uses the caret to tell Enter at a line end from Enter at the next line start", () => {
    const lineRuns = [{ start: 0, end: 5, bold: true as const }];
    expect(
      remapTextRunsForTextEdit("Title\nbody", "Title\n\nbody", lineRuns, {
        caret: 6,
      }),
    ).toEqual([{ start: 0, end: 6, bold: true }]);
    expect(
      remapTextRunsForTextEdit("Title\nbody", "Title\n\nbody", lineRuns, {
        caret: 7,
      }),
    ).toEqual(lineRuns);
  });

  it("moves each line on its own for a numbered Enter that renumbers the lines below", () => {
    expect(
      remapTextRunsForTextEdit(
        "1. A\n2. B\n3. C",
        "1. A\n2. \n3. B\n4. C",
        [
          { start: 5, end: 9, bold: true },
          { start: 13, end: 14, italic: true },
        ],
        { insertedLine: 1, caret: 8 },
      ),
    ).toEqual([
      { start: 9, end: 13, bold: true },
      { start: 17, end: 18, italic: true },
    ]);
  });

  it("gives the next typed letters a pending style", () => {
    expect(
      remapTextRunsForTextEdit("ab", "abX", undefined, {
        caret: 3,
        insertStyle: { italic: true },
      }),
    ).toEqual([{ start: 2, end: 3, italic: true }]);
    expect(
      remapTextRunsForTextEdit(
        "ab",
        "abX",
        [{ start: 0, end: 2, bold: true }],
        {
          caret: 3,
          insertStyle: { underline: true },
        },
      ),
    ).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 3, bold: true, underline: true },
    ]);
  });
});

describe("YAZ-4101 3D: getTextRangeColor", () => {
  const text = "Hello red world";
  const runs = [
    { start: 6, end: 9, color: "#e03131" },
    { start: 9, end: 10, color: "#e03131", bold: true as const },
    { start: 10, end: 15, bold: true as const },
  ];

  it("gives one color for letters of one color, across runs", () => {
    expect(getTextRangeColor(runs, text, 6, 10)).toBe("#e03131");
    expect(getTextRangeColor(runs, text, 7, 8)).toBe("#e03131");
  });

  it("gives undefined (the box color) for letters with no run color", () => {
    expect(getTextRangeColor(runs, text, 0, 5)).toBeUndefined();
    expect(getTextRangeColor(runs, text, 11, 15)).toBeUndefined();
    expect(getTextRangeColor(undefined, text, 0, 15)).toBeUndefined();
  });

  it("gives null (mixed) for letters of several colors, a gap included", () => {
    expect(getTextRangeColor(runs, text, 4, 8)).toBeNull();
    expect(getTextRangeColor(runs, text, 8, 12)).toBeNull();
  });

  it("gives a caret the color the next typed letter gets", () => {
    expect(getTextRangeColor(runs, text, 9, 9)).toBe("#e03131");
    expect(getTextRangeColor(runs, text, 6, 6)).toBeUndefined();
  });
});

describe("YAZ-4102 3E: highlight runs", () => {
  it("highlights a word, changes its color, and takes it off", () => {
    const yellow = setTextRunHighlight(undefined, 11, 6, 11, "yellow");
    expect(yellow).toEqual([{ start: 6, end: 11, highlight: "yellow" }]);
    expect(setTextRunHighlight(yellow, 11, 6, 11, "pink")).toEqual([
      { start: 6, end: 11, highlight: "pink" },
    ]);
    expect(setTextRunHighlight(yellow, 11, 6, 11, undefined)).toBeUndefined();
    // a part of it, and the other styles stay
    const bold = setTextRunFlag(yellow, 11, 6, 11, "bold", true);
    expect(setTextRunHighlight(bold, 11, 8, 11, undefined)).toEqual([
      { start: 6, end: 8, bold: true, highlight: "yellow" },
      { start: 8, end: 11, bold: true },
    ]);
  });

  it("keeps the four note colors and a custom #rrggbb from a file (YAZ-3943 demo 2); anything else goes", () => {
    expect(
      normalizeTextRuns(
        [
          { start: 0, end: 2, highlight: "green" },
          { start: 2, end: 4, highlight: "#ff0000" },
          { start: 4, end: 6, highlight: "toString" },
          { start: 6, end: 8, highlight: "#f00" },
          { start: 8, end: 10, highlight: "red" },
          { start: 10, end: 12, highlight: "#gg0000" },
          { start: 12, end: 14, highlight: 7 },
        ],
        14,
      ),
    ).toEqual([
      { start: 0, end: 2, highlight: "green" },
      { start: 2, end: 4, highlight: "#ff0000" },
    ]);
  });

  it("YAZ-3943 demo 2: a note color fills as it always did; a custom color is as translucent as they are; a note gets the nearest of its four", () => {
    expect(getTextHighlightFill("yellow")).toBe(TEXT_HIGHLIGHT_FILLS.yellow);
    expect(getTextHighlightFill("#ff8000")).toBe("rgba(255, 128, 0, 0.4)");
    expect(getNearestNoteHighlight("pink")).toBe("pink");
    expect(getNearestNoteHighlight("#ffd500")).toBe("yellow");
    expect(getNearestNoteHighlight("#40c070")).toBe("green");
    expect(getNearestNoteHighlight("#3c8cff")).toBe("blue");
    expect(getNearestNoteHighlight("#ff70b0")).toBe("pink");
  });

  it("tells the one highlight of a range, else undefined", () => {
    const runs = [
      { start: 0, end: 3, highlight: "yellow" },
      { start: 3, end: 5, highlight: "yellow", bold: true as const },
      { start: 6, end: 8, highlight: "blue" },
    ];
    expect(getTextRangeHighlight(runs, 0, 5)).toBe("yellow");
    expect(getTextRangeHighlight(runs, 4, 7)).toBeUndefined();
    expect(getTextRangeHighlight(runs, 6, 8)).toBe("blue");
    expect(getTextRangeHighlight(runs, 5, 6)).toBeUndefined();
  });
});

describe("YAZ-4101: the last run removed is a change", () => {
  const styled = () => ({
    ...newTextElement({ x: 0, y: 0, text: "ab" }),
    textRuns: [{ start: 0, end: 2, bold: true as const }],
  });

  it("newElementWith gives a new version with no runs", () => {
    const element = styled();
    const next = newElementWith(element, { textRuns: undefined });
    expect(next).not.toBe(element);
    expect(next.textRuns).toBeUndefined();
    expect(next.version).toBe(element.version + 1);
    // no runs before and after: no change
    expect(newElementWith(next, { textRuns: undefined })).toBe(next);
  });

  it("mutateElement takes the runs off", () => {
    const element = styled();
    const version = element.version;
    mutateElement(element, new Map(), { textRuns: undefined });
    expect(element.textRuns).toBeUndefined();
    expect(element.version).toBe(version + 1);
    mutateElement(element, new Map(), { textRuns: undefined });
    expect(element.version).toBe(version + 1);
  });
});

describe("YAZ-4101 3D: the toolbar's key for a selection", () => {
  const text = "Hello red world";
  const runs = [
    { start: 0, end: 5, bold: true as const },
    { start: 6, end: 9, color: "#e03131" },
  ];
  const key = (start: number, end: number) =>
    getTextRangeToolbarKey(runs, text, start, end);

  it("is the same for letters, and a caret, that show the same toolbar", () => {
    expect(key(1, 4)).toBe(key(0, 5));
    expect(key(2, 2)).toBe(key(0, 5));
    expect(key(10, 15)).toBe(key(11, 11));
  });

  it("differs for another flag, color or highlight, and tells the box color from mixed", () => {
    expect(key(0, 5)).not.toBe(key(10, 15));
    expect(key(6, 9)).not.toBe(key(10, 15));
    expect(key(4, 8)).not.toBe(key(10, 15));
    expect(
      getTextRangeToolbarKey(
        [{ start: 0, end: 5, highlight: "yellow" }],
        text,
        0,
        5,
      ),
    ).not.toBe(getTextRangeToolbarKey(undefined, text, 0, 5));
  });
});
