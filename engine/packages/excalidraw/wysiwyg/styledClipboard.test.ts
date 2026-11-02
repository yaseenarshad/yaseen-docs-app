import {
  getPlainPasteText,
  getStyledHtml,
  parseStyledHtml,
} from "./styledClipboard";

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

  it("YAZ-3943 demo 2: a custom highlight copies to a note as the nearest of its four colors", () => {
    expect(
      getStyledHtml("ab", [{ start: 0, end: 2, highlight: "#ff70b0" }], 0, 2),
    ).toBe('<p><mark class="highlight-pink">ab</mark></p>');
    expect(
      getStyledHtml("ab", [{ start: 0, end: 2, highlight: "#ffd500" }], 0, 2),
    ).toBe("<p><mark>ab</mark></p>");
  });

  it("YAZ-3943 demo 2 (a paste on the board): Google Docs' inline CSS and a heading are styles, white space is one space, `keepPlain` keeps unstyled text, and `linkOf` turns a vault link into its [[link]]", () => {
    expect(
      parseStyledHtml(
        '<h1>Head</h1><p><span style="font-weight:700">b</span>\n  <span style="font-style:italic;color:#f00">i</span> <span style="text-decoration:underline line-through">x</span></p>',
      ),
    ).toEqual({
      text: "Head\nb i x",
      textRuns: [
        { start: 0, end: 4, bold: true },
        { start: 5, end: 6, bold: true },
        { start: 7, end: 8, italic: true },
        { start: 9, end: 10, underline: true, strikethrough: true },
      ],
    });
    expect(parseStyledHtml("<p>plain</p><br><br><br><p>words</p>")).toBeNull();
    expect(
      parseStyledHtml("<p>plain</p><br><br><br><p>words</p>", {
        keepPlain: true,
      }),
    ).toEqual({ text: "plain\n\nwords", textRuns: [] });
    expect(
      parseStyledHtml('<p>see <a href="/v/Plan.md">Plan</a></p>', {
        keepPlain: true,
        linkOf: (href) => (href === "/v/Plan.md" ? "[[YAS-1]]" : null),
      }),
    ).toEqual({ text: "see [[YAS-1]]", textRuns: [] });
  });

  it("YAZ-3943 demo 2: plain pasted text for one box keeps at most one blank line, and `-`, `*`, `+` lines are bullets by their indent", () => {
    expect(getPlainPasteText("\r\n\na\r\n\n\n\nb\n\n")).toBe("a\n\nb");
    expect(getPlainPasteText("- a\n\t* b\n        + c\nnot - a list")).toBe(
      "• a\n    ○ b\n        ▪ c\nnot - a list",
    );
  });
});
