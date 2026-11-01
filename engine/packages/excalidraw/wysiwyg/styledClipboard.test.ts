import { getStyledHtml, parseStyledHtml } from "./styledClipboard";

describe("YAZ-4103 3F: the styled clipboard", () => {
  it("reads a link's words, a non-breaking space, and Google Docs' normal-weight wrapper", () => {
    expect(
      parseStyledHtml(
        '<b style="font-weight:normal;" id="docs-internal-guid-1"><span>see&nbsp;</span><a href="https://x.test"><strong>site</strong></a></b>',
      ),
    ).toEqual({
      text: "see site",
      textRuns: [{ start: 4, end: 8, bold: true }],
    });
  });

  it("gives null for text with no style, and skips a style sheet", () => {
    expect(parseStyledHtml("<p>plain</p><p>words</p>")).toBeNull();
    expect(
      parseStyledHtml("<style>p { color: red }</style><p><u>u</u></p>"),
    ).toEqual({ text: "u", textRuns: [{ start: 0, end: 1, underline: true }] });
  });

  it("numbers an ordered list from its start", () => {
    expect(
      parseStyledHtml(
        '<ol start="3"><li><p><em>a</em></p></li><li><p>b</p></li></ol>',
      )?.text,
    ).toBe("3. a\n4. b");
  });

  it("writes a part of a run, and escapes the text", () => {
    expect(
      getStyledHtml("x <b> & y", [{ start: 0, end: 9, bold: true }], 2, 5),
    ).toBe("<p><strong>&lt;b&gt;</strong></p>");
    expect(
      getStyledHtml("ab", [{ start: 0, end: 2, color: "#e03131" }], 0, 2),
    ).toBeNull();
  });

  it("reads back what it writes", () => {
    const runs = [
      { start: 0, end: 2, bold: true as const, italic: true as const },
      { start: 3, end: 5, highlight: "pink" },
    ];
    expect(parseStyledHtml(getStyledHtml("ab cd\nef", runs, 0, 8)!)).toEqual({
      text: "ab cd\nef",
      textRuns: runs,
    });
  });
});
